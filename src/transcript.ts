/**
 * Claude Code transcript access: row helpers, offset-aware reading, task
 * notifications, subagent discovery. Rows are Claude Code's internal JSON.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { info, MAX_CHARS } from "./config.js";

export type Row = Record<string, any>;

export function contentOf(row: Row): any {
  return typeof row.message === "object" && row.message !== null ? row.message.content : row.content;
}

export function roleOf(row: Row): "user" | "assistant" | null {
  if (row.type === "user" || row.type === "assistant") {
    return row.type;
  }
  const role = row.message?.role;
  return role === "user" || role === "assistant" ? role : null;
}

/** The text blocks of a content value, joined. */
export function textOf(content: any): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((b) => (typeof b === "string" ? b : b?.type === "text" ? b.text || "" : ""))
    .filter(Boolean)
    .join("\n");
}

export function blocksOf(content: any, type: string): Row[] {
  return Array.isArray(content) ? content.filter((b) => b?.type === type) : [];
}

/** A row's timestamp (or a timestamp string) in epoch ms, else null. */
export function tsOf(value: any): number | null {
  const raw = typeof value === "object" && value !== null ? value.timestamp : value;
  if (typeof raw !== "string" || !raw) {
    return null;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

export function truncate(s: string | null | undefined, maxChars = MAX_CHARS): string {
  return s ? s.slice(0, maxChars) : "";
}

export function isToolResult(row: Row): boolean {
  return roleOf(row) === "user" && blocksOf(contentOf(row), "tool_result").length > 0;
}

/** A real user prompt: what starts a turn (not injected context, a tool result, or a notification). */
export function isPrompt(row: Row): boolean {
  return roleOf(row) === "user" && !row.isMeta && !isToolResult(row) && !isTaskNotification(row);
}

// A finished background task reaches the model as <task-notification> XML: a user
// row when idle, else a `queued_command` attachment. `queue-operation` rows carry
// the same XML but are bookkeeping written before the model sees it; they don't count.
function notificationText(row: Row): string | null {
  if (row.type === "attachment") {
    const a = row.attachment;
    const isNotification = a?.type === "queued_command" && (a.commandMode === "task-notification" || a.origin?.kind === "task-notification");
    return isNotification && typeof a.prompt === "string" ? a.prompt : null;
  }
  if (roleOf(row) !== "user") {
    return null;
  }
  const text = textOf(contentOf(row));
  return row.origin?.kind === "task-notification" || text.trimStart().startsWith("<task-notification>") ? text : null;
}

function xmlTag(text: string, tag: string): string | null {
  const open = text.indexOf(`<${tag}>`);
  if (open < 0) {
    return null;
  }
  const close = text.indexOf(`</${tag}>`, open);
  return close < 0 ? null : text.slice(open + tag.length + 2, close);
}

export const isTaskNotification = (row: Row): boolean => notificationText(row) !== null;

/** The tool_use a notification resolves: its tool-use-id, else its task id via `taskIds`. */
export function notificationToolUseId(row: Row, taskIds: Record<string, string>): string | null {
  const text = notificationText(row);
  if (text === null) {
    return null;
  }
  const toolUseId = xmlTag(text, "tool-use-id")?.trim();
  if (toolUseId) {
    return toolUseId;
  }
  const taskId = xmlTag(text, "task-id")?.trim();
  return (taskId && taskIds[taskId]) || null;
}

export function notificationResult(row: Row): string {
  const text = notificationText(row) ?? "";
  return xmlTag(text, "result") ?? text;
}

/** A parsed transcript row and the byte offset its line starts at. */
export interface Line {
  row: Row;
  offset: number;
}

/**
 * Rows from byte `from` to EOF, and where the next read resumes. A final line with
 * no newline counts if it parses (a partially written row never does).
 */
export function readLines(file: string, from = 0): { lines: Line[]; end: number } {
  let buf: Buffer;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      buf = Buffer.alloc(Math.max(0, size - from));
      if (buf.length > 0) {
        fs.readSync(fd, buf, 0, buf.length, from);
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    info(`transcript read failed (${file}): ${e}`);
    return { lines: [], end: from };
  }

  const lines: Line[] = [];
  let end = from;
  let start = 0;
  while (start < buf.length) {
    const nl = buf.indexOf(0x0a, start);
    const stop = nl < 0 ? buf.length : nl;
    const text = buf.toString("utf-8", start, stop).trim();
    let row: unknown = null;
    if (text) {
      try {
        row = JSON.parse(text);
      } catch {
        if (nl < 0) {
          break; // partially written final line: resume here next time
        }
      }
    }
    if (typeof row === "object" && row !== null && !Array.isArray(row)) {
      lines.push({ row: row as Row, offset: from + start });
    }
    start = nl < 0 ? buf.length : nl + 1;
    end = from + start;
  }
  return { lines, end };
}

export interface SubagentTranscript {
  path: string;
  agentId: string;
  agentType?: string;
  description?: string;
}

/**
 * Subagent transcripts: `<stem>/subagents/agent-<id>.jsonl`, each with a `.meta.json`
 * naming the launching tool_use. Nested subagents share the directory.
 */
export function findSubagents(transcriptPath: string): Record<string, SubagentTranscript> {
  const dir = path.join(path.dirname(transcriptPath), path.basename(transcriptPath, path.extname(transcriptPath)), "subagents");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return {};
  }
  const out: Record<string, SubagentTranscript> = {};
  for (const name of names) {
    if (!name.endsWith(".meta.json")) {
      continue;
    }
    const stem = name.slice(0, -".meta.json".length);
    const jsonl = path.join(dir, `${stem}.jsonl`);
    let meta: Row;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
    } catch {
      continue;
    }
    if (typeof meta?.toolUseId !== "string" || !meta.toolUseId || !fs.existsSync(jsonl)) {
      continue;
    }
    out[meta.toolUseId] = {
      path: jsonl,
      agentId: stem.replace(/^agent-/, ""),
      agentType: meta.agentType,
      description: meta.description,
    };
  }
  return out;
}

/** agentId → launching tool_use id, so a task-id-only notification can be attributed. */
export function taskIdMap(subagents: Record<string, SubagentTranscript>): Record<string, string> {
  return Object.fromEntries(Object.entries(subagents).map(([toolUseId, s]) => [s.agentId, toolUseId]));
}
