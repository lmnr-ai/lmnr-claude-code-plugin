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
import {
  extractTextFromContent,
  getContentFromRow,
  getUserOrAssistantRoleFromRow,
  isToolResult,
  readNewJsonl,
} from "./transcript.js";
import { buildTurns, type Turn } from "./turns.js";
import { ToolTimeline } from "./tools.js";
import type { Row } from "./types.js";

export function emitReadyTurns(
  emitter: TraceEmitter,
  config: LaminarConfig,
  sessionId: string,
  transcriptPath: string,
  turnsToEmit: Turn[],
  sessionState: SessionState,
  subagentMap: Record<string, SubagentTranscript>,
  emitTurnFn: typeof emitTurn = emitTurn,
  toolTimeline: ToolTimeline | null = null
): number {
  let emitted = 0;
  for (const turn of turnsToEmit) {
    const turnNum = sessionState.turnCount + emitted + 1;
    try {
      emitTurnFn(emitter, config, sessionId, turnNum, turn, transcriptPath, subagentMap, toolTimeline);
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
 * Split off an incomplete trailing turn so it is held for the next run instead
 * of emitted without its ending. A trailing turn is incomplete when its user
 * prompt has no assistant row yet, when its last chat row is a tool_result (the
 * assistant's reply to it isn't written yet), or when none of its assistant
 * rows carries the end of `finalAssistantText` — the text the Stop payload says
 * the turn ended with. Claude Code fires Stop before it writes that final row,
 * and in interactive sessions often only after the hook exits, so waiting for
 * it inside the hook doesn't help. Returns [rowsToProcessNow, rowsToHold].
 */
function splitTrailingIncompleteTurn(rows: Row[], finalAssistantText = ""): [Row[], Row[]] {
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
  const hold: [Row[], Row[]] = [rows.slice(0, lastUserIdx), tail];
  const assistantRows: Row[] = [];
  for (const row of tail) {
    if (isToolResult(row)) {
      assistantRows.length = 0; // only replies written after the last tool_result count
    } else if (getUserOrAssistantRoleFromRow(row) === "assistant") {
      assistantRows.push(row);
    }
  }
  if (assistantRows.length === 0) {
    return hold;
  }
  // The final message can span several rows; its last text row ends the text.
  const want = finalAssistantText.trim();
  if (
    want &&
    !assistantRows.some((row) => {
      const text = extractTextFromContent(getContentFromRow(row)).trim();
      return text !== "" && want.endsWith(text);
    })
  ) {
    return hold;
  }
  return [rows, []];
}

export function getNewTurnsFromTranscript(
  transcriptPath: string,
  sessionState: SessionState,
  subagentMap?: Record<string, SubagentTranscript>,
  flushDeferredAgentTurns = false,
  finalAssistantText = "",
  toolTimeline: ToolTimeline | null = null
): [Turn[], SessionState] {
  let rows: Row[];
  // At SessionEnd no more transcript bytes are coming, so a buffered final
  // line that is complete JSON (file ended without a trailing newline) is
  // flushed instead of being held forever.
  [rows, sessionState] = readNewJsonl(transcriptPath, sessionState, flushDeferredAgentTurns);
  // Only new rows: rows replayed from state below were observed when first read.
  if (toolTimeline !== null) {
    for (const row of rows) {
      toolTimeline.observe(row);
    }
    sessionState.toolSetChanges = toolTimeline.changes;
  }
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
    const [keep, hold] = splitTrailingIncompleteTurn(remainingRows, finalAssistantText);
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
  // Stop payload's last_assistant_message: the text the turn ended with.
  finalAssistantText?: string;
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

    const toolTimeline = new ToolTimeline(sessionState.toolSetChanges);
    let turns: Turn[];
    [turns, sessionState] = getNewTurnsFromTranscript(
      transcriptPath,
      sessionState,
      subagentMap,
      flushDeferredAgentTurns,
      opts.finalAssistantText ?? "",
      toolTimeline
    );
    if (turns.length === 0) {
      saveSessionState(state, key, sessionState);
      return 0;
    }

    const turnsToEmit = getTurnsToEmit(turns, sessionState, flushDeferredAgentTurns);
    const emitted = emitReadyTurns(
      emitter,
      config,
      sessionId,
      transcriptPath,
      turnsToEmit,
      sessionState,
      subagentMap,
      emitTurn,
      toolTimeline
    );

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
