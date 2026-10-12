import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LaminarConfig } from "../src/config.js";
import type { Span } from "../src/otlp.js";
import { processTranscript, type RunOptions } from "../src/pipeline.js";
import { sessionKey, type SessionState } from "../src/state.js";
import type { Row } from "../src/transcript.js";

export function userRow(text: any, ts = "2026-07-08T10:00:00.000Z", extra: Row = {}): Row {
  return {
    type: "user",
    message: { role: "user", content: text },
    timestamp: ts,
    ...extra,
  };
}

export function assistantRow(
  content: any,
  {
    msgId = "msg_1",
    ts = "2026-07-08T10:00:05.000Z",
    model = "claude-opus-4-7",
  }: { msgId?: string; ts?: string; model?: string } = {}
): Row {
  return {
    type: "assistant",
    message: {
      id: msgId,
      role: "assistant",
      model,
      content,
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    timestamp: ts,
  };
}

export function toolResultRow(toolUseId: string, content: any, ts = "2026-07-08T10:00:10.000Z", extra: Row = {}): Row {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
    timestamp: ts,
    ...extra,
  };
}

export function notificationRow(inner: string, ts = "2026-07-08T10:05:00.000Z"): Row {
  return userRow(`<task-notification>${inner}</task-notification>`, ts);
}

/** Claude Code's internal record of the inline tools sent with a request. */
export function promptSnapshotRow(tools: any[] | null, ts: string): Row {
  return { type: "attachment", attachment: { type: "prompt_snapshot", systemPrompt: ["…"], tools }, timestamp: ts };
}

/** Claude Code's internal record of deferred tools ToolSearch has loaded. */
export function deferredToolsRow(entries: any[], ts: string): Row {
  return { type: "attachment", attachment: { type: "deferred_tools_record", entries }, timestamp: ts };
}

export const jsonl = (rows: Row[]): string => rows.map((r) => JSON.stringify(r) + "\n").join("");

export function spansByName(spans: Span[]): Record<string, Span> {
  return Object.fromEntries(spans.map((s) => [s.name, s]));
}

export const SESSION_ID = "0123abcd-0000-4000-8000-000000000000";
export const ROOT = "Claude Code - Turn 1 (0123abcd)";

export interface RunResult {
  count: number;
  spans: Span[];
}

/**
 * A Claude Code session on disk: its transcript, subagent transcripts, and the
 * plugin's state dir (CC_LMNR_STATE_DIR points here while the session is used).
 */
export class TestSession {
  readonly dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-test-"));
  readonly transcript = path.join(this.dir, "session.jsonl");
  config: LaminarConfig = { apiKey: "k", baseUrl: "http://localhost:1", userId: null };

  constructor(rows: Row[] = []) {
    process.env.CC_LMNR_STATE_DIR = path.join(this.dir, "state");
    fs.writeFileSync(this.transcript, jsonl(rows));
  }

  append(rows: Row[]): this {
    fs.appendFileSync(this.transcript, jsonl(rows));
    return this;
  }

  /** Write a subagent transcript launched by tool_use `toolUseId`. */
  subagent(agentId: string, toolUseId: string, rows: Row[], meta: Row = {}): string {
    const dir = path.join(this.dir, "session", "subagents");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `agent-${agentId}.jsonl`);
    fs.writeFileSync(file, jsonl(rows));
    fs.writeFileSync(path.join(dir, `agent-${agentId}.meta.json`), JSON.stringify({ toolUseId, ...meta }));
    return file;
  }

  /** One hook run; spans are what its successful export requests carried. */
  async run(opts: RunOptions & { exportOk?: boolean } = {}): Promise<RunResult> {
    process.env.CC_LMNR_STATE_DIR = path.join(this.dir, "state");
    const spans: Span[] = [];
    const count = await processTranscript(this.config, SESSION_ID, this.transcript, {
      exportFn: async (_config, batch) => {
        if (opts.exportOk === false) {
          return false;
        }
        spans.push(...batch);
        return true;
      },
      ...opts,
    });
    return { count, spans };
  }

  stop(finalAssistantText = "", opts: RunOptions & { exportOk?: boolean } = {}): Promise<RunResult> {
    return this.run({ finalAssistantText, ...opts });
  }

  end(opts: RunOptions & { exportOk?: boolean } = {}): Promise<RunResult> {
    return this.run({ sessionEnd: true, ...opts });
  }

  state(): SessionState | null {
    const file = path.join(this.dir, "state", "lmnr_sessions", `${sessionKey(SESSION_ID, this.transcript)}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : null;
  }

  cleanup(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Render a complete session in one SessionEnd run. */
export async function render(rows: Row[], setup?: (s: TestSession) => void): Promise<Record<string, Span> & { all: Span[] }> {
  const session = new TestSession(rows);
  try {
    setup?.(session);
    const { spans } = await session.end();
    return Object.assign(spansByName(spans), { all: spans });
  } finally {
    session.cleanup();
  }
}

export const attr = (span: Span | undefined, key: string): any => span?.attributes[key];
export const json = (span: Span | undefined, key: string): any => JSON.parse(String(span?.attributes[key]));
