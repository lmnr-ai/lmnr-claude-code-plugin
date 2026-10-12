/**
 * Which tool definitions each generation was offered, from Claude Code's internal
 * `prompt_snapshot` / `deferred_tools_record` rows. They are written only when the
 * set changes, so the timeline persists across runs. Unknown shapes are skipped.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { debug, stateDir } from "./config.js";
import type { Row } from "./transcript.js";

/** From `timestamp` on, the tool set stored under `hash` is in effect. */
export interface ToolSetChange {
  timestamp: string;
  hash: string;
}

interface ToolSet {
  inline: Row[];
  deferred: Row[];
}

// A session's tool set rarely changes; this only bounds a pathological one.
const MAX_TOOL_SET_CHANGES = 100;
const TOOL_SET_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function toolSetDir(): string {
  return path.join(stateDir(), "lmnr_tool_sets");
}

/** An Anthropic tool definition from either row's entry shape, or null. */
function toToolDefinition(entry: any): Row | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry) || typeof entry.name !== "string") {
    return null;
  }
  const tool: Row = { name: entry.name };
  if (typeof entry.description === "string") {
    tool.description = entry.description;
  }
  const schema = entry.input_schema ?? entry.schema;
  if (typeof schema === "object" && schema !== null) {
    tool.input_schema = schema;
  }
  return tool;
}

function toToolDefinitions(entries: any): Row[] {
  return Array.isArray(entries) ? entries.map(toToolDefinition).filter((t): t is Row => t !== null) : [];
}

export class ToolTimeline {
  changes: ToolSetChange[];
  private readonly persist: boolean;
  private readonly sets = new Map<string, ToolSet>();
  private current: ToolSet = { inline: [], deferred: [] };

  /** `persist` stores new sets for later runs; a subagent's timeline is rebuilt each run. */
  constructor(changes: ToolSetChange[] = [], persist = true) {
    this.changes = changes.slice(-MAX_TOOL_SET_CHANGES);
    this.persist = persist;
    const last = this.changes[this.changes.length - 1];
    if (last) {
      this.current = this.load(last.hash) ?? this.current;
    }
  }

  /** Build an in-memory timeline from a whole transcript (a subagent's). */
  static fromRows(rows: Row[]): ToolTimeline {
    const timeline = new ToolTimeline([], false);
    for (const row of rows) {
      timeline.observe(row);
    }
    return timeline;
  }

  /** Record the tool set a transcript row announces, if it announces one. */
  observe(row: Row): void {
    const attachment = row.type === "attachment" ? row.attachment : null;
    if (typeof attachment !== "object" || attachment === null || typeof row.timestamp !== "string") {
      return;
    }
    if (attachment.type === "prompt_snapshot" && Array.isArray(attachment.tools)) {
      this.record(row.timestamp, { ...this.current, inline: toToolDefinitions(attachment.tools) });
    } else if (attachment.type === "deferred_tools_record" && Array.isArray(attachment.entries)) {
      const deferred = new Map(this.current.deferred.map((t) => [t.name as string, t]));
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
  toolsAt(timestamp: any): Row[] | null {
    if (this.changes.length === 0) {
      return null;
    }
    let change = this.changes[0]!;
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

  private record(timestamp: string, set: ToolSet): void {
    this.current = set;
    const hash = crypto.createHash("sha256").update(JSON.stringify(set), "utf-8").digest("hex");
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

  private load(hash: string): ToolSet | null {
    const cached = this.sets.get(hash);
    if (cached) {
      return cached;
    }
    if (!this.persist) {
      return null;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(toolSetDir(), `${hash}.json`), "utf-8"));
      const set: ToolSet = { inline: toToolDefinitions(raw.inline), deferred: toToolDefinitions(raw.deferred) };
      this.sets.set(hash, set);
      return set;
    } catch (e) {
      debug(`tool set ${hash.slice(0, 12)} unavailable: ${e}`);
      return null;
    }
  }
}

/** Store a tool set once by hash, pruning sets unused for 30 days. Fail-open. */
function saveToolSet(hash: string, set: ToolSet): void {
  try {
    const dir = toolSetDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${hash}.json`);
    if (fs.existsSync(file)) {
      const now = new Date();
      fs.utimesSync(file, now, now); // still in use: keep it from being pruned
      return;
    }
    fs.writeFileSync(file, JSON.stringify(set), "utf-8");
    const cutoff = Date.now() - TOOL_SET_MAX_AGE_MS;
    for (const name of fs.readdirSync(dir)) {
      const other = path.join(dir, name);
      if (fs.statSync(other).mtimeMs < cutoff) {
        fs.rmSync(other, { force: true });
      }
    }
  } catch (e) {
    debug(`saveToolSet failed: ${e}`);
  }
}

export function coerceToolSetChanges(value: unknown): ToolSetChange[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (c): c is ToolSetChange =>
      typeof c === "object" && c !== null && typeof c.timestamp === "string" && typeof c.hash === "string"
  );
}
