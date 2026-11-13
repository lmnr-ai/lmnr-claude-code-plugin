/**
 * One hook run: re-read from the first turn not exported yet, export the ready
 * turns, and move the offset to the first turn still waiting or not sent.
 */
import * as fs from "node:fs";
import { debug, info, type LaminarConfig } from "./config.js";
import { exportSpans, MAX_BATCH_BYTES, spanBytes, Tracer, type Span } from "./otlp.js";
import { hasReply, renderTurn, type RenderContext } from "./render.js";
import { emptyState, LOCK_WAIT_MS, LOCK_WAIT_SESSION_END_MS, loadState, saveState, sessionKey, withSessionLock } from "./state.js";
import { ToolTimeline } from "./tools.js";
import { findSubagents, readLines, taskIdMap } from "./transcript.js";
import { isIncomplete, pendingAgents, routeNotifications, splitTurns, type Turn } from "./turns.js";

// Stop waiting on background agents once a run would re-read this much.
const MAX_REREAD_BYTES = 20_000_000;

export interface RunOptions {
  sessionEnd?: boolean;
  // The Stop payload's last_assistant_message: the text the turn ended with.
  finalAssistantText?: string;
  // Test seams (ESM can't monkeypatch imports).
  exportFn?: (config: LaminarConfig, spans: Span[]) => Promise<boolean>;
  renderFn?: typeof renderTurn;
}

/**
 * Send each turn's spans in order, in requests under MAX_BATCH_BYTES, stopping at
 * the first failure. Returns how many turns went out whole.
 */
async function exportInBatches(
  config: LaminarConfig,
  turnSpans: Span[][],
  exportFn: NonNullable<RunOptions["exportFn"]>
): Promise<number> {
  let batch: Span[] = [];
  let bytes = 0;
  let sent = 0; // turns whose spans all went out
  let queued = 0; // turns whose remaining spans are all in `batch`
  const flush = async (): Promise<boolean> => {
    const ok = batch.length === 0 || (await exportFn(config, batch));
    batch = [];
    bytes = 0;
    return ok;
  };
  for (const spans of turnSpans) {
    for (const span of spans) {
      const size = spanBytes(span);
      if (batch.length > 0 && bytes + size > MAX_BATCH_BYTES) {
        if (!(await flush())) {
          return sent;
        }
        sent += queued;
        queued = 0;
      }
      batch.push(span);
      bytes += size;
    }
    queued += 1;
  }
  return (await flush()) ? sent + queued : sent;
}

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Export the session's ready turns; returns how many were exported. */
export async function processTranscript(
  config: LaminarConfig,
  sessionId: string,
  transcriptPath: string,
  opts: RunOptions = {}
): Promise<number> {
  const { sessionEnd = false, finalAssistantText = "", exportFn = exportSpans, renderFn = renderTurn } = opts;
  const key = sessionKey(sessionId, transcriptPath);

  const waitMs = sessionEnd ? LOCK_WAIT_SESSION_END_MS : LOCK_WAIT_MS;
  return withSessionLock(key, async () => {
    let state = loadState(key, transcriptPath);
    if (fileSize(transcriptPath) < state.offset) {
      debug(`transcript shrank below byte ${state.offset}; restarting from the beginning`);
      state = { ...emptyState(), turnCount: state.turnCount, toolSetChanges: state.toolSetChanges };
    }
    const { lines, end } = readLines(transcriptPath, state.offset);

    const tools = new ToolTimeline(state.toolSetChanges);
    for (const line of lines) {
      if (line.offset >= state.toolsScannedTo) {
        tools.observe(line.row);
      }
    }
    const subagents = findSubagents(transcriptPath);
    const taskIds = taskIdMap(subagents);
    const turns = splitTurns(lines);
    routeNotifications(turns, taskIds);

    const exported = new Set(state.exported);
    const handled: number[] = []; // turns dealt with this run, in order
    const ready: Turn[] = [];
    let waitingFrom: number | null = null;
    const waitForAgents = !sessionEnd && end - state.offset <= MAX_REREAD_BYTES;
    turns.forEach((turn, i) => {
      if (exported.has(turn.start)) {
        return;
      }
      const agents = waitForAgents ? pendingAgents(turn, taskIds) : [];
      const unfinished = !sessionEnd && i === turns.length - 1 && isIncomplete(turn, finalAssistantText);
      if (agents.length > 0 || unfinished) {
        debug(`turn at byte ${turn.start} waits for ${agents.length > 0 ? `agents ${agents}` : "its final row"}`);
        waitingFrom ??= turn.start;
        return;
      }
      handled.push(turn.start);
      if (hasReply(turn)) {
        ready.push(turn);
      }
    });

    const tracer = new Tracer();
    const ctx: RenderContext = { tracer, subagents, taskIds, tools };
    const rendered: { turn: Turn; spans: Span[] }[] = [];
    for (const turn of ready) {
      const mark = tracer.spans.length;
      try {
        renderFn(ctx, config, sessionId, state.turnCount + rendered.length + 1, turn, transcriptPath);
        rendered.push({ turn, spans: tracer.spans.slice(mark) });
      } catch (e) {
        // Skipped for good: a malformed turn would fail the same way on every retry.
        tracer.spans.length = mark;
        info(`renderTurn failed: ${e}`);
      }
    }

    // Turns whose export failed, and everything after them, are retried next run.
    const sent = await exportInBatches(config, rendered.map((r) => r.spans), exportFn);
    const failedAt = sent < rendered.length ? rendered[sent]!.turn.start : null;
    if (failedAt !== null) {
      info(`OTLP export failed; ${rendered.length - sent} turn(s) will be retried on the next hook run`);
    }
    for (const start of handled) {
      if (failedAt === null || start < failedAt) {
        exported.add(start);
      }
    }
    const offset = Math.min(waitingFrom ?? end, failedAt ?? end);
    saveState(key, {
      offset,
      exported: [...exported].filter((start) => start > offset).sort((a, b) => a - b),
      turnCount: state.turnCount + sent,
      toolsScannedTo: Math.max(state.toolsScannedTo, end),
      toolSetChanges: tools.changes,
    });
    return sent;
  }, { waitMs });
}
