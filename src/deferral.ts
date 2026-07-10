import { MAX_PENDING_TASK_NOTIFICATIONS } from "./config.js";
import { debug } from "./logger.js";
import { getToolUseIdForTaskNotification, isTaskNotificationRow } from "./notifications.js";
import type { PendingAgentTurn, SessionState } from "./state.js";
import type { SubagentTranscript } from "./subagents.js";
import { getContentFromRow, getToolUseBlocks } from "./transcript.js";
import type { ToolResultEntry, Turn } from "./turns.js";
import type { Row } from "./types.js";
import { jsonDumps } from "./util.js";

// ----------------- Async-agent launch detection -----------------
// The lifecycle of an async agent (Task/Agent launched with a deferred result)
// lives in this module: detect the launch, defer the turn, attribute the
// task-notification back to it, and pop it once resolved.
export function getToolResultText(toolResultEntry: ToolResultEntry | undefined): string {
  if (!toolResultEntry) {
    return "";
  }
  const toolResultContent = toolResultEntry.content;
  if (typeof toolResultContent === "string") {
    return toolResultContent;
  }
  return jsonDumps(toolResultContent);
}

/**
 * Read the structured async marker Claude Code puts on tool_result rows.
 * Returns null when the row carries no toolUseResult (older Claude Code
 * versions), so callers can fall back to the launch-text heuristic.
 */
export function getAsyncLaunchFlagFromRow(row: Row): boolean | null {
  const toolUseResult = row.toolUseResult;
  if (typeof toolUseResult !== "object" || toolUseResult === null) {
    return null;
  }
  return toolUseResult.status === "async_launched" || toolUseResult.isAsync === true;
}

export function isAsyncAgentLaunchResult(toolResultEntry: ToolResultEntry | undefined): boolean {
  if (!toolResultEntry) {
    return false;
  }
  // Prefer the structured toolUseResult marker: launch-text matching also
  // fires on tool results that merely quote it (e.g. reading this file).
  if (toolResultEntry.isAsyncLaunch != null) {
    return toolResultEntry.isAsyncLaunch;
  }
  const toolResultText = getToolResultText(toolResultEntry);
  return (
    toolResultText.includes("Async agent launched successfully") ||
    (toolResultText.includes("agentId:") &&
      toolResultText.includes("output_file:") &&
      toolResultText.includes("You will be notified automatically"))
  );
}

// ----------------- Task-id attribution bridge -----------------
/**
 * Map each subagent's agentId to the tool_use id that launched it, so a
 * task-notification carrying only a task-id can still be routed to its turn.
 */
export function getTaskIdToToolUseId(
  subagentTranscriptsByToolUseId?: Record<string, SubagentTranscript>
): Record<string, string> {
  const taskIdToToolUseId: Record<string, string> = {};
  if (!subagentTranscriptsByToolUseId) {
    return taskIdToToolUseId;
  }
  for (const [toolUseId, subagent] of Object.entries(subagentTranscriptsByToolUseId)) {
    const agentId = subagent.agentId;
    if (typeof agentId === "string" && agentId) {
      taskIdToToolUseId[agentId] = toolUseId;
    }
  }
  return taskIdToToolUseId;
}

function findPendingAgentTurn(sessionState: SessionState, toolUseId: string): PendingAgentTurn | null {
  for (const pendingTurn of sessionState.pendingAgentTurns) {
    // Notifications can arrive more than once per tool_use_id, so ids that
    // already resolved keep matching until the whole turn is done.
    if (pendingTurn.pendingToolUseIds.includes(toolUseId) || pendingTurn.resolvedToolUseIds.includes(toolUseId)) {
      return pendingTurn;
    }
  }
  return null;
}

function routeToPendingTurn(pendingTurn: PendingAgentTurn, row: Row, toolUseId: string): void {
  pendingTurn.rows.push(row);
  const idx = pendingTurn.pendingToolUseIds.indexOf(toolUseId);
  if (idx >= 0) {
    pendingTurn.pendingToolUseIds.splice(idx, 1);
    pendingTurn.resolvedToolUseIds.push(toolUseId);
  }
}

/**
 * Move task-notification rows from the batch to their deferred turns.
 *
 * Deferred rows are never spliced into the batch (a user row mid-batch would
 * cut the current turn in half); resolved turns are returned for isolated
 * assembly. Notifications that cannot be attributed yet (task-id-only, subagent
 * meta.json not on disk) are stashed and retried on later runs.
 */
export function resolveDeferredAgentTurns(
  rows: Row[],
  sessionState: SessionState,
  taskIdToToolUseId?: Record<string, string>
): [Row[][], Row[]] {
  const remainingRows: Row[] = [];
  const stashedNotifications: Row[] = [];

  // Retry stashed notifications from earlier runs first (they are older than
  // anything in the batch); their task-id may resolve now.
  for (const row of sessionState.pendingTaskNotifications) {
    const toolUseId = getToolUseIdForTaskNotification(row, taskIdToToolUseId);
    if (toolUseId === null) {
      stashedNotifications.push(row);
      continue;
    }
    const pendingTurn = findPendingAgentTurn(sessionState, toolUseId);
    if (pendingTurn === null) {
      debug(`Dropping stashed task notification for ${toolUseId}: no deferred turn waits for it`);
      continue;
    }
    routeToPendingTurn(pendingTurn, row, toolUseId);
  }

  for (const row of rows) {
    if (!isTaskNotificationRow(row)) {
      remainingRows.push(row);
      continue;
    }
    const toolUseId = getToolUseIdForTaskNotification(row, taskIdToToolUseId);
    if (toolUseId === null) {
      // Unattributable yet — stash for a later run when the meta.json exists.
      stashedNotifications.push(row);
      continue;
    }
    const pendingTurn = findPendingAgentTurn(sessionState, toolUseId);
    if (pendingTurn === null) {
      // No waiting turn — leave it in the batch for normal assembly.
      remainingRows.push(row);
      continue;
    }
    routeToPendingTurn(pendingTurn, row, toolUseId);
  }

  sessionState.pendingTaskNotifications = stashedNotifications.slice(-MAX_PENDING_TASK_NOTIFICATIONS);

  // Pop fully resolved turns in deferral (i.e. chronological) order.
  const resolvedTurnRowLists: Row[][] = [];
  const stillPending: PendingAgentTurn[] = [];
  for (const pendingTurn of sessionState.pendingAgentTurns) {
    if (pendingTurn.pendingToolUseIds.length > 0) {
      stillPending.push(pendingTurn);
    } else {
      resolvedTurnRowLists.push(pendingTurn.rows);
    }
  }
  sessionState.pendingAgentTurns = stillPending;

  return [resolvedTurnRowLists, remainingRows];
}

export function popAllDeferredAgentTurnRowLists(sessionState: SessionState): Row[][] {
  const rowLists = sessionState.pendingAgentTurns.filter((t) => t.rows.length > 0).map((t) => t.rows);
  sessionState.pendingAgentTurns = [];
  return rowLists;
}

export function getPendingAgentToolUseIds(turn: Turn): string[] {
  const toolUseIds: string[] = [];
  for (const assistantMessage of turn.assistantMsgs) {
    for (const toolUseBlock of getToolUseBlocks(getContentFromRow(assistantMessage))) {
      if (toolUseBlock.name !== "Agent" && toolUseBlock.name !== "Task") {
        continue;
      }
      const toolUseId = String(toolUseBlock.id || "");
      if (!toolUseId) {
        continue;
      }
      const toolResultEntry = turn.toolResultsById[toolUseId];
      // Already resolved by a task-notification (final content present).
      if (toolResultEntry?.finalContent != null) {
        continue;
      }
      // Defer only explicit async launches: sync agents also write a subagent
      // transcript but never notify, so deferring on transcript existence would
      // strand their turns.
      if (isAsyncAgentLaunchResult(toolResultEntry)) {
        toolUseIds.push(toolUseId);
      }
    }
  }
  return toolUseIds;
}

export function getTurnsToEmit(turns: Turn[], sessionState: SessionState, flushDeferredAgentTurns = false): Turn[] {
  const turnsToEmit: Turn[] = [];
  for (const turn of turns) {
    const pendingAgentToolUseIds = getPendingAgentToolUseIds(turn);
    if (pendingAgentToolUseIds.length === 0) {
      turnsToEmit.push(turn);
      continue;
    }
    if (flushDeferredAgentTurns) {
      debug(`Emitting async agent turn without task notification: ${pendingAgentToolUseIds}`);
      turnsToEmit.push(turn);
      continue;
    }
    sessionState.pendingAgentTurns.push({
      pendingToolUseIds: pendingAgentToolUseIds,
      resolvedToolUseIds: [],
      rows: turn.rows,
    });
    debug(`Deferred agent turn until task notification: ${pendingAgentToolUseIds}`);
  }
  return turnsToEmit;
}
