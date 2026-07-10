/**
 * Transcript → turns → export orchestration. This module owns the stateful
 * pipeline (incremental read, trailing-turn hold, deferral resolution, subagent
 * discovery, byte-offset persistence, export gating) and delegates the actual
 * Turn → OTel span construction to emit.ts. It knows about fs, offsets, and
 * SessionState; the renderer knows none of that.
 */
import type { LaminarConfig } from "./config.js";
import {
  getTaskIdToToolUseId,
  getTurnsToEmit,
  popAllDeferredAgentTurnRowLists,
  resolveDeferredAgentTurns,
} from "./deferral.js";
import { emitTurn } from "./emit.js";
import { debug, info } from "./logger.js";
import { isTaskNotificationRow } from "./notifications.js";
import {
  getSessionState,
  getSessionStateKey,
  loadHookState,
  saveSessionState,
  withStateLock,
  type SessionState,
} from "./state.js";
import { getSubagentTranscriptsByToolUseId, type SubagentTranscript } from "./subagents.js";
import { exportWithTimeout, TraceEmitter } from "./tracer.js";
import { getUserOrAssistantRoleFromRow, isToolResult, readNewJsonl } from "./transcript.js";
import { buildTurns, type Turn } from "./turns.js";
import type { Row } from "./types.js";

export function emitReadyTurns(
  emitter: TraceEmitter,
  config: LaminarConfig,
  sessionId: string,
  transcriptPath: string,
  turnsToEmit: Turn[],
  sessionState: SessionState,
  subagentMap: Record<string, SubagentTranscript>,
  emitTurnFn: typeof emitTurn = emitTurn
): number {
  let emitted = 0;
  for (const turn of turnsToEmit) {
    const turnNum = sessionState.turnCount + emitted + 1;
    try {
      emitTurnFn(emitter, config, sessionId, turnNum, turn, transcriptPath, subagentMap);
    } catch (e) {
      // Log at INFO so emit failures are visible without CC_LMNR_DEBUG=true.
      // The failed turn is not counted, so turnCount only reflects turns whose
      // spans were actually built.
      info(`emitTurn failed: ${e}`);
      continue;
    }
    emitted += 1;
  }
  return emitted;
}

/**
 * Split off an incomplete trailing turn — a user prompt not yet followed by any
 * assistant row — so it is held for the next run instead of dropped. Returns
 * [rowsToProcessNow, rowsToHold].
 */
function splitTrailingIncompleteTurn(rows: Row[]): [Row[], Row[]] {
  let lastUserIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.isMeta || isToolResult(row) || isTaskNotificationRow(row)) {
      continue;
    }
    if (getUserOrAssistantRoleFromRow(row) === "user") {
      lastUserIdx = i;
    }
  }
  if (lastUserIdx < 0) {
    return [rows, []];
  }
  const tail = rows.slice(lastUserIdx);
  const tailHasAssistant = tail.some((r) => getUserOrAssistantRoleFromRow(r) === "assistant");
  if (tailHasAssistant) {
    return [rows, []];
  }
  return [rows.slice(0, lastUserIdx), tail];
}

export function getNewTurnsFromTranscript(
  transcriptPath: string,
  sessionState: SessionState,
  subagentMap?: Record<string, SubagentTranscript>,
  flushDeferredAgentTurns = false
): [Turn[], SessionState] {
  let rows: Row[];
  // At SessionEnd no more transcript bytes are coming, so a buffered final
  // line that is complete JSON (file ended without a trailing newline) is
  // flushed instead of being held forever.
  [rows, sessionState] = readNewJsonl(transcriptPath, sessionState, flushDeferredAgentTurns);
  // Replay an incomplete trailing turn held from a prior run (chronologically
  // oldest), then let it flow through the normal pipeline.
  if (sessionState.pendingTurnRows.length > 0) {
    rows = [...sessionState.pendingTurnRows, ...rows];
    sessionState.pendingTurnRows = [];
  }
  const taskIdToToolUseId = getTaskIdToToolUseId(subagentMap);

  let [deferredTurnRowLists, remainingRows] = resolveDeferredAgentTurns(rows, sessionState, taskIdToToolUseId);

  // Hold back an incomplete trailing turn (except at SessionEnd, which flushes
  // everything) so its user row is re-read with the assistant response next run.
  if (!flushDeferredAgentTurns) {
    const [keep, hold] = splitTrailingIncompleteTurn(remainingRows);
    sessionState.pendingTurnRows = hold;
    remainingRows = keep;
  }

  if (flushDeferredAgentTurns && sessionState.pendingAgentTurns.length > 0) {
    const flushedRowLists = popAllDeferredAgentTurnRowLists(sessionState);
    if (flushedRowLists.length > 0) {
      debug(`Flushing ${flushedRowLists.length} deferred agent turn(s) without task notification`);
      deferredTurnRowLists = deferredTurnRowLists.concat(flushedRowLists);
    }
  }

  if (flushDeferredAgentTurns && sessionState.pendingTaskNotifications.length > 0) {
    debug(`Dropping ${sessionState.pendingTaskNotifications.length} unresolved task notification(s) at session end`);
    sessionState.pendingTaskNotifications = [];
  }

  // Each deferred row list is a complete turn from an earlier hook run, so it
  // is rebuilt in isolation and emitted before the current batch (its rows are
  // always chronologically older than anything in the batch).
  const turns: Turn[] = [];
  for (const deferredTurnRows of deferredTurnRowLists) {
    turns.push(...buildTurns(deferredTurnRows, taskIdToToolUseId));
  }
  if (remainingRows.length > 0) {
    turns.push(...buildTurns(remainingRows, taskIdToToolUseId));
  }

  return [turns, sessionState];
}

export interface EmitNewTurnsOptions {
  flushDeferredAgentTurns?: boolean;
  exportFn?: (emitter: TraceEmitter) => Promise<boolean>;
}

export async function emitNewTurnsFromTranscript(
  emitter: TraceEmitter,
  config: LaminarConfig,
  sessionId: string,
  transcriptPath: string,
  opts: EmitNewTurnsOptions = {}
): Promise<number> {
  const flushDeferredAgentTurns = opts.flushDeferredAgentTurns ?? false;
  const exportFn = opts.exportFn ?? exportWithTimeout;

  return withStateLock(async () => {
    const state = loadHookState();
    const key = getSessionStateKey(sessionId, transcriptPath);
    let sessionState = getSessionState(state, key);

    const subagentMap = getSubagentTranscriptsByToolUseId(transcriptPath);
    if (Object.keys(subagentMap).length > 0) {
      debug(`Discovered ${Object.keys(subagentMap).length} subagent transcript(s)`);
    }

    let turns: Turn[];
    [turns, sessionState] = getNewTurnsFromTranscript(transcriptPath, sessionState, subagentMap, flushDeferredAgentTurns);
    if (turns.length === 0) {
      saveSessionState(state, key, sessionState);
      return 0;
    }

    const turnsToEmit = getTurnsToEmit(turns, sessionState, flushDeferredAgentTurns);
    const emitted = emitReadyTurns(emitter, config, sessionId, transcriptPath, turnsToEmit, sessionState, subagentMap);

    // Only persist the advanced offset after a successful export; on failure the
    // old state stays on disk so the next hook run re-reads the same bytes and
    // retries.
    const exported = await exportFn(emitter);
    if (!exported) {
      info("OTLP export failed; keeping previous state so these turns are retried on the next hook run");
      return 0;
    }

    sessionState.turnCount += emitted;
    saveSessionState(state, key, sessionState);
    return emitted;
  });
}
