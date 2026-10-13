/**
 * Turn → spans: a root per turn, an LLM span per assistant message, a tool span
 * per tool_use, and subagents nested under the tool span that launched them.
 */
import * as path from "node:path";
import { CAPTURE_SKILL_CONTENT, type LaminarConfig } from "./config.js";
import { buildGenerationAttributes, buildUserMessage, toAnthropicContent, toolResultBlock } from "./genai.js";
import { endSpan, setAttributes, type Attrs, type Span, type Tracer } from "./otlp.js";
import { ToolTimeline } from "./tools.js";
import {
  blocksOf,
  contentOf,
  isTaskNotification,
  isPrompt,
  isToolResult,
  notificationResult,
  notificationToolUseId,
  readLines,
  roleOf,
  textOf,
  truncate,
  tsOf,
  type Row,
  type SubagentTranscript,
} from "./transcript.js";
import { splitTurns, type Turn } from "./turns.js";

const ASSOC = "lmnr.association.properties";

export interface RenderContext {
  tracer: Tracer;
  subagents: Record<string, SubagentTranscript>; // keyed by launching tool_use id
  taskIds: Record<string, string>; // agentId → tool_use id
  tools: ToolTimeline | null;
}

function maxTs(...values: (number | null | undefined)[]): number | null {
  let max: number | null = null;
  for (const v of values) {
    if (typeof v === "number" && (max === null || v > max)) {
      max = v;
    }
  }
  return max;
}

const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export const hasReply = (turn: Turn): boolean => turn.lines.some((l) => roleOf(l.row) === "assistant");

/** Merge the rows Claude Code split one assistant message into (same message.id). */
export function mergeAssistantRows(rows: Row[]): Row {
  const last = rows[rows.length - 1] ?? {};
  const content: any[] = [];
  for (const row of rows) {
    const c = row.message?.content;
    if (Array.isArray(c)) {
      content.push(...c);
    } else if (typeof c === "string" && c) {
      content.push({ type: "text", text: c });
    }
  }
  return { ...last, message: { ...(last.message ?? {}), content } };
}

/**
 * What the model got between two assistant messages (tool results in call order,
 * then background reports, then other user messages), or one assistant message.
 */
type Entry =
  | { kind: "input"; results: Row[]; reports: Row[]; messages: Row[]; ts: number | null }
  | { kind: "assistant"; rows: Row[] };

interface Conversation {
  entries: Entry[];
  results: Map<string, { content: any; ts: number | null }>; // tool_use id → its tool_result
  notifiedAt: Map<string, number | null>; // tool_use id → when its background task reported back
  toolUseTs: Map<string, number | null>;
  skillContent: Map<string, string>; // tool_use id → skill instructions Claude Code injected for it
}

/** Read a turn's rows (prompt first) into the message sequence the model saw. */
function readConversation(rows: Row[], taskIds: Record<string, string>): Conversation {
  const c: Conversation = { entries: [], results: new Map(), notifiedAt: new Map(), toolUseTs: new Map(), skillContent: new Map() };
  const assistants = new Map<string, Row[]>();
  const toolOrder = new Map<string, number>(); // tool_use id → call position in the turn
  for (const row of rows) {
    if (roleOf(row) === "assistant") {
      for (const b of blocksOf(contentOf(row), "tool_use")) {
        toolOrder.set(String(b.id), toolOrder.size);
      }
    }
  }
  // A task can be reported more than once; its last report counts.
  const lastReport = new Map<string, number>();
  rows.forEach((row, i) => {
    const id = notificationToolUseId(row, taskIds);
    if (id && toolOrder.has(id)) {
      lastReport.set(id, i);
    }
  });
  const input = (ts: number | null) => {
    let entry = c.entries[c.entries.length - 1];
    if (entry?.kind !== "input") {
      entry = { kind: "input", results: [], reports: [], messages: [], ts: null };
      c.entries.push(entry);
    }
    entry.ts = maxTs(entry.ts, ts);
    return entry;
  };

  rows.forEach((row, i) => {
    const ts = tsOf(row);
    if (i === 0) {
      input(ts).messages.push(buildUserMessage(row));
    } else if (row.isMeta) {
      // Skill instructions belong to their Skill call; other injected context is model input.
      const text = textOf(contentOf(row));
      if (text && row.sourceToolUseID) {
        c.skillContent.set(String(row.sourceToolUseID), text);
      } else if (text) {
        input(ts).messages.push(buildUserMessage(row));
      }
    } else if (isToolResult(row)) {
      for (const b of blocksOf(contentOf(row), "tool_result")) {
        if (b.tool_use_id) {
          c.results.set(String(b.tool_use_id), { content: b.content, ts });
          input(ts).results.push(toolResultBlock(String(b.tool_use_id), b.content, b.is_error === true));
        }
      }
    } else if (isTaskNotification(row)) {
      const id = notificationToolUseId(row, taskIds);
      if (id && lastReport.get(id) === i) {
        c.notifiedAt.set(id, ts);
        input(ts).reports.push(toolResultBlock(id, notificationResult(row), false));
      }
    } else if (roleOf(row) === "assistant") {
      const id = row.message?.id || `noid:${i}`;
      let group = assistants.get(id);
      if (!group) {
        assistants.set(id, (group = []));
        c.entries.push({ kind: "assistant", rows: group });
      }
      group.push(row);
      for (const toolUse of blocksOf(contentOf(row), "tool_use")) {
        if (!c.toolUseTs.has(String(toolUse.id))) {
          c.toolUseTs.set(String(toolUse.id), ts);
        }
      }
    }
  });
  for (const entry of c.entries) {
    if (entry.kind === "input") {
      entry.results.sort((x, y) => (toolOrder.get(x.tool_use_id) ?? 0) - (toolOrder.get(y.tool_use_id) ?? 0));
    }
  }
  return c;
}

/**
 * Emit a turn's LLM and tool spans under `parent`; an LLM span starts when its last
 * input arrived. Returns the latest end time and the last assistant message.
 */
function renderConversation(
  ctx: RenderContext,
  parent: Span,
  rows: Row[],
  prefix: string,
  startTs: number | null
): { end: number | null; last: Row | null } {
  const c = readConversation(rows, ctx.taskIds);
  const history: Row[] = [];
  let inputTs = startTs;
  let end = startTs;
  let last: Row | null = null;
  let n = 0;
  for (const entry of c.entries) {
    if (entry.kind === "input") {
      const results = [...entry.results, ...entry.reports];
      if (results.length > 0) {
        history.push({ role: "user", content: results });
      }
      history.push(...entry.messages);
      if (n > 0) {
        inputTs = maxTs(inputTs, entry.ts);
      }
      continue;
    }
    const message = mergeAssistantRows(entry.rows);
    const ts = tsOf(message);
    const [attrs, toolUses, output] = buildGenerationAttributes(history, message, ctx.tools?.toolsAt(message.timestamp) ?? null);
    history.push(output);
    const generation = ctx.tracer.start(`${prefix} ${++n}`, inputTs ?? ts, { "lmnr.span.type": "LLM", ...attrs }, parent);
    endSpan(generation, ts ?? generation.startMs);
    end = maxTs(end, generation.endMs);
    for (const toolUse of toolUses) {
      end = maxTs(end, renderTool(ctx, parent, c, toolUse, ts));
    }
    inputTs = ts ?? inputTs;
    last = message;
  }
  return { end, last };
}

function toolInput(toolUse: Row): any {
  const raw = toolUse.input;
  if (typeof raw === "string") {
    return truncate(raw);
  }
  return raw !== null && ["object", "number", "boolean"].includes(typeof raw) ? raw : {};
}

/** A tool result as span output; block arrays get the LLM-message bounds (images → markers). */
function toolOutputText(raw: any): string {
  return truncate(typeof raw === "string" ? raw : JSON.stringify(Array.isArray(raw) ? toAnthropicContent(raw) : raw));
}

function renderTool(ctx: RenderContext, parent: Span, c: Conversation, toolUse: Row, assistantTs: number | null): number | null {
  const id = String(toolUse.id || "");
  const name = toolUse.name || "unknown";
  const start = c.toolUseTs.get(id) ?? assistantTs;
  const result = c.results.get(id);
  const subagent = ctx.subagents[id];

  // Plain span attributes, never lmnr.association.properties.metadata.*: that
  // propagates to the whole trace, so per-tool values would clobber each other.
  const span = ctx.tracer.start(
    name,
    start,
    {
      "lmnr.span.type": "TOOL",
      "lmnr.span.input": JSON.stringify(toolInput(toolUse)),
      "claude_code.tool.name": name,
      "claude_code.tool.id": id,
      "claude_code.subagent.type": nonEmpty(subagent?.agentType),
      "claude_code.subagent.description": nonEmpty(subagent?.description),
    },
    parent
  );
  let output: any = result ? toolOutputText(result.content) : null;
  const skill = c.skillContent.get(id);
  if (CAPTURE_SKILL_CONTENT && skill) {
    output = { result: output, injected_instructions: truncate(skill) };
  }
  if (output !== null) {
    setAttributes(span, { "lmnr.span.output": JSON.stringify(output) });
  }
  const subagentEnd = subagent ? renderSubagent(ctx, span, subagent, start) : null;
  endSpan(span, maxTs(result?.ts, c.notifiedAt.get(id), subagentEnd, start));
  return span.endMs;
}

/** A subagent's report: its last text, or its SubagentHandback message. */
function subagentReport(message: Row | null): string {
  const content = message ? contentOf(message) : "";
  const text = textOf(content);
  if (text) {
    return text;
  }
  const handback = blocksOf(content, "tool_use").find((b) => b.name === "SubagentHandback" && typeof b.input?.message === "string");
  return handback?.input.message ?? "";
}

function renderSubagent(ctx: RenderContext, parent: Span, subagent: SubagentTranscript, startTs: number | null): number | null {
  const { lines } = readLines(subagent.path);
  // A forked subagent has no plain prompt: its first user row is the tool_result
  // that hands it the fork instructions. That row opens its first turn.
  const first = lines.findIndex((l) => roleOf(l.row) === "user");
  const lead: Turn[] = [];
  if (first >= 0 && !isPrompt(lines[first]!.row)) {
    const next = lines.findIndex((l, i) => i > first && isPrompt(l.row));
    lead.push({ start: lines[first]!.offset, lines: lines.slice(first, next < 0 ? undefined : next) });
  }
  const turns = [...lead, ...splitTurns(lines)].filter(hasReply);
  if (turns.length === 0) {
    return startTs;
  }
  // A subagent has its own tool set; dropping its own entry keeps nested lookups from looping back.
  const sub: RenderContext = {
    tracer: ctx.tracer,
    subagents: Object.fromEntries(Object.entries(ctx.subagents).filter(([, s]) => s.path !== subagent.path)),
    taskIds: {},
    tools: ToolTimeline.fromRows(lines.map((l) => l.row)),
  };
  const prompt = turns[0]!.lines[0]!.row;
  const start = startTs ?? tsOf(prompt);
  const span = ctx.tracer.start(
    subagent.description ? `Subagent: ${subagent.description}` : "Subagent",
    start,
    {
      "lmnr.span.type": "DEFAULT",
      "lmnr.span.input": JSON.stringify({ role: "user", content: truncate(textOf(contentOf(prompt))) }),
      "claude_code.subagent.type": nonEmpty(subagent.agentType),
    },
    parent
  );
  let end = start;
  let last: Row | null = null;
  for (const turn of turns) {
    const r = renderConversation(sub, span, turn.lines.map((l) => l.row), "Subagent LLM Call", end);
    end = maxTs(end, r.end);
    last = r.last ?? last;
  }
  setAttributes(span, { "lmnr.span.output": JSON.stringify({ role: "assistant", content: truncate(subagentReport(last)) }) });
  endSpan(span, end);
  return end;
}

/** A compact session label for trace names: a UUID's first group. */
export function shortSessionLabel(sessionId: string, maxLen = 12): string {
  const sid = sessionId.trim();
  if (!sid) {
    return "unknown";
  }
  const parts = sid.split("-");
  if (parts.length === 5 && parts[0]!.length === 8) {
    return parts[0]!;
  }
  return sid.length <= maxLen ? sid : sid.slice(0, maxLen).replace(/-+$/, "");
}

function rootAttributes(config: LaminarConfig, sessionId: string, turnNum: number, rows: Row[], transcriptPath: string): Attrs {
  const prompt = rows[0]!;
  const skills = new Set<string>();
  for (const row of rows) {
    if (roleOf(row) === "assistant") {
      for (const b of blocksOf(contentOf(row), "tool_use")) {
        if (b.name === "Skill" && nonEmpty(b.input?.skill)) {
          skills.add(b.input.skill);
        }
      }
    }
  }
  // Trace-constant context only; per-span details stay on span attributes.
  return {
    "lmnr.span.type": "DEFAULT",
    "lmnr.span.input": JSON.stringify({ role: "user", content: truncate(textOf(contentOf(prompt))) }),
    [`${ASSOC}.session_id`]: sessionId,
    [`${ASSOC}.user_id`]: config.userId,
    [`${ASSOC}.metadata.source`]: "claude-code",
    [`${ASSOC}.metadata.turn_number`]: String(turnNum),
    [`${ASSOC}.metadata.transcript`]: path.basename(transcriptPath),
    [`${ASSOC}.metadata.os`]: process.platform,
    [`${ASSOC}.metadata.skills`]: skills.size > 0 ? [...skills].join(",") : null,
    [`${ASSOC}.metadata.cwd`]: nonEmpty(prompt.cwd),
    [`${ASSOC}.metadata.git_branch`]: nonEmpty(prompt.gitBranch),
    [`${ASSOC}.metadata.claude_code_version`]: nonEmpty(prompt.version),
  };
}

export function renderTurn(
  ctx: RenderContext,
  config: LaminarConfig,
  sessionId: string,
  turnNum: number,
  turn: Turn,
  transcriptPath: string
): void {
  const rows = turn.lines.map((l) => l.row);
  const promptTs = tsOf(rows[0]);
  const root = ctx.tracer.start(
    `Claude Code - Turn ${turnNum} (${shortSessionLabel(sessionId)})`,
    promptTs,
    rootAttributes(config, sessionId, turnNum, rows, transcriptPath)
  );
  const { end, last } = renderConversation(ctx, root, rows, "LLM Call", promptTs);
  setAttributes(root, { "lmnr.span.output": JSON.stringify({ role: "assistant", content: truncate(textOf(last ? contentOf(last) : "")) }) });
  endSpan(root, maxTs(end, promptTs));
}
