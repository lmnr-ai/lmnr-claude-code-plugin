"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/hook.ts
var fs6 = __toESM(require("node:fs"), 1);
var path6 = __toESM(require("node:path"), 1);

// src/config.ts
var fs = __toESM(require("node:fs"), 1);
var os = __toESM(require("node:os"), 1);
var path = __toESM(require("node:path"), 1);
var env = (name) => process.env[name] ?? "";
var nonEmpty = (v) => typeof v === "string" ? v : "";
var DEBUG = env("CC_LMNR_DEBUG").toLowerCase() === "true";
var CAPTURE_SKILL_CONTENT = env("CC_LMNR_CAPTURE_SKILL_CONTENT").toLowerCase() === "true";
var MAX_CHARS = Number.parseInt(env("CC_LMNR_MAX_CHARS"), 10) || 2e4;
var EXPORT_TIMEOUT_MS = 5e3;
function lmnrConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, "lmnr");
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "lmnr");
  }
  return path.join(os.homedir(), ".config", "lmnr");
}
function readJsonObject(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf-8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
function getLaminarConfig() {
  const plugin = readJsonObject(path.join(lmnrConfigDir(), "claude-code-plugin.json"));
  const apiKey = env("LMNR_PROJECT_API_KEY") || nonEmpty(plugin.projectApiKey);
  if (!apiKey) {
    return null;
  }
  const baseUrl = (env("LMNR_BASE_URL") || nonEmpty(plugin.baseUrl) || "https://api.lmnr.ai").replace(/\/+$/, "");
  const creds = readJsonObject(path.join(lmnrConfigDir(), "credentials.json"));
  const userId = env("LMNR_USER_ID") || nonEmpty(creds.userEmail) || nonEmpty(creds.userId) || null;
  return { apiKey, baseUrl, userId };
}
function stateDir() {
  return env("CC_LMNR_STATE_DIR") || path.join(os.homedir(), ".claude", "state");
}
var LOG_MAX_BYTES = 5e6;
function writeLog(level, msg) {
  try {
    const file = path.join(stateDir(), "lmnr_hook.log");
    fs.mkdirSync(stateDir(), { recursive: true });
    try {
      if (fs.statSync(file).size > LOG_MAX_BYTES) {
        fs.renameSync(file, `${file}.1`);
      }
    } catch {
    }
    fs.appendFileSync(file, `${(/* @__PURE__ */ new Date()).toISOString()} [${level}] ${msg}
`, "utf-8");
  } catch {
  }
}
function debug(msg) {
  if (DEBUG) {
    writeLog("DEBUG", msg);
  }
}
function info(msg) {
  writeLog("INFO", msg);
}

// src/pipeline.ts
var fs5 = __toESM(require("node:fs"), 1);

// src/otlp.ts
var crypto = __toESM(require("node:crypto"), 1);
var hex = (bytes) => crypto.randomBytes(bytes).toString("hex");
function normalizeId(value, len) {
  if (typeof value !== "string") {
    return null;
  }
  let id = value.trim().replace(/-/g, "").toLowerCase();
  if (len === 16 && id.length === 32) {
    id = id.slice(16);
  }
  return new RegExp(`^[0-9a-f]{${len}}$`).test(id) && !/^0+$/.test(id) ? id : null;
}
function parentFromEnv() {
  const raw = process.env.LMNR_SPAN_CONTEXT?.trim();
  if (!raw) {
    return null;
  }
  try {
    const ctx = JSON.parse(raw);
    const traceId = normalizeId(ctx?.traceId ?? ctx?.trace_id, 32);
    const spanId = normalizeId(ctx?.spanId ?? ctx?.span_id, 16);
    if (traceId && spanId) {
      return { traceId, spanId };
    }
  } catch {
  }
  debug("Ignoring invalid LMNR_SPAN_CONTEXT");
  return null;
}
function setAttributes(span, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== void 0) {
      span.attributes[key] = value;
    }
  }
}
function endSpan(span, endMs) {
  span.endMs = Math.max(span.startMs, endMs ?? span.startMs);
}
var Tracer = class {
  spans = [];
  remoteParent = parentFromEnv();
  /** Start a span under `parent`, or as a turn root (under LMNR_SPAN_CONTEXT if set). */
  start(name, startMs, attrs, parent) {
    const p = parent ?? this.remoteParent;
    const start = startMs ?? Date.now();
    const span = { traceId: p?.traceId ?? hex(16), spanId: hex(8), name, startMs: start, endMs: start, attributes: {} };
    if (p) {
      span.parentSpanId = p.spanId;
    }
    setAttributes(span, attrs);
    this.spans.push(span);
    return span;
  }
};
function attrValue(v) {
  if (typeof v === "string") {
    return { stringValue: v };
  }
  if (typeof v === "boolean") {
    return { boolValue: v };
  }
  return Number.isInteger(v) ? { intValue: v } : { doubleValue: v };
}
var toAttributes = (attrs) => Object.entries(attrs).map(([key, value]) => ({ key, value: attrValue(value) }));
var nanos = (ms) => (BigInt(Math.round(ms)) * 1000000n).toString();
function toOtlpJson(spans) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: toAttributes({
            "service.name": "claude-code",
            "telemetry.sdk.language": "nodejs",
            "telemetry.sdk.name": "lmnr-claude-code-plugin"
          }),
          droppedAttributesCount: 0
        },
        scopeSpans: [
          {
            scope: { name: "lmnr.claude_code" },
            spans: spans.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId,
              name: s.name,
              kind: 1,
              // INTERNAL
              startTimeUnixNano: nanos(s.startMs),
              endTimeUnixNano: nanos(s.endMs),
              attributes: toAttributes(s.attributes),
              droppedAttributesCount: 0,
              events: [],
              droppedEventsCount: 0,
              status: { code: 1 },
              // OK
              links: [],
              droppedLinksCount: 0
            }))
          }
        ]
      }
    ]
  };
}
var MAX_BATCH_BYTES = 4 * 1024 * 1024;
var spanBytes = (span) => Buffer.byteLength(JSON.stringify(span.attributes)) + 512;
async function exportSpans(config, spans) {
  if (spans.length === 0) {
    return true;
  }
  try {
    const res = await fetch(`${config.baseUrl}/v1/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(toOtlpJson(spans)),
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS)
    });
    if (res.ok) {
      debug(`OTLP export: ${spans.length} span(s)`);
      return true;
    }
    info(`OTLP export failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 500)}`);
    return false;
  } catch (e) {
    info(`OTLP export failed: ${e}`);
    return false;
  }
}

// src/render.ts
var path4 = __toESM(require("node:path"), 1);

// src/transcript.ts
var fs2 = __toESM(require("node:fs"), 1);
var path2 = __toESM(require("node:path"), 1);
function contentOf(row) {
  return typeof row.message === "object" && row.message !== null ? row.message.content : row.content;
}
function roleOf(row) {
  if (row.type === "user" || row.type === "assistant") {
    return row.type;
  }
  const role = row.message?.role;
  return role === "user" || role === "assistant" ? role : null;
}
function textOf(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((b) => typeof b === "string" ? b : b?.type === "text" ? b.text || "" : "").filter(Boolean).join("\n");
}
function blocksOf(content, type) {
  return Array.isArray(content) ? content.filter((b) => b?.type === type) : [];
}
function tsOf(value) {
  const raw = typeof value === "object" && value !== null ? value.timestamp : value;
  if (typeof raw !== "string" || !raw) {
    return null;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}
function truncate(s, maxChars = MAX_CHARS) {
  return s ? s.slice(0, maxChars) : "";
}
function isToolResult(row) {
  return roleOf(row) === "user" && blocksOf(contentOf(row), "tool_result").length > 0;
}
function isPrompt(row) {
  return roleOf(row) === "user" && !row.isMeta && !isToolResult(row) && !isTaskNotification(row);
}
function notificationText(row) {
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
function xmlTag(text, tag) {
  const open = text.indexOf(`<${tag}>`);
  if (open < 0) {
    return null;
  }
  const close = text.indexOf(`</${tag}>`, open);
  return close < 0 ? null : text.slice(open + tag.length + 2, close);
}
var isTaskNotification = (row) => notificationText(row) !== null;
function notificationToolUseId(row, taskIds) {
  const text = notificationText(row);
  if (text === null) {
    return null;
  }
  const toolUseId = xmlTag(text, "tool-use-id")?.trim();
  if (toolUseId) {
    return toolUseId;
  }
  const taskId = xmlTag(text, "task-id")?.trim();
  return taskId && taskIds[taskId] || null;
}
function notificationResult(row) {
  const text = notificationText(row) ?? "";
  return xmlTag(text, "result") ?? text;
}
function readLines(file, from = 0) {
  let buf;
  try {
    const fd = fs2.openSync(file, "r");
    try {
      const size = fs2.fstatSync(fd).size;
      buf = Buffer.alloc(Math.max(0, size - from));
      if (buf.length > 0) {
        fs2.readSync(fd, buf, 0, buf.length, from);
      }
    } finally {
      fs2.closeSync(fd);
    }
  } catch (e) {
    info(`transcript read failed (${file}): ${e}`);
    return { lines: [], end: from };
  }
  const lines = [];
  let end = from;
  let start = 0;
  while (start < buf.length) {
    const nl = buf.indexOf(10, start);
    const stop = nl < 0 ? buf.length : nl;
    const text = buf.toString("utf-8", start, stop).trim();
    let row = null;
    if (text) {
      try {
        row = JSON.parse(text);
      } catch {
        if (nl < 0) {
          break;
        }
      }
    }
    if (typeof row === "object" && row !== null && !Array.isArray(row)) {
      lines.push({ row, offset: from + start });
    }
    start = nl < 0 ? buf.length : nl + 1;
    end = from + start;
  }
  return { lines, end };
}
function findSubagents(transcriptPath) {
  const dir = path2.join(path2.dirname(transcriptPath), path2.basename(transcriptPath, path2.extname(transcriptPath)), "subagents");
  let names;
  try {
    names = fs2.readdirSync(dir);
  } catch {
    return {};
  }
  const out = {};
  for (const name of names) {
    if (!name.endsWith(".meta.json")) {
      continue;
    }
    const stem = name.slice(0, -".meta.json".length);
    const jsonl = path2.join(dir, `${stem}.jsonl`);
    let meta;
    try {
      meta = JSON.parse(fs2.readFileSync(path2.join(dir, name), "utf-8"));
    } catch {
      continue;
    }
    if (typeof meta?.toolUseId !== "string" || !meta.toolUseId || !fs2.existsSync(jsonl)) {
      continue;
    }
    out[meta.toolUseId] = {
      path: jsonl,
      agentId: stem.replace(/^agent-/, ""),
      agentType: meta.agentType,
      description: meta.description
    };
  }
  return out;
}
function taskIdMap(subagents) {
  return Object.fromEntries(Object.entries(subagents).map(([toolUseId, s]) => [s.agentId, toolUseId]));
}

// src/genai.ts
var USAGE_KEYS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
var MAX_INPUT_BYTES = 2 * 1024 * 1024;
function boundedHistoryJson(history) {
  const json = JSON.stringify(history);
  if (Buffer.byteLength(json) <= MAX_INPUT_BYTES || history.length < 2) {
    return json;
  }
  const sizes = history.map((m) => Buffer.byteLength(JSON.stringify(m)) + 1);
  let budget = MAX_INPUT_BYTES - sizes[0] - 100;
  let keepFrom = history.length;
  while (keepFrom > 1 && sizes[keepFrom - 1] <= budget) {
    budget -= sizes[--keepFrom];
  }
  const note = { role: "user", content: [{ type: "text", text: `[${keepFrom - 1} earlier messages omitted]` }] };
  return JSON.stringify([history[0], note, ...history.slice(keepFrom)]);
}
function truncateStrings(value) {
  if (typeof value === "string") {
    return truncate(value);
  }
  if (Array.isArray(value)) {
    return value.map(truncateStrings);
  }
  if (typeof value === "object" && value !== null) {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = truncateStrings(inner);
    }
    return out;
  }
  return value;
}
function toAnthropicBlock(block) {
  if (typeof block === "string") {
    return block ? { type: "text", text: truncate(block) } : null;
  }
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return null;
  }
  switch (block.type) {
    case "text":
      return block.text ? { type: "text", text: truncate(String(block.text)) } : null;
    case "thinking":
      return block.thinking ? { type: "thinking", thinking: truncate(String(block.thinking)) } : null;
    case "redacted_thinking":
      return { type: "redacted_thinking", data: "" };
    case "tool_use":
      return { type: "tool_use", id: String(block.id ?? ""), name: String(block.name ?? ""), input: truncateStrings(block.input ?? {}) };
    case "tool_result":
      return toolResultBlock(String(block.tool_use_id ?? ""), block.content, block.is_error === true);
    case "image":
      return { type: "text", text: "[image]" };
    case "document":
      return { type: "text", text: "[document]" };
    default:
      return truncateStrings(block);
  }
}
function toAnthropicContent(content) {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.map(toAnthropicBlock).filter((b) => b !== null);
}
function toolResultBlock(toolUseId, content, isError) {
  const block = {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: typeof content === "string" ? truncate(content) : toAnthropicContent(content ?? "")
  };
  if (isError) {
    block.is_error = true;
  }
  return block;
}
function buildUserMessage(userRow) {
  return { role: "user", content: toAnthropicContent(contentOf(userRow)) };
}
function buildGenerationAttributes(history, assistantMessage, toolDefinitions = null) {
  const content = contentOf(assistantMessage);
  const toolUses = blocksOf(content, "tool_use");
  const outputMessage = { role: "assistant", content: toAnthropicContent(content) };
  const model = assistantMessage.message?.model || "claude";
  const attrs = {
    "gen_ai.system": "anthropic",
    "gen_ai.request.model": model,
    "gen_ai.response.model": model,
    "gen_ai.input.messages": boundedHistoryJson(history)
  };
  if (toolDefinitions !== null && toolDefinitions.length > 0) {
    attrs["gen_ai.tool.definitions"] = JSON.stringify(toolDefinitions);
  }
  const stopReason = assistantMessage.message?.stop_reason;
  attrs["gen_ai.output.messages"] = JSON.stringify([
    typeof stopReason === "string" ? { ...outputMessage, stop_reason: stopReason } : outputMessage
  ]);
  const usage = assistantMessage.message?.usage ?? {};
  let total = 0;
  for (const key of USAGE_KEYS) {
    const value = usage[key];
    if (Number.isInteger(value) && value > 0) {
      attrs[`gen_ai.usage.${key}`] = value;
      total += value;
    }
  }
  if (total > 0) {
    attrs["llm.usage.total_tokens"] = total;
  }
  return [attrs, toolUses, outputMessage];
}

// src/tools.ts
var crypto2 = __toESM(require("node:crypto"), 1);
var fs3 = __toESM(require("node:fs"), 1);
var path3 = __toESM(require("node:path"), 1);
var MAX_TOOL_SET_CHANGES = 100;
var TOOL_SET_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1e3;
function toolSetDir() {
  return path3.join(stateDir(), "lmnr_tool_sets");
}
function toToolDefinition(entry) {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry) || typeof entry.name !== "string") {
    return null;
  }
  const tool = { name: entry.name };
  if (typeof entry.description === "string") {
    tool.description = entry.description;
  }
  const schema = entry.input_schema ?? entry.schema;
  if (typeof schema === "object" && schema !== null) {
    tool.input_schema = schema;
  }
  return tool;
}
function toToolDefinitions(entries) {
  return Array.isArray(entries) ? entries.map(toToolDefinition).filter((t) => t !== null) : [];
}
var ToolTimeline = class _ToolTimeline {
  changes;
  persist;
  sets = /* @__PURE__ */ new Map();
  current = { inline: [], deferred: [] };
  /** `persist` stores new sets for later runs; a subagent's timeline is rebuilt each run. */
  constructor(changes = [], persist = true) {
    this.changes = changes.slice(-MAX_TOOL_SET_CHANGES);
    this.persist = persist;
    const last = this.changes[this.changes.length - 1];
    if (last) {
      this.current = this.load(last.hash) ?? this.current;
    }
  }
  /** Build an in-memory timeline from a whole transcript (a subagent's). */
  static fromRows(rows) {
    const timeline = new _ToolTimeline([], false);
    for (const row of rows) {
      timeline.observe(row);
    }
    return timeline;
  }
  /** Record the tool set a transcript row announces, if it announces one. */
  observe(row) {
    const attachment = row.type === "attachment" ? row.attachment : null;
    if (typeof attachment !== "object" || attachment === null || typeof row.timestamp !== "string") {
      return;
    }
    if (attachment.type === "prompt_snapshot" && Array.isArray(attachment.tools)) {
      this.record(row.timestamp, { ...this.current, inline: toToolDefinitions(attachment.tools) });
    } else if (attachment.type === "deferred_tools_record" && Array.isArray(attachment.entries)) {
      const deferred = new Map(this.current.deferred.map((t) => [t.name, t]));
      for (const tool of toToolDefinitions(attachment.entries)) {
        deferred.set(tool.name, tool);
      }
      const sorted = [...deferred.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      this.record(row.timestamp, { ...this.current, deferred: sorted });
    }
  }
  /**
   * Tools in effect at `timestamp`. Before the first recorded set, that set: the
   * first request records none but was sent the same tools.
   */
  toolsAt(timestamp) {
    if (this.changes.length === 0) {
      return null;
    }
    let change = this.changes[0];
    if (typeof timestamp === "string") {
      for (const c of this.changes) {
        if (c.timestamp <= timestamp) {
          change = c;
        }
      }
    }
    const set = this.load(change.hash);
    if (set === null) {
      return null;
    }
    const tools = [...set.inline, ...set.deferred];
    return tools.length > 0 ? tools : null;
  }
  record(timestamp, set) {
    this.current = set;
    const hash = crypto2.createHash("sha256").update(JSON.stringify(set), "utf-8").digest("hex");
    this.sets.set(hash, set);
    if (this.changes[this.changes.length - 1]?.hash === hash) {
      return;
    }
    this.changes.push({ timestamp, hash });
    this.changes = this.changes.slice(-MAX_TOOL_SET_CHANGES);
    if (this.persist) {
      saveToolSet(hash, set);
    }
  }
  load(hash) {
    const cached = this.sets.get(hash);
    if (cached) {
      return cached;
    }
    if (!this.persist) {
      return null;
    }
    try {
      const raw = JSON.parse(fs3.readFileSync(path3.join(toolSetDir(), `${hash}.json`), "utf-8"));
      const set = { inline: toToolDefinitions(raw.inline), deferred: toToolDefinitions(raw.deferred) };
      this.sets.set(hash, set);
      return set;
    } catch (e) {
      debug(`tool set ${hash.slice(0, 12)} unavailable: ${e}`);
      return null;
    }
  }
};
function saveToolSet(hash, set) {
  try {
    const dir = toolSetDir();
    fs3.mkdirSync(dir, { recursive: true });
    const file = path3.join(dir, `${hash}.json`);
    if (fs3.existsSync(file)) {
      const now = /* @__PURE__ */ new Date();
      fs3.utimesSync(file, now, now);
      return;
    }
    fs3.writeFileSync(file, JSON.stringify(set), "utf-8");
    const cutoff = Date.now() - TOOL_SET_MAX_AGE_MS;
    for (const name of fs3.readdirSync(dir)) {
      const other = path3.join(dir, name);
      if (fs3.statSync(other).mtimeMs < cutoff) {
        fs3.rmSync(other, { force: true });
      }
    }
  } catch (e) {
    debug(`saveToolSet failed: ${e}`);
  }
}
function coerceToolSetChanges(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (c) => typeof c === "object" && c !== null && typeof c.timestamp === "string" && typeof c.hash === "string"
  );
}

// src/turns.ts
function splitTurns(lines) {
  const turns = [];
  for (const line of lines) {
    if (isPrompt(line.row)) {
      turns.push({ start: line.offset, lines: [line] });
    } else if (turns.length > 0) {
      turns[turns.length - 1].lines.push(line);
    }
  }
  return turns;
}
var toolUsesOf = (row) => roleOf(row) === "assistant" ? blocksOf(contentOf(row), "tool_use") : [];
function routeNotifications(turns, taskIds) {
  const owner = /* @__PURE__ */ new Map();
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
      const target = id ? owner.get(id) : void 0;
      if (!target || target === turn) {
        return true;
      }
      target.lines.push(line);
      target.lines.sort((a, b) => a.offset - b.offset);
      return false;
    });
  }
}
function isAsyncLaunch(row, block) {
  const marker = row.toolUseResult;
  if (typeof marker === "object" && marker !== null) {
    return marker.status === "async_launched" || marker.isAsync === true;
  }
  const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
  return text.includes("Async agent launched successfully") || text.includes("agentId:") && text.includes("output_file:") && text.includes("You will be notified automatically");
}
function pendingAgents(turn, taskIds) {
  const agentIds = /* @__PURE__ */ new Set();
  const launched = /* @__PURE__ */ new Set();
  const notified = /* @__PURE__ */ new Set();
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
function isIncomplete(turn, finalAssistantText) {
  let replies = [];
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
  return want !== "" && !replies.some((row) => {
    const text = textOf(contentOf(row)).trim();
    return text !== "" && want.endsWith(text);
  });
}

// src/render.ts
var ASSOC = "lmnr.association.properties";
function maxTs(...values) {
  let max = null;
  for (const v of values) {
    if (typeof v === "number" && (max === null || v > max)) {
      max = v;
    }
  }
  return max;
}
var nonEmpty2 = (v) => typeof v === "string" && v ? v : void 0;
var hasReply = (turn) => turn.lines.some((l) => roleOf(l.row) === "assistant");
function mergeAssistantRows(rows) {
  const last = rows[rows.length - 1] ?? {};
  const content = [];
  for (const row of rows) {
    const c = row.message?.content;
    if (Array.isArray(c)) {
      content.push(...c);
    } else if (typeof c === "string" && c) {
      content.push({ type: "text", text: c });
    }
  }
  return { ...last, message: { ...last.message ?? {}, content } };
}
function readConversation(rows, taskIds) {
  const c = { entries: [], results: /* @__PURE__ */ new Map(), notifiedAt: /* @__PURE__ */ new Map(), toolUseTs: /* @__PURE__ */ new Map(), skillContent: /* @__PURE__ */ new Map() };
  const assistants = /* @__PURE__ */ new Map();
  const toolOrder = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (roleOf(row) === "assistant") {
      for (const b of blocksOf(contentOf(row), "tool_use")) {
        toolOrder.set(String(b.id), toolOrder.size);
      }
    }
  }
  const lastReport = /* @__PURE__ */ new Map();
  rows.forEach((row, i) => {
    const id = notificationToolUseId(row, taskIds);
    if (id && toolOrder.has(id)) {
      lastReport.set(id, i);
    }
  });
  const input = (ts) => {
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
        assistants.set(id, group = []);
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
function renderConversation(ctx, parent, rows, prefix, startTs) {
  const c = readConversation(rows, ctx.taskIds);
  const history = [];
  let inputTs = startTs;
  let end = startTs;
  let last = null;
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
function toolInput(toolUse) {
  const raw = toolUse.input;
  if (typeof raw === "string") {
    return truncate(raw);
  }
  return raw !== null && ["object", "number", "boolean"].includes(typeof raw) ? raw : {};
}
function toolOutputText(raw) {
  return truncate(typeof raw === "string" ? raw : JSON.stringify(Array.isArray(raw) ? toAnthropicContent(raw) : raw));
}
function renderTool(ctx, parent, c, toolUse, assistantTs) {
  const id = String(toolUse.id || "");
  const name = toolUse.name || "unknown";
  const start = c.toolUseTs.get(id) ?? assistantTs;
  const result = c.results.get(id);
  const subagent = ctx.subagents[id];
  const span = ctx.tracer.start(
    name,
    start,
    {
      "lmnr.span.type": "TOOL",
      "lmnr.span.input": JSON.stringify(toolInput(toolUse)),
      "claude_code.tool.name": name,
      "claude_code.tool.id": id,
      "claude_code.subagent.type": nonEmpty2(subagent?.agentType),
      "claude_code.subagent.description": nonEmpty2(subagent?.description)
    },
    parent
  );
  let output = result ? toolOutputText(result.content) : null;
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
function subagentReport(message) {
  const content = message ? contentOf(message) : "";
  const text = textOf(content);
  if (text) {
    return text;
  }
  const handback = blocksOf(content, "tool_use").find((b) => b.name === "SubagentHandback" && typeof b.input?.message === "string");
  return handback?.input.message ?? "";
}
function renderSubagent(ctx, parent, subagent, startTs) {
  const { lines } = readLines(subagent.path);
  const first = lines.findIndex((l) => roleOf(l.row) === "user");
  const lead = [];
  if (first >= 0 && !isPrompt(lines[first].row)) {
    const next = lines.findIndex((l, i) => i > first && isPrompt(l.row));
    lead.push({ start: lines[first].offset, lines: lines.slice(first, next < 0 ? void 0 : next) });
  }
  const turns = [...lead, ...splitTurns(lines)].filter(hasReply);
  if (turns.length === 0) {
    return startTs;
  }
  const sub = {
    tracer: ctx.tracer,
    subagents: Object.fromEntries(Object.entries(ctx.subagents).filter(([, s]) => s.path !== subagent.path)),
    taskIds: {},
    tools: ToolTimeline.fromRows(lines.map((l) => l.row))
  };
  const prompt = turns[0].lines[0].row;
  const start = startTs ?? tsOf(prompt);
  const span = ctx.tracer.start(
    subagent.description ? `Subagent: ${subagent.description}` : "Subagent",
    start,
    {
      "lmnr.span.type": "DEFAULT",
      "lmnr.span.input": JSON.stringify({ role: "user", content: truncate(textOf(contentOf(prompt))) }),
      "claude_code.subagent.type": nonEmpty2(subagent.agentType)
    },
    parent
  );
  let end = start;
  let last = null;
  for (const turn of turns) {
    const r = renderConversation(sub, span, turn.lines.map((l) => l.row), "Subagent LLM Call", end);
    end = maxTs(end, r.end);
    last = r.last ?? last;
  }
  setAttributes(span, { "lmnr.span.output": JSON.stringify({ role: "assistant", content: truncate(subagentReport(last)) }) });
  endSpan(span, end);
  return end;
}
function shortSessionLabel(sessionId, maxLen = 12) {
  const sid = sessionId.trim();
  if (!sid) {
    return "unknown";
  }
  const parts = sid.split("-");
  if (parts.length === 5 && parts[0].length === 8) {
    return parts[0];
  }
  return sid.length <= maxLen ? sid : sid.slice(0, maxLen).replace(/-+$/, "");
}
function rootAttributes(config, sessionId, turnNum, rows, transcriptPath) {
  const prompt = rows[0];
  const skills = /* @__PURE__ */ new Set();
  for (const row of rows) {
    if (roleOf(row) === "assistant") {
      for (const b of blocksOf(contentOf(row), "tool_use")) {
        if (b.name === "Skill" && nonEmpty2(b.input?.skill)) {
          skills.add(b.input.skill);
        }
      }
    }
  }
  return {
    "lmnr.span.type": "DEFAULT",
    "lmnr.span.input": JSON.stringify({ role: "user", content: truncate(textOf(contentOf(prompt))) }),
    [`${ASSOC}.session_id`]: sessionId,
    [`${ASSOC}.user_id`]: config.userId,
    [`${ASSOC}.metadata.source`]: "claude-code",
    [`${ASSOC}.metadata.turn_number`]: String(turnNum),
    [`${ASSOC}.metadata.transcript`]: path4.basename(transcriptPath),
    [`${ASSOC}.metadata.os`]: process.platform,
    [`${ASSOC}.metadata.skills`]: skills.size > 0 ? [...skills].join(",") : null,
    [`${ASSOC}.metadata.cwd`]: nonEmpty2(prompt.cwd),
    [`${ASSOC}.metadata.git_branch`]: nonEmpty2(prompt.gitBranch),
    [`${ASSOC}.metadata.claude_code_version`]: nonEmpty2(prompt.version)
  };
}
function renderTurn(ctx, config, sessionId, turnNum, turn, transcriptPath) {
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

// src/state.ts
var crypto3 = __toESM(require("node:crypto"), 1);
var fs4 = __toESM(require("node:fs"), 1);
var path5 = __toESM(require("node:path"), 1);
var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1e3;
var LOCK_WAIT_MS = 1e4;
var LOCK_STALE_MS = 3e4;
var sessionsDir = () => path5.join(stateDir(), "lmnr_sessions");
function sessionKey(sessionId, transcriptPath) {
  return crypto3.createHash("sha256").update(`${sessionId}::${transcriptPath}`, "utf-8").digest("hex");
}
function emptyState() {
  return { offset: 0, exported: [], turnCount: 0, toolsScannedTo: 0, toolSetChanges: [] };
}
var num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
function fromJson(raw) {
  return {
    offset: num(raw.offset),
    exported: Array.isArray(raw.exported) ? raw.exported.filter((x) => typeof x === "number") : [],
    turnCount: num(raw.turnCount),
    toolsScannedTo: num(raw.toolsScannedTo),
    toolSetChanges: coerceToolSetChanges(raw.toolSetChanges)
  };
}
function loadState(key, transcriptPath) {
  const file = path5.join(sessionsDir(), `${key}.json`);
  if (fs4.existsSync(file)) {
    return fromJson(readJsonObject(file));
  }
  pruneOldSessions();
  return migrateLegacyState(key, transcriptPath) ?? emptyState();
}
function saveState(key, state) {
  try {
    fs4.mkdirSync(sessionsDir(), { recursive: true });
    const file = path5.join(sessionsDir(), `${key}.json`);
    fs4.writeFileSync(`${file}.tmp`, JSON.stringify(state), "utf-8");
    fs4.renameSync(`${file}.tmp`, file);
  } catch (e) {
    info(`saveState failed: ${e}; already-exported turns may be re-emitted on the next hook run`);
  }
}
function pruneOldSessions() {
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const name of fs4.readdirSync(sessionsDir())) {
      const file = path5.join(sessionsDir(), name);
      if (fs4.statSync(file).mtimeMs < cutoff) {
        fs4.rmSync(file, { force: true });
      }
    }
  } catch {
  }
}
async function withSessionLock(key, fn) {
  const lock = path5.join(sessionsDir(), `${key}.lock`);
  try {
    fs4.mkdirSync(sessionsDir(), { recursive: true });
  } catch {
    return fn();
  }
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (; ; ) {
    try {
      fs4.closeSync(fs4.openSync(lock, "wx"));
      break;
    } catch (e) {
      if (e?.code !== "EEXIST") {
        return fn();
      }
    }
    try {
      if (Date.now() - fs4.statSync(lock).mtimeMs > LOCK_STALE_MS) {
        fs4.rmSync(lock, { force: true });
        continue;
      }
    } catch {
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error("session state lock timeout");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  try {
    return await fn();
  } finally {
    fs4.rmSync(lock, { force: true });
  }
}
function migrateLegacyState(key, transcriptPath) {
  const legacy = readJsonObject(path5.join(stateDir(), "lmnr_state.json"))[key];
  if (typeof legacy !== "object" || legacy === null) {
    return null;
  }
  const readTo = num(legacy.offset) - Buffer.byteLength(typeof legacy.buffer === "string" ? legacy.buffer : "", "utf-8");
  const held = [
    ...Array.isArray(legacy.pendingAgentTurns) ? legacy.pendingAgentTurns.map((t) => t?.rows?.[0]) : [],
    Array.isArray(legacy.pendingTurnRows) ? legacy.pendingTurnRows[0] : void 0
  ];
  const heldUuids = new Set(held.map((r) => r?.uuid).filter((u) => typeof u === "string"));
  const state = {
    ...emptyState(),
    offset: Math.max(0, readTo),
    turnCount: num(legacy.turnCount),
    toolsScannedTo: Math.max(0, readTo),
    toolSetChanges: coerceToolSetChanges(legacy.toolSetChanges)
  };
  if (heldUuids.size > 0) {
    const prompts = readLines(transcriptPath).lines.filter((l) => l.offset < readTo && isPrompt(l.row));
    const firstHeld = prompts.find((l) => heldUuids.has(l.row.uuid));
    if (firstHeld) {
      state.offset = firstHeld.offset;
      state.exported = prompts.filter((l) => l.offset > firstHeld.offset && !heldUuids.has(l.row.uuid)).map((l) => l.offset);
    }
  }
  info(`migrated legacy state for session ${key.slice(0, 12)}: resuming at byte ${state.offset}`);
  return state;
}

// src/pipeline.ts
var MAX_REREAD_BYTES = 2e7;
async function exportInBatches(config, turnSpans, exportFn) {
  let batch = [];
  let bytes = 0;
  let sent = 0;
  let queued = 0;
  const flush = async () => {
    const ok = batch.length === 0 || await exportFn(config, batch);
    batch = [];
    bytes = 0;
    return ok;
  };
  for (const spans of turnSpans) {
    for (const span of spans) {
      const size = spanBytes(span);
      if (batch.length > 0 && bytes + size > MAX_BATCH_BYTES) {
        if (!await flush()) {
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
  return await flush() ? sent + queued : sent;
}
function fileSize(file) {
  try {
    return fs5.statSync(file).size;
  } catch {
    return 0;
  }
}
async function processTranscript(config, sessionId, transcriptPath, opts = {}) {
  const { sessionEnd = false, finalAssistantText = "", exportFn = exportSpans, renderFn = renderTurn } = opts;
  const key = sessionKey(sessionId, transcriptPath);
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
    const handled = [];
    const ready = [];
    let waitingFrom = null;
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
    const ctx = { tracer, subagents, taskIds, tools };
    const rendered = [];
    for (const turn of ready) {
      const mark = tracer.spans.length;
      try {
        renderFn(ctx, config, sessionId, state.turnCount + rendered.length + 1, turn, transcriptPath);
        rendered.push({ turn, spans: tracer.spans.slice(mark) });
      } catch (e) {
        tracer.spans.length = mark;
        info(`renderTurn failed: ${e}`);
      }
    }
    const sent = await exportInBatches(config, rendered.map((r) => r.spans), exportFn);
    const failedAt = sent < rendered.length ? rendered[sent].turn.start : null;
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
      toolSetChanges: tools.changes
    });
    return sent;
  });
}

// src/hook.ts
function readPayload() {
  try {
    const payload = JSON.parse(fs6.readFileSync(0, "utf-8"));
    return typeof payload === "object" && payload !== null ? payload : {};
  } catch (e) {
    debug(`unreadable hook payload: ${e}`);
    return {};
  }
}
async function main() {
  const start = Date.now();
  const config = getLaminarConfig();
  if (config === null) {
    return;
  }
  const payload = readPayload();
  const sessionId = payload.session_id;
  const transcriptPath = payload.transcript_path;
  if (typeof sessionId !== "string" || !sessionId || typeof transcriptPath !== "string" || !fs6.existsSync(transcriptPath)) {
    debug(`missing session_id or transcript (${transcriptPath}); nothing to do`);
    return;
  }
  const count = await processTranscript(config, sessionId, path6.resolve(transcriptPath), {
    sessionEnd: payload.hook_event_name === "SessionEnd",
    finalAssistantText: typeof payload.last_assistant_message === "string" ? payload.last_assistant_message : ""
  });
  info(`Processed ${count} turns in ${((Date.now() - start) / 1e3).toFixed(2)}s (session=${sessionId})`);
}
main().catch((e) => debug(`Unexpected failure: ${e}`)).finally(() => process.exit(0));
