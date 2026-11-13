/**
 * A turn: a user prompt and every row up to the next one, including Claude's
 * replies to a background agent that reports back before the next prompt.
 */
import {
  blocksOf,
  contentOf,
  isPrompt,
  isToolResult,
  notificationToolUseId,
  roleOf,
  textOf,
  type Line,
  type Row,
} from "./transcript.js";

export interface Turn {
  start: number; // byte offset of the prompt row: the turn's identity across hook runs
  lines: Line[]; // in transcript order, prompt first
}

export function splitTurns(lines: Line[]): Turn[] {
  const turns: Turn[] = [];
  for (const line of lines) {
    if (isPrompt(line.row)) {
      turns.push({ start: line.offset, lines: [line] });
    } else if (turns.length > 0) {
      turns[turns.length - 1]!.lines.push(line);
    }
  }
  return turns;
}

const toolUsesOf = (row: Row): Row[] => (roleOf(row) === "assistant" ? blocksOf(contentOf(row), "tool_use") : []);

/** Move a task-notification that landed after the next prompt into the turn that launched the task. */
export function routeNotifications(turns: Turn[], taskIds: Record<string, string>): void {
  const owner = new Map<string, Turn>();
  for (const turn of turns) {
    for (const { row } of turn.lines) {
      for (const toolUse of toolUsesOf(row)) {
        owner.set(String(toolUse.id), turn);
      }
    }
  }
  for (const turn of turns) {
    turn.lines = turn.lines.filter((line) => {
      const id = notificationToolUseId(line.row, taskIds);
      const target = id ? owner.get(id) : undefined;
      if (!target || target === turn) {
        return true;
      }
      target.lines.push(line);
      target.lines.sort((a, b) => a.offset - b.offset);
      return false;
    });
  }
}

/** Whether a tool_result row reports an agent launched in the background. */
function isAsyncLaunch(row: Row, block: Row): boolean {
  // The structured marker; launch text only on older versions (text also matches quotes of it).
  const marker = row.toolUseResult;
  if (typeof marker === "object" && marker !== null) {
    return marker.status === "async_launched" || marker.isAsync === true;
  }
  const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
  return (
    text.includes("Async agent launched successfully") ||
    (text.includes("agentId:") && text.includes("output_file:") && text.includes("You will be notified automatically"))
  );
}

/** Background agents this turn launched that haven't reported back (no task-notification yet). */
export function pendingAgents(turn: Turn, taskIds: Record<string, string>): string[] {
  const agentIds = new Set<string>();
  const launched = new Set<string>();
  const notified = new Set<string>();
  for (const { row } of turn.lines) {
    for (const toolUse of toolUsesOf(row)) {
      if (toolUse.name === "Agent" || toolUse.name === "Task") {
        agentIds.add(String(toolUse.id));
      }
    }
    if (isToolResult(row)) {
      for (const block of blocksOf(contentOf(row), "tool_result")) {
        if (agentIds.has(String(block.tool_use_id)) && isAsyncLaunch(row, block)) {
          launched.add(String(block.tool_use_id));
        }
      }
    }
    const notifiedId = notificationToolUseId(row, taskIds);
    if (notifiedId) {
      notified.add(notifiedId);
    }
  }
  return [...launched].filter((id) => !notified.has(id));
}

/**
 * Whether the transcript lacks this last turn's end yet (Stop fires before the
 * final row is written): no reply, a trailing tool_result, or no row since the
 * last tool_result ending the Stop payload's `last_assistant_message`.
 */
export function isIncomplete(turn: Turn, finalAssistantText: string): boolean {
  let replies: Row[] = [];
  for (const { row } of turn.lines) {
    if (isToolResult(row)) {
      replies = [];
    } else if (roleOf(row) === "assistant") {
      replies.push(row);
    }
  }
  if (replies.length === 0) {
    return true;
  }
  const want = finalAssistantText.trim();
  return (
    want !== "" &&
    !replies.some((row) => {
      const text = textOf(contentOf(row)).trim();
      return text !== "" && want.endsWith(text);
    })
  );
}
