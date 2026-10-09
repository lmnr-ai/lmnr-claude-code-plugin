import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";

// Keep the plugin's log/state out of the real ~/.claude/state during tests.
const BASELINE_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-testlog-"));
process.env.CC_LMNR_STATE_DIR = BASELINE_STATE_DIR;

import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";

import type { LaminarConfig } from "../src/config.js";
import { emitTurn } from "../src/emit.js";
import { emitNewTurnsFromTranscript, emitReadyTurns } from "../src/pipeline.js";
import {
  getSessionState,
  getSessionStateKey,
  loadHookState,
  SessionState,
} from "../src/state.js";
import type { SubagentTranscript } from "../src/subagents.js";
import { TraceEmitter } from "../src/tracer.js";
import { buildTurns, type Turn } from "../src/turns.js";
import { assistantRow, spansByName, toolResultRow, userRow } from "./helpers.js";

function makeEmitter(userId: string | null = null): TraceEmitter {
  const config: LaminarConfig = { apiKey: "k", baseUrl: "http://localhost:1", userId };
  return new TraceEmitter(config);
}

function attrs(span: ReadableSpan): Record<string, any> {
  return span.attributes;
}

function hrToNs(hr: [number, number]): bigint {
  return BigInt(hr[0]) * 1_000_000_000n + BigInt(hr[1]);
}

describe("OTLP format", () => {
  it("ids are valid hex", () => {
    const emitter = makeEmitter();
    const turns = buildTurns([userRow("hello"), assistantRow([{ type: "text", text: "hi" }])]);
    emitTurn(emitter, emitter.config, "sess", 1, turns[0]!, "/tmp/session.jsonl");
    const span = emitter.spans[0]!;
    assert.match(span.spanContext().traceId, /^[0-9a-f]{32}$/);
    assert.match(span.spanContext().spanId, /^[0-9a-f]{16}$/);
  });

  it("uses LMNR_SPAN_CONTEXT as the parent for Claude Code turn roots", () => {
    const parentTraceId = "12345678-1234-5678-9abc-def012345678";
    const parentSpanId = "00000000-0000-0000-89ab-cdef01234567";
    process.env.LMNR_SPAN_CONTEXT = JSON.stringify({ traceId: parentTraceId, spanId: parentSpanId });
    try {
      const emitter = makeEmitter();
      const turns = buildTurns([userRow("hello"), assistantRow([{ type: "text", text: "hi" }])]);
      emitTurn(emitter, emitter.config, "0123abcd-0000-4000-8000-000000000000", 1, turns[0]!, "/tmp/session.jsonl");

      const byName = spansByName(emitter.spans);
      const root = byName["Claude Code - Turn 1 (0123abcd)"]!;
      const llm = byName["LLM Call 1"]!;
      assert.equal(root.spanContext().traceId, parentTraceId.replace(/-/g, ""));
      assert.equal(root.parentSpanId, "89abcdef01234567");
      assert.equal(llm.spanContext().traceId, root.spanContext().traceId);
      assert.equal(llm.parentSpanId, root.spanContext().spanId);

      const bytes = JsonTraceSerializer.serializeRequest(emitter.spans);
      const payload = JSON.parse(Buffer.from(bytes!).toString("utf-8"));
      const wireSpans = payload.resourceSpans[0].scopeSpans[0].spans;
      const wireRoot = wireSpans.find((s: any) => s.name === "Claude Code - Turn 1 (0123abcd)");
      assert.equal(wireRoot.traceId, parentTraceId.replace(/-/g, ""));
      assert.equal(wireRoot.parentSpanId, "89abcdef01234567");
    } finally {
      delete process.env.LMNR_SPAN_CONTEXT;
    }
  });

  it("wire-format envelope (camelCase, intValue string, arrayValue)", () => {
    const emitter = makeEmitter();
    const turns = buildTurns([
      userRow("use a skill"),
      assistantRow([{ type: "tool_use", id: "tu_s", name: "Skill", input: { skill: "coding" } }]),
      toolResultRow("tu_s", "ok"),
      assistantRow([{ type: "text", text: "done" }], { msgId: "m2" }),
    ]);
    emitTurn(emitter, emitter.config, "0123abcd-0000-4000-8000-000000000000", 1, turns[0]!, "/tmp/session.jsonl");

    const bytes = JsonTraceSerializer.serializeRequest(emitter.spans);
    const payload = JSON.parse(Buffer.from(bytes!).toString("utf-8"));
    const wireSpans = payload.resourceSpans[0].scopeSpans[0].spans;
    const byName: Record<string, any> = {};
    for (const s of wireSpans) {
      byName[s.name] = s;
    }

    // camelCase + hex ids + decimal-string nanoseconds.
    const root = byName["Claude Code - Turn 1 (0123abcd)"];
    assert.match(root.traceId, /^[0-9a-f]{32}$/);
    assert.match(root.spanId, /^[0-9a-f]{16}$/);
    assert.equal(typeof root.startTimeUnixNano, "string");

    const wireAttr = (span: any, key: string) => span.attributes.find((a: any) => a.key === key)?.value;
    // string envelope
    assert.deepEqual(wireAttr(root, "lmnr.span.type"), { stringValue: "DEFAULT" });
    // trace context rides in metadata as string envelopes; no tags attribute
    assert.equal(wireAttr(root, "lmnr.association.properties.tags"), undefined);
    assert.deepEqual(wireAttr(root, "lmnr.association.properties.metadata.skills"), { stringValue: "coding" });
    assert.deepEqual(wireAttr(root, "lmnr.association.properties.metadata.source"), { stringValue: "claude-code" });

    // intValue for token usage on the LLM span. The OTel JS serializer emits a
    // JSON number here; app-server's OTLP/JSON decoder accepts intValue as
    // either a number or a decimal string, so this is a valid wire form.
    const llm = byName["LLM Call 1"];
    assert.equal(Number(wireAttr(llm, "gen_ai.usage.input_tokens").intValue), 10);
  });
});

describe("emitReadyTurns", () => {
  const makeTurns = (n: number): Turn[] => {
    const turns: Turn[] = [];
    for (let i = 0; i < n; i++) {
      turns.push(
        ...buildTurns([userRow(`prompt ${i}`), assistantRow([{ type: "text", text: `answer ${i}` }], { msgId: `m${i}` })])
      );
    }
    return turns;
  };

  const emitReady = (turns: Turn[], state: SessionState, emitTurnFn?: typeof emitTurn) => {
    const emitter = makeEmitter();
    return emitReadyTurns(emitter, emitter.config, "sess", "/tmp/session.jsonl", turns, state, {}, emitTurnFn ?? emitTurn);
  };

  it("counts all successful turns", () => {
    assert.equal(emitReady(makeTurns(3), new SessionState()), 3);
  });

  it("failed emit not counted (turn numbering)", () => {
    const calls: number[] = [];
    const flaky: typeof emitTurn = (_e, _c, _s, turnNum) => {
      calls.push(turnNum);
      if (calls.length === 2) {
        throw new Error("boom");
      }
    };
    assert.equal(emitReady(makeTurns(3), new SessionState({ turnCount: 5 }), flaky), 2);
    // Turn numbers only advance for successful emits, so the turn after a
    // failure reuses the failed slot's number.
    assert.deepEqual(calls, [6, 7, 7]);
  });

  it("all emits failed counts zero", () => {
    const failing: typeof emitTurn = () => {
      throw new Error("boom");
    };
    assert.equal(emitReady(makeTurns(2), new SessionState(), failing), 0);
  });
});

describe("emitNewTurnsFromTranscript", () => {
  let stateDir: string | null = null;

  const setup = (): string => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-state-"));
    process.env.CC_LMNR_STATE_DIR = stateDir;
    const transcript = path.join(stateDir, "session.jsonl");
    const rows = [userRow("hello"), assistantRow([{ type: "text", text: "hi" }])];
    fs.writeFileSync(transcript, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return transcript;
  };

  afterEach(() => {
    process.env.CC_LMNR_STATE_DIR = BASELINE_STATE_DIR;
    if (stateDir) {
      fs.rmSync(stateDir, { recursive: true, force: true });
      stateDir = null;
    }
  });

  const run = (transcript: string, exportOk: boolean) => {
    const emitter = makeEmitter();
    return emitNewTurnsFromTranscript(emitter, emitter.config, "sess", transcript, {
      exportFn: async () => exportOk,
    });
  };

  const savedState = (transcript: string): SessionState => {
    const state = loadHookState();
    const key = getSessionStateKey("sess", transcript);
    return getSessionState(state, key);
  };

  it("export failure keeps state for retry", async () => {
    const transcript = setup();
    assert.equal(await run(transcript, false), 0);
    let saved = savedState(transcript);
    assert.equal(saved.offset, 0);
    assert.equal(saved.turnCount, 0);

    // Next run with a working export re-reads the same turn.
    assert.equal(await run(transcript, true), 1);
    saved = savedState(transcript);
    assert.equal(saved.offset, fs.statSync(transcript).size);
    assert.equal(saved.turnCount, 1);
  });

  it("export success advances state", async () => {
    const transcript = setup();
    assert.equal(await run(transcript, true), 1);
    let saved = savedState(transcript);
    assert.equal(saved.offset, fs.statSync(transcript).size);
    assert.equal(saved.turnCount, 1);

    // Re-running with no new content emits nothing and keeps state stable.
    assert.equal(await run(transcript, true), 0);
    assert.equal(savedState(transcript).turnCount, 1);
  });
});

describe("incomplete trailing turn (flush race)", () => {
  let dir: string | null = null;
  afterEach(() => {
    process.env.CC_LMNR_STATE_DIR = BASELINE_STATE_DIR;
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("holds a user-only turn on Stop and emits it once the assistant lands", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-race-"));
    process.env.CC_LMNR_STATE_DIR = dir;
    const transcript = path.join(dir, "session.jsonl");
    const key = getSessionStateKey("sess", transcript);
    const saved = () => getSessionState(loadHookState(), key);
    const runHook = (event: "Stop" | "SessionEnd") => {
      const emitter = makeEmitter();
      return emitNewTurnsFromTranscript(emitter, emitter.config, "sess", transcript, {
        flushDeferredAgentTurns: event === "SessionEnd",
        exportFn: async () => true,
      });
    };

    // Stop fires with only the user prompt written (assistant not flushed yet).
    fs.writeFileSync(transcript, JSON.stringify(userRow("hi")) + "\n");
    assert.equal(await runHook("Stop"), 0);
    assert.equal(saved().turnCount, 0);
    assert.equal(saved().pendingTurnRows.length, 1); // held, not dropped

    // Assistant row lands; SessionEnd flushes the now-complete turn.
    fs.appendFileSync(transcript, JSON.stringify(assistantRow([{ type: "text", text: "yo" }])) + "\n");
    assert.equal(await runHook("SessionEnd"), 1);
    assert.equal(saved().turnCount, 1);
    assert.equal(saved().pendingTurnRows.length, 0);
  });

  it("holds a turn ending in a tool_result on Stop and emits it with its final answer", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-race-"));
    process.env.CC_LMNR_STATE_DIR = dir;
    const transcript = path.join(dir, "session.jsonl");
    const key = getSessionStateKey("sess", transcript);
    const saved = () => getSessionState(loadHookState(), key);
    const runHook = async (event: "Stop" | "SessionEnd") => {
      const emitter = makeEmitter();
      const n = await emitNewTurnsFromTranscript(emitter, emitter.config, "sess", transcript, {
        flushDeferredAgentTurns: event === "SessionEnd",
        exportFn: async () => true,
      });
      return [n, emitter] as const;
    };

    // Stop fires after the tool ran but before the final answer is written.
    const rows = [
      userRow("read it"),
      assistantRow([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }], { msgId: "m1" }),
      toolResultRow("t1", "contents"),
    ];
    fs.writeFileSync(transcript, rows.map((r) => JSON.stringify(r) + "\n").join(""));
    const [heldCount] = await runHook("Stop");
    assert.equal(heldCount, 0);
    assert.equal(saved().pendingTurnRows.length, 3); // held, not emitted without its ending

    // The final answer lands; the next run emits the whole turn.
    fs.appendFileSync(transcript, JSON.stringify(assistantRow([{ type: "text", text: "done" }], { msgId: "m2", ts: "2026-07-08T10:00:12.000Z" })) + "\n");
    const [emittedCount, emitter] = await runHook("SessionEnd");
    assert.equal(emittedCount, 1);
    const spans = spansByName(emitter.spans);
    assert.ok(spans["LLM Call 2"]);
    assert.match(String(attrs(spans["Claude Code - Turn 1 (sess)"]!)["lmnr.span.output"]), /done/);
  });

  it("holds a turn on Stop until the text the payload names is written", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-race-"));
    process.env.CC_LMNR_STATE_DIR = dir;
    const transcript = path.join(dir, "session.jsonl");
    const key = getSessionStateKey("sess", transcript);
    const saved = () => getSessionState(loadHookState(), key);
    const runStop = async (finalAssistantText: string) => {
      const emitter = makeEmitter();
      const n = await emitNewTurnsFromTranscript(emitter, emitter.config, "sess", transcript, {
        finalAssistantText,
        exportFn: async () => true,
      });
      return [n, emitter] as const;
    };

    // Stop fires with the final message's thinking row written but not its text row.
    const rows = [userRow("hi"), assistantRow([{ type: "thinking", thinking: "hmm" }], { msgId: "m1" })];
    fs.writeFileSync(transcript, rows.map((r) => JSON.stringify(r) + "\n").join(""));
    const [heldCount] = await runStop("All done.");
    assert.equal(heldCount, 0);
    assert.equal(saved().pendingTurnRows.length, 2);

    // The text row lands; the next Stop (whose payload names the next turn's
    // text) emits the held turn whole.
    fs.appendFileSync(transcript, JSON.stringify(assistantRow([{ type: "text", text: "All done." }], { msgId: "m1" })) + "\n");
    const [emittedCount, emitter] = await runStop("All done.");
    assert.equal(emittedCount, 1);
    assert.match(String(attrs(spansByName(emitter.spans)["Claude Code - Turn 1 (sess)"]!)["lmnr.span.output"]), /All done\./);
    assert.equal(saved().pendingTurnRows.length, 0);
  });
});

describe("background agent reporting back to a deferred turn", () => {
  let dir: string | null = null;
  afterEach(() => {
    process.env.CC_LMNR_STATE_DIR = BASELINE_STATE_DIR;
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("keeps Claude's reply to the agent's message in the turn, with the message as its input", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-bg-"));
    process.env.CC_LMNR_STATE_DIR = dir;
    const transcript = path.join(dir, "session.jsonl");
    const append = (rows: any[]) => fs.appendFileSync(transcript, rows.map((r) => JSON.stringify(r) + "\n").join(""));
    const runStop = async (finalAssistantText: string) => {
      const emitter = makeEmitter();
      const n = await emitNewTurnsFromTranscript(emitter, emitter.config, "sess", transcript, {
        finalAssistantText,
        exportFn: async () => true,
      });
      return [n, emitter] as const;
    };

    // The turn launches a background agent and ends; it is deferred until the
    // agent's task-notification arrives.
    append([
      userRow("count words in the background", "2026-07-08T10:00:00.000Z"),
      assistantRow([{ type: "tool_use", id: "tu_bg", name: "Agent", input: { prompt: "count", run_in_background: true } }], {
        msgId: "m1",
        ts: "2026-07-08T10:00:01.000Z",
      }),
      toolResultRow("tu_bg", "Async agent launched successfully", "2026-07-08T10:00:02.000Z", {
        toolUseResult: { status: "async_launched" },
      }),
      assistantRow([{ type: "text", text: "Running in the background." }], { msgId: "m2", ts: "2026-07-08T10:00:03.000Z" }),
    ]);
    assert.equal((await runStop("Running in the background."))[0], 0);

    // The agent reports back as an injected message, and Claude answers it — no
    // new prompt in front of these rows.
    append([
      userRow("<agent-message>13 words</agent-message>", "2026-07-08T10:00:10.000Z", { isMeta: true }),
      assistantRow([{ type: "text", text: "It has 13 words." }], { msgId: "m3", ts: "2026-07-08T10:00:11.000Z" }),
    ]);
    assert.equal((await runStop("It has 13 words."))[0], 0);

    // The notification resolves the deferred turn, which now includes the reply.
    append([
      userRow(
        "<task-notification><tool-use-id>tu_bg</tool-use-id><result>13 words</result></task-notification>",
        "2026-07-08T10:00:12.000Z"
      ),
    ]);
    const [emitted, emitter] = await runStop("");
    assert.equal(emitted, 1);
    const names = spansByName(emitter.spans);
    const llm3 = names["LLM Call 3"];
    assert.ok(llm3, "the reply to the agent's message is its own generation");
    const input = JSON.parse(attrs(llm3)["gen_ai.input.messages"]);
    assert.deepEqual(input[input.length - 1], {
      role: "user",
      content: [{ type: "text", text: "<agent-message>13 words</agent-message>" }],
    });
    assert.match(String(attrs(names["Claude Code - Turn 1 (sess)"]!)["lmnr.span.output"]), /13 words/);
  });
});

describe("emitTurn", () => {
  const emit = (rows: any[], subagents: Record<string, SubagentTranscript> | null = null): TraceEmitter => {
    const emitter = makeEmitter();
    const turns = buildTurns(rows);
    assert.equal(turns.length, 1);
    emitTurn(emitter, emitter.config, "0123abcd-0000-4000-8000-000000000000", 1, turns[0]!, "/tmp/session.jsonl", subagents);
    return emitter;
  };

  it("simple turn spans", () => {
    const emitter = emit([userRow("hello"), assistantRow([{ type: "text", text: "hi" }])]);
    const names = spansByName(emitter.spans);
    assert.ok("Claude Code - Turn 1 (0123abcd)" in names);
    assert.ok("LLM Call 1" in names);

    const root = names["Claude Code - Turn 1 (0123abcd)"]!;
    const rootAttrs = attrs(root);
    assert.equal(root.parentSpanId, undefined);
    assert.equal(rootAttrs["lmnr.span.type"], "DEFAULT");
    assert.equal(rootAttrs["lmnr.association.properties.session_id"], "0123abcd-0000-4000-8000-000000000000");
    assert.deepEqual(JSON.parse(rootAttrs["lmnr.span.input"]), { role: "user", content: "hello" });
    assert.deepEqual(JSON.parse(rootAttrs["lmnr.span.output"]), { role: "assistant", content: "hi" });

    const llm = names["LLM Call 1"]!;
    const llmAttrs = attrs(llm);
    assert.equal(llm.parentSpanId, root.spanContext().spanId);
    assert.equal(llm.spanContext().traceId, root.spanContext().traceId);
    assert.equal(llmAttrs["lmnr.span.type"], "LLM");
    assert.equal(llmAttrs["gen_ai.request.model"], "claude-opus-4-7");
    assert.equal(llmAttrs["gen_ai.usage.input_tokens"], 10);
    assert.equal(llmAttrs["gen_ai.usage.output_tokens"], 5);
    assert.deepEqual(JSON.parse(llmAttrs["gen_ai.input.messages"]), [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
    const outMsgs = JSON.parse(llmAttrs["gen_ai.output.messages"]);
    assert.equal(outMsgs[0].role, "assistant");
    assert.deepEqual(outMsgs[0].content, [{ type: "text", text: "hi" }]);
  });

  it("tool turn spans", () => {
    const emitter = emit([
      userRow("run ls"),
      assistantRow([{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } }]),
      toolResultRow("tu_1", "file.txt"),
      assistantRow([{ type: "text", text: "done" }], { msgId: "m2", ts: "2026-07-08T10:00:15.000Z" }),
    ]);
    const names = spansByName(emitter.spans);
    assert.deepEqual(new Set(Object.keys(names)), new Set(["Claude Code - Turn 1 (0123abcd)", "LLM Call 1", "Bash", "LLM Call 2"]));

    const toolAttrs = attrs(names["Bash"]!);
    assert.equal(toolAttrs["lmnr.span.type"], "TOOL");
    assert.deepEqual(JSON.parse(toolAttrs["lmnr.span.input"]), { command: "ls" });
    assert.deepEqual(JSON.parse(toolAttrs["lmnr.span.output"]), "file.txt");

    // LLM Call 2 sees the whole turn so far, in Anthropic Messages API shape:
    // the prompt, the tool_use it answered, and the tool_result in a user message.
    const llm2Attrs = attrs(names["LLM Call 2"]!);
    assert.deepEqual(JSON.parse(llm2Attrs["gen_ai.input.messages"]), [
      { role: "user", content: [{ type: "text", text: "run ls" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "file.txt" }] },
    ]);

    const llm1Attrs = attrs(names["LLM Call 1"]!);
    const outMsgs = JSON.parse(llm1Attrs["gen_ai.output.messages"]);
    assert.deepEqual(outMsgs[0].content, [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } }]);
  });

  it("tool span output replaces a returned image with a marker", () => {
    const emitter = emit([
      userRow("look at it"),
      assistantRow([{ type: "tool_use", id: "tu_img", name: "Read", input: { file_path: "red.png" } }]),
      toolResultRow("tu_img", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo" } }]),
      assistantRow([{ type: "text", text: "red" }], { msgId: "m2", ts: "2026-07-08T10:00:15.000Z" }),
    ]);
    const output = attrs(spansByName(emitter.spans)["Read"]!)["lmnr.span.output"];
    assert.ok(!String(output).includes("iVBORw0KGgo"));
    assert.deepEqual(JSON.parse(JSON.parse(output)), [{ type: "text", text: "[image]" }]);
  });

  it("timestamps backdated and ordered", () => {
    const emitter = emit([
      userRow("hello", "2026-07-08T10:00:00.000Z"),
      assistantRow([{ type: "text", text: "hi" }], { ts: "2026-07-08T10:00:05.000Z" }),
    ]);
    const names = spansByName(emitter.spans);
    const root = names["Claude Code - Turn 1 (0123abcd)"]!;
    const llm = names["LLM Call 1"]!;
    const expectedStartNs = BigInt(Date.UTC(2026, 6, 8, 10, 0, 0)) * 1_000_000n;
    assert.equal(hrToNs(root.startTime), expectedStartNs);
    assert.ok(hrToNs(root.endTime) >= hrToNs(root.startTime));
    assert.ok(hrToNs(llm.startTime) >= hrToNs(root.startTime));
    assert.ok(hrToNs(llm.endTime) <= hrToNs(root.endTime));
  });

  it("skills and os captured in trace metadata; no tags attribute", () => {
    const emitter = emit([
      userRow("use a skill"),
      assistantRow([{ type: "tool_use", id: "tu_s", name: "Skill", input: { skill: "coding" } }]),
      toolResultRow("tu_s", "ok"),
      assistantRow([{ type: "text", text: "done" }], { msgId: "m2" }),
    ]);
    const root = spansByName(emitter.spans)["Claude Code - Turn 1 (0123abcd)"]!;
    const rootAttrs = attrs(root);
    // Tags are no longer emitted at all.
    assert.equal(rootAttrs["lmnr.association.properties.tags"], undefined);
    assert.equal(rootAttrs["lmnr.association.properties.metadata.skills"], "coding");
    assert.equal(rootAttrs["lmnr.association.properties.metadata.os"], process.platform);
    assert.equal(rootAttrs["lmnr.association.properties.metadata.source"], "claude-code");
  });

  it("subagent nested under tool span", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-sub-"));
    try {
      const subJsonl = path.join(dir, "agent-abc.jsonl");
      const subRows = [
        userRow("subagent prompt", "2026-07-08T10:00:06.000Z"),
        assistantRow([{ type: "text", text: "subagent answer" }], { msgId: "sm1", ts: "2026-07-08T10:00:08.000Z" }),
      ];
      fs.writeFileSync(subJsonl, subRows.map((r) => JSON.stringify(r)).join("\n") + "\n");

      const subagents: Record<string, SubagentTranscript> = {
        tu_task: { path: subJsonl, agentId: "abc", agentType: "Explore", description: "find stuff" },
      };
      const emitter = emit(
        [
          userRow("delegate"),
          assistantRow([{ type: "tool_use", id: "tu_task", name: "Task", input: { prompt: "go" } }]),
          toolResultRow("tu_task", "task done", "2026-07-08T10:00:09.000Z"),
          assistantRow([{ type: "text", text: "summary" }], { msgId: "m2", ts: "2026-07-08T10:00:10.000Z" }),
        ],
        subagents
      );
      const names = spansByName(emitter.spans);
      assert.ok("Subagent: find stuff" in names);
      assert.ok("Subagent LLM Call 1" in names);

      const toolSpan = names["Task"]!;
      const subSpan = names["Subagent: find stuff"]!;
      const subLlm = names["Subagent LLM Call 1"]!;
      assert.equal(subSpan.parentSpanId, toolSpan.spanContext().spanId);
      assert.equal(subLlm.parentSpanId, subSpan.spanContext().spanId);
      assert.equal(attrs(subSpan)["claude_code.subagent.type"], "Explore");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("nested subagent nests under its parent subagent's tool span", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-nested-"));
    try {
      const write = (name: string, rows: any[]) => {
        const p = path.join(dir, name);
        fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
        return p;
      };
      const outerPath = write("agent-outer.jsonl", [
        userRow("launch a nested one", "2026-07-08T10:00:06.000Z"),
        assistantRow([{ type: "tool_use", id: "tu_inner", name: "Agent", input: { prompt: "read" } }], {
          msgId: "om1",
          ts: "2026-07-08T10:00:07.000Z",
        }),
        toolResultRow("tu_inner", "first line", "2026-07-08T10:00:09.000Z"),
        assistantRow([{ type: "text", text: "nested said: first line" }], { msgId: "om2", ts: "2026-07-08T10:00:10.000Z" }),
      ]);
      const innerPath = write("agent-inner.jsonl", [
        userRow("read", "2026-07-08T10:00:07.500Z"),
        assistantRow([{ type: "text", text: "first line" }], { msgId: "im1", ts: "2026-07-08T10:00:08.000Z" }),
      ]);
      const subagents: Record<string, SubagentTranscript> = {
        tu_outer: { path: outerPath, agentId: "outer", agentType: "general-purpose", description: "outer" },
        tu_inner: { path: innerPath, agentId: "inner", agentType: "general-purpose", description: "inner" },
      };
      const emitter = emit(
        [
          userRow("delegate"),
          assistantRow([{ type: "tool_use", id: "tu_outer", name: "Agent", input: { prompt: "go" } }]),
          toolResultRow("tu_outer", "nested said: first line", "2026-07-08T10:00:11.000Z"),
          assistantRow([{ type: "text", text: "done" }], { msgId: "m2", ts: "2026-07-08T10:00:12.000Z" }),
        ],
        subagents
      );
      const byName = (name: string) => emitter.spans.filter((s) => s.name === name);
      const outer = byName("Subagent: outer")[0]!;
      const inner = byName("Subagent: inner")[0]!;
      const innerTool = byName("Agent").find((s) => s.parentSpanId === outer.spanContext().spanId)!;
      assert.ok(innerTool, "the outer subagent's Agent call has a tool span under it");
      assert.equal(inner.parentSpanId, innerTool.spanContext().spanId);
      assert.equal(byName("Subagent: outer").length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("subagent output falls back to its SubagentHandback report", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-sub-"));
    try {
      const subJsonl = path.join(dir, "agent-hb.jsonl");
      const subRows = [
        userRow("count words", "2026-07-08T10:00:06.000Z"),
        assistantRow([{ type: "tool_use", id: "hb", name: "SubagentHandback", input: { message: "14 words" } }], {
          msgId: "sm1",
          ts: "2026-07-08T10:00:08.000Z",
        }),
        toolResultRow("hb", "Report delivered to your caller.", "2026-07-08T10:00:08.500Z"),
      ];
      fs.writeFileSync(subJsonl, subRows.map((r) => JSON.stringify(r)).join("\n") + "\n");

      const subagents: Record<string, SubagentTranscript> = {
        tu_task: { path: subJsonl, agentId: "hb", agentType: "general-purpose", description: "count" },
      };
      const emitter = emit(
        [
          userRow("delegate"),
          assistantRow([{ type: "tool_use", id: "tu_task", name: "Agent", input: { prompt: "go" } }]),
          toolResultRow("tu_task", "14 words", "2026-07-08T10:00:09.000Z"),
          assistantRow([{ type: "text", text: "14" }], { msgId: "m2", ts: "2026-07-08T10:00:10.000Z" }),
        ],
        subagents
      );
      const subSpan = spansByName(emitter.spans)["Subagent: count"]!;
      assert.equal(JSON.parse(attrs(subSpan)["lmnr.span.output"]).content, "14 words");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("async subagent + async tool result render on the resolving generation", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-async-"));
    try {
      const subJsonl = path.join(dir, "agent-async.jsonl");
      const subRows = [
        userRow("async subagent prompt", "2026-07-08T10:00:15.000Z"),
        assistantRow([{ type: "text", text: "async subagent answer" }], { msgId: "asm1", ts: "2026-07-08T10:00:18.000Z" }),
      ];
      fs.writeFileSync(subJsonl, subRows.map((r) => JSON.stringify(r)).join("\n") + "\n");

      const subagents: Record<string, SubagentTranscript> = {
        tu_task: { path: subJsonl, agentId: "async", agentType: "Explore", description: "async work" },
      };

      // Launch (m1) -> a generation before resolution (m2) -> task-notification
      // resolves the launch -> a later generation (m3). The subagent and the
      // async result must surface only once resolution is reached.
      const emitter = emit(
        [
          userRow("delegate async"),
          assistantRow([{ type: "tool_use", id: "tu_task", name: "Task", input: { prompt: "go" } }], {
            msgId: "m1",
            ts: "2026-07-08T10:00:05.000Z",
          }),
          toolResultRow(
            "tu_task",
            "Async agent launched successfully\nagentId: async\noutput_file: /x\nYou will be notified automatically",
            "2026-07-08T10:00:09.000Z",
            { toolUseResult: { status: "async_launched" } }
          ),
          assistantRow([{ type: "text", text: "working on it" }], { msgId: "m2", ts: "2026-07-08T10:00:12.000Z" }),
          userRow(
            "<task-notification><tool-use-id>tu_task</tool-use-id><result>async task result</result></task-notification>",
            "2026-07-08T10:00:20.000Z"
          ),
          assistantRow([{ type: "text", text: "all done" }], { msgId: "m3", ts: "2026-07-08T10:00:25.000Z" }),
        ],
        subagents
      );

      const names = spansByName(emitter.spans);
      // Subagent emitted via the deferred (async) path, still nested under its Task tool span.
      const toolSpan = names["Task"]!;
      const subSpan = names["Subagent: async work"]!;
      assert.equal(subSpan.parentSpanId, toolSpan.spanContext().spanId);

      // The generation right after launch sees the initial launch text; the async
      // result is folded only into the generation after the notification resolves.
      const lastResult = (messages: any[]) => messages[messages.length - 1].content[0];
      const llm2In = JSON.parse(attrs(names["LLM Call 2"]!)["gen_ai.input.messages"]);
      assert.equal(lastResult(llm2In).tool_use_id, "tu_task");
      assert.ok(String(lastResult(llm2In).content).includes("Async agent launched"));
      assert.ok(!JSON.stringify(llm2In).includes("async task result"));

      const llm3In = JSON.parse(attrs(names["LLM Call 3"]!)["gen_ai.input.messages"]);
      assert.equal(llm3In.length, 5); // prompt, launch, launch result, "working on it", async result
      assert.equal(lastResult(llm3In).tool_use_id, "tu_task");
      assert.ok(String(lastResult(llm3In).content).includes("async task result"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("user_id attached when configured", () => {
    const emitter = makeEmitter("user-42");
    const turns = buildTurns([userRow("hello"), assistantRow([{ type: "text", text: "hi" }])]);
    emitTurn(emitter, emitter.config, "sess", 1, turns[0]!, "/tmp/t.jsonl");
    const root = emitter.spans.find((s) => s.parentSpanId === undefined)!;
    assert.equal(attrs(root)["lmnr.association.properties.user_id"], "user-42");
  });
});
