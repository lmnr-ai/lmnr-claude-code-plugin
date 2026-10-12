import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { getLaminarConfig, MAX_CHARS } from "../src/config.js";
import { buildGenerationAttributes, buildUserMessage, toolResultBlock } from "../src/genai.js";
import { Tracer, endSpan, toOtlpJson } from "../src/otlp.js";
import { mergeAssistantRows } from "../src/render.js";
import { findSubagents, isTaskNotification, notificationResult, notificationToolUseId, readLines, taskIdMap } from "../src/transcript.js";
import { assistantRow, notificationRow, userRow } from "./helpers.js";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const apply = (v: Record<string, string | undefined>) => {
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  };
  apply(vars);
  try {
    fn();
  } finally {
    apply(saved);
  }
}

describe("config", () => {
  it("reads projectApiKey + baseUrl from the lmnr-cli plugin file, env overrides", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-cfg-"));
    try {
      withEnv({ LMNR_PROJECT_API_KEY: undefined, LMNR_BASE_URL: undefined, XDG_CONFIG_HOME: dir }, () => {
        assert.equal(getLaminarConfig(), null); // no key anywhere → do nothing
        fs.mkdirSync(path.join(dir, "lmnr"));
        fs.writeFileSync(
          path.join(dir, "lmnr", "claude-code-plugin.json"),
          JSON.stringify({ projectApiKey: "file-key", baseUrl: "http://localhost:8000/" })
        );
        assert.deepEqual(getLaminarConfig(), { apiKey: "file-key", baseUrl: "http://localhost:8000", userId: null });
        process.env.LMNR_PROJECT_API_KEY = "env-key";
        process.env.LMNR_BASE_URL = "https://example.com";
        assert.equal(getLaminarConfig()!.apiKey, "env-key");
        assert.equal(getLaminarConfig()!.baseUrl, "https://example.com");
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("user id: LMNR_USER_ID, else the lmnr-cli login email, else its user id, else null", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-creds-"));
    try {
      withEnv({ LMNR_PROJECT_API_KEY: "k", LMNR_USER_ID: undefined, XDG_CONFIG_HOME: dir }, () => {
        assert.equal(getLaminarConfig()!.userId, null);
        fs.mkdirSync(path.join(dir, "lmnr"));
        const creds = path.join(dir, "lmnr", "credentials.json");
        fs.writeFileSync(creds, JSON.stringify({ userId: "u1" }));
        assert.equal(getLaminarConfig()!.userId, "u1");
        fs.writeFileSync(creds, JSON.stringify({ userEmail: "me@example.com", userId: "u1" }));
        assert.equal(getLaminarConfig()!.userId, "me@example.com");
        process.env.LMNR_USER_ID = "explicit";
        assert.equal(getLaminarConfig()!.userId, "explicit");
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("OTLP/JSON payload", () => {
  it("matches the OpenTelemetry JS serializer's shape", () => {
    const tracer = new Tracer();
    const root = tracer.start("root", Date.UTC(2026, 6, 8, 10), { "lmnr.span.type": "DEFAULT", skipped: null, n: 10, f: 0.5, b: true });
    const child = tracer.start("child", Date.UTC(2026, 6, 8, 10, 0, 1), {}, root);
    endSpan(child, Date.UTC(2026, 6, 8, 10, 0, 0)); // before its start → clamped
    endSpan(root, Date.UTC(2026, 6, 8, 10, 0, 2));

    const payload = toOtlpJson(tracer.spans) as any;
    const resourceSpans = payload.resourceSpans[0];
    assert.deepEqual(resourceSpans.scopeSpans[0].scope, { name: "lmnr.claude_code" });
    const [r, c] = resourceSpans.scopeSpans[0].spans;
    assert.match(r.traceId, /^[0-9a-f]{32}$/);
    assert.match(r.spanId, /^[0-9a-f]{16}$/);
    assert.equal(r.parentSpanId, undefined);
    assert.equal(c.parentSpanId, r.spanId);
    assert.equal(c.traceId, r.traceId);
    assert.equal(r.startTimeUnixNano, (BigInt(Date.UTC(2026, 6, 8, 10)) * 1_000_000n).toString());
    assert.equal(c.endTimeUnixNano, c.startTimeUnixNano);
    assert.equal(r.kind, 1);
    assert.deepEqual(r.status, { code: 1 });
    assert.deepEqual(r.attributes, [
      { key: "lmnr.span.type", value: { stringValue: "DEFAULT" } },
      { key: "n", value: { intValue: 10 } },
      { key: "f", value: { doubleValue: 0.5 } },
      { key: "b", value: { boolValue: true } },
    ]);
  });
});

describe("transcript reading", () => {
  it("returns rows with their byte offsets, and where to resume", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-read-"));
    try {
      const file = path.join(dir, "t.jsonl");
      const a = '{"a":"é"}\n'; // multi-byte: offsets are bytes, not chars
      fs.writeFileSync(file, a + "not json\n" + '{"b":2}\n' + '{"c":');
      const { lines, end } = readLines(file);
      assert.deepEqual(
        lines.map((l) => [l.row, l.offset]),
        [
          [{ a: "é" }, 0],
          [{ b: 2 }, Buffer.byteLength(a) + 9],
        ]
      );
      assert.equal(end, fs.statSync(file).size - 5); // the partial row is re-read next time
      assert.deepEqual(readLines(file, end).lines, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discovers subagent transcripts and maps their task ids", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-disc-"));
    try {
      const transcript = path.join(dir, "session.jsonl");
      assert.deepEqual(findSubagents(transcript), {});
      const sub = path.join(dir, "session", "subagents");
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, "agent-xyz.jsonl"), "{}\n");
      fs.writeFileSync(path.join(sub, "agent-xyz.meta.json"), JSON.stringify({ toolUseId: "tu_1", agentType: "Explore", description: "d" }));
      fs.writeFileSync(path.join(sub, "agent-orphan.meta.json"), JSON.stringify({ toolUseId: "tu_2" })); // no .jsonl
      const found = findSubagents(transcript);
      assert.deepEqual(Object.keys(found), ["tu_1"]);
      assert.equal(found["tu_1"]!.agentId, "xyz");
      assert.deepEqual(taskIdMap(found), { xyz: "tu_1" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("task notifications", () => {
  it("are delivered user rows or queued_command attachments, never queue bookkeeping", () => {
    assert.equal(isTaskNotification(notificationRow("<result>x</result>")), true);
    assert.equal(isTaskNotification(userRow("hi", undefined, { origin: { kind: "task-notification" } })), true);
    assert.equal(
      isTaskNotification({ type: "attachment", attachment: { type: "queued_command", commandMode: "task-notification", prompt: "<task-notification/>" } }),
      true
    );
    assert.equal(isTaskNotification({ type: "attachment", attachment: { type: "queued_command", commandMode: "prompt", prompt: "do x" } }), false);
    assert.equal(isTaskNotification({ type: "queue-operation", content: "<task-notification></task-notification>" }), false);
    assert.equal(isTaskNotification(userRow("a normal prompt")), false);
  });

  it("name their tool_use directly, or by task id; the result tag is the report", () => {
    assert.equal(notificationToolUseId(notificationRow("<tool-use-id>tu_1</tool-use-id>"), {}), "tu_1");
    assert.equal(notificationToolUseId(notificationRow("<task-id>a1</task-id>"), { a1: "tu_2" }), "tu_2");
    assert.equal(notificationToolUseId(notificationRow("<task-id>a1</task-id>"), {}), null);
    assert.equal(notificationToolUseId(userRow("not a notification"), {}), null);
    assert.equal(notificationResult(notificationRow("<result>the answer</result>")), "the answer");
    assert.match(notificationResult(notificationRow("<tool-use-id>t</tool-use-id>")), /<tool-use-id>/);
  });
});

describe("gen_ai serialization", () => {
  const prompt = { role: "user", content: [{ type: "text", text: "the question" }] };

  it("sends the history as input, the assistant message as output, and usage", () => {
    const [attrs, toolUses, output] = buildGenerationAttributes([prompt], assistantRow([{ type: "text", text: "hello" }]));
    assert.deepEqual(JSON.parse(attrs["gen_ai.input.messages"]), [prompt]);
    assert.deepEqual(output, { role: "assistant", content: [{ type: "text", text: "hello" }] });
    assert.equal(attrs["gen_ai.system"], "anthropic");
    assert.equal(attrs["gen_ai.usage.input_tokens"], 10);
    assert.equal(attrs["llm.usage.total_tokens"], 15);
    assert.equal(toolUses.length, 0);
  });

  it("skips zero and missing usage", () => {
    const row = assistantRow([{ type: "text", text: "x" }]);
    row.message.usage = { input_tokens: 0, output_tokens: 7 };
    const [attrs] = buildGenerationAttributes([prompt], row);
    assert.equal(attrs["gen_ai.usage.input_tokens"], undefined);
    assert.equal(attrs["llm.usage.total_tokens"], 7);
    delete row.message.usage;
    assert.equal(buildGenerationAttributes([prompt], row)[0]["llm.usage.total_tokens"], undefined);
  });

  it("keeps thinking, text and tool_use blocks, dropping the thinking signature", () => {
    const row = assistantRow([
      { type: "thinking", thinking: "let me look", signature: "c2lnbmF0dXJl" },
      { type: "text", text: "calling" },
      { type: "tool_use", id: "u1", name: "Read", input: { path: "/x" } },
    ]);
    row.message.stop_reason = "tool_use";
    const [attrs, toolUses] = buildGenerationAttributes([prompt], row);
    assert.deepEqual(JSON.parse(attrs["gen_ai.output.messages"]), [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me look" },
          { type: "text", text: "calling" },
          { type: "tool_use", id: "u1", name: "Read", input: { path: "/x" } },
        ],
        stop_reason: "tool_use",
      },
    ]);
    assert.equal(toolUses.length, 1);
  });

  it("replaces images with a marker and truncates long strings", () => {
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } };
    const message = buildUserMessage(userRow([image, { type: "text", text: "x".repeat(MAX_CHARS + 10) }]));
    assert.deepEqual(message.content[0], { type: "text", text: "[image]" });
    assert.equal(message.content[1].text.length, MAX_CHARS);
    assert.deepEqual(toolResultBlock("t1", [image], false).content, [{ type: "text", text: "[image]" }]);
    assert.deepEqual(toolResultBlock("t2", "boom", true), { type: "tool_result", tool_use_id: "t2", content: "boom", is_error: true });
  });

  it("merges an assistant message split across rows", () => {
    const merged = mergeAssistantRows([assistantRow("first"), assistantRow([{ type: "text", text: "second" }])]);
    assert.deepEqual(merged.message.content, [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
  });
});
