import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assistantRow,
  attr,
  json,
  notificationRow,
  promptSnapshotRow,
  render,
  ROOT,
  SESSION_ID,
  TestSession,
  toolResultRow,
  userRow,
} from "./helpers.js";

describe("turn spans", () => {
  it("simple turn: a root and one LLM span", async () => {
    const s = await render([userRow("hello"), assistantRow([{ type: "text", text: "hi" }])]);
    const root = s[ROOT]!;
    const llm = s["LLM Call 1"]!;
    assert.equal(s.all.length, 2);
    assert.equal(root.parentSpanId, undefined);
    assert.equal(attr(root, "lmnr.span.type"), "DEFAULT");
    assert.equal(attr(root, "lmnr.association.properties.session_id"), SESSION_ID);
    assert.deepEqual(json(root, "lmnr.span.input"), { role: "user", content: "hello" });
    assert.deepEqual(json(root, "lmnr.span.output"), { role: "assistant", content: "hi" });

    assert.equal(llm.parentSpanId, root.spanId);
    assert.equal(llm.traceId, root.traceId);
    assert.equal(attr(llm, "lmnr.span.type"), "LLM");
    assert.equal(attr(llm, "gen_ai.request.model"), "claude-opus-4-7");
    assert.equal(attr(llm, "gen_ai.usage.input_tokens"), 10);
    assert.equal(attr(llm, "gen_ai.usage.output_tokens"), 5);
    assert.deepEqual(json(llm, "gen_ai.input.messages"), [{ role: "user", content: [{ type: "text", text: "hello" }] }]);
    assert.deepEqual(json(llm, "gen_ai.output.messages")[0].content, [{ type: "text", text: "hi" }]);
  });

  it("tool turn: tool span, and the next generation sees the result", async () => {
    const s = await render([
      userRow("run ls"),
      assistantRow([{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } }]),
      toolResultRow("tu_1", "file.txt"),
      assistantRow([{ type: "text", text: "done" }], { msgId: "m2", ts: "2026-07-08T10:00:15.000Z" }),
    ]);
    assert.deepEqual(new Set(Object.keys(s).filter((k) => k !== "all")), new Set([ROOT, "LLM Call 1", "Bash", "LLM Call 2"]));
    const bash = s["Bash"]!;
    assert.equal(bash.parentSpanId, s[ROOT]!.spanId);
    assert.equal(attr(bash, "lmnr.span.type"), "TOOL");
    assert.equal(attr(bash, "claude_code.tool.name"), "Bash");
    assert.equal(attr(bash, "claude_code.tool.id"), "tu_1");
    assert.deepEqual(json(bash, "lmnr.span.input"), { command: "ls" });
    assert.equal(json(bash, "lmnr.span.output"), "file.txt");
    assert.deepEqual(json(s["LLM Call 2"], "gen_ai.input.messages"), [
      { role: "user", content: [{ type: "text", text: "run ls" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "file.txt" }] },
    ]);
  });

  it("parallel tool results go back in one user message, in call order", async () => {
    const s = await render([
      userRow("two reads"),
      assistantRow([{ type: "tool_use", id: "a", name: "Read", input: {} }], { ts: "2026-07-08T10:00:01.000Z" }),
      assistantRow([{ type: "tool_use", id: "b", name: "Read", input: {} }], { ts: "2026-07-08T10:00:02.000Z" }),
      toolResultRow("b", "B", "2026-07-08T10:00:03.000Z"),
      toolResultRow("a", "A", "2026-07-08T10:00:04.000Z"),
      assistantRow([{ type: "text", text: "both" }], { msgId: "m2", ts: "2026-07-08T10:00:05.000Z" }),
    ]);
    const input = json(s["LLM Call 2"], "gen_ai.input.messages");
    assert.equal(input.length, 3); // prompt, one merged assistant message, one results message
    assert.equal(input[1].content.length, 2);
    assert.deepEqual(input[2].content.map((b: any) => b.tool_use_id), ["a", "b"]);
  });

  it("injected context is input to the generation after it; skill instructions are not", async () => {
    const s = await render([
      userRow("use a skill"),
      assistantRow([{ type: "tool_use", id: "tu_s", name: "Skill", input: { skill: "coding" } }]),
      userRow("SKILL BODY", "2026-07-08T10:00:06.000Z", { isMeta: true, sourceToolUseID: "tu_s" }),
      toolResultRow("tu_s", "ok", "2026-07-08T10:00:07.000Z"),
      userRow("<agent-message>hi</agent-message>", "2026-07-08T10:00:08.000Z", { isMeta: true }),
      assistantRow([{ type: "text", text: "done" }], { msgId: "m2", ts: "2026-07-08T10:00:09.000Z" }),
    ]);
    const input = json(s["LLM Call 2"], "gen_ai.input.messages");
    assert.ok(!JSON.stringify(input).includes("SKILL BODY"));
    assert.deepEqual(input.slice(-2), [
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_s", content: "ok" }] },
      { role: "user", content: [{ type: "text", text: "<agent-message>hi</agent-message>" }] },
    ]);
  });

  it("tool span output replaces a returned image with a marker", async () => {
    const s = await render([
      userRow("look at it"),
      assistantRow([{ type: "tool_use", id: "tu_img", name: "Read", input: { file_path: "red.png" } }]),
      toolResultRow("tu_img", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo" } }]),
      assistantRow([{ type: "text", text: "red" }], { msgId: "m2", ts: "2026-07-08T10:00:15.000Z" }),
    ]);
    const output = attr(s["Read"], "lmnr.span.output");
    assert.ok(!String(output).includes("iVBORw0KGgo"));
    assert.deepEqual(JSON.parse(JSON.parse(output)), [{ type: "text", text: "[image]" }]);
  });

  it("spans are backdated to transcript times, and generations start when their input arrived", async () => {
    const s = await render([
      userRow("run it", "2026-07-08T10:00:00.000Z"),
      assistantRow([{ type: "tool_use", id: "t", name: "Bash", input: {} }], { ts: "2026-07-08T10:00:05.000Z" }),
      toolResultRow("t", "ok", "2026-07-08T10:00:10.000Z"),
      assistantRow([{ type: "text", text: "done" }], { msgId: "m2", ts: "2026-07-08T10:00:12.000Z" }),
    ]);
    const at = (iso: string) => Date.parse(iso);
    assert.equal(s[ROOT]!.startMs, at("2026-07-08T10:00:00.000Z"));
    assert.equal(s[ROOT]!.endMs, at("2026-07-08T10:00:12.000Z"));
    assert.deepEqual([s["LLM Call 1"]!.startMs, s["LLM Call 1"]!.endMs], [at("2026-07-08T10:00:00.000Z"), at("2026-07-08T10:00:05.000Z")]);
    assert.deepEqual([s["Bash"]!.startMs, s["Bash"]!.endMs], [at("2026-07-08T10:00:05.000Z"), at("2026-07-08T10:00:10.000Z")]);
    assert.deepEqual([s["LLM Call 2"]!.startMs, s["LLM Call 2"]!.endMs], [at("2026-07-08T10:00:10.000Z"), at("2026-07-08T10:00:12.000Z")]);
  });

  it("trace context goes in metadata; no tags", async () => {
    const s = await render([
      userRow("use a skill", undefined, { cwd: "/repo", gitBranch: "main", version: "2.1.0" }),
      assistantRow([{ type: "tool_use", id: "tu_s", name: "Skill", input: { skill: "coding" } }]),
      toolResultRow("tu_s", "ok"),
      assistantRow([{ type: "text", text: "done" }], { msgId: "m2" }),
    ]);
    const root = s[ROOT]!;
    const meta = (k: string) => attr(root, `lmnr.association.properties.metadata.${k}`);
    assert.equal(attr(root, "lmnr.association.properties.tags"), undefined);
    assert.equal(meta("skills"), "coding");
    assert.equal(meta("os"), process.platform);
    assert.equal(meta("source"), "claude-code");
    assert.equal(meta("turn_number"), "1");
    assert.equal(meta("transcript"), "session.jsonl");
    assert.equal(meta("cwd"), "/repo");
    assert.equal(meta("git_branch"), "main");
    assert.equal(meta("claude_code_version"), "2.1.0");
    // Per-tool details stay on the tool span, never in trace metadata.
    assert.equal(attr(s["Skill"], "claude_code.tool.name"), "Skill");
  });

  it("user_id goes on the root when configured", async () => {
    const session = new TestSession([userRow("hello"), assistantRow([{ type: "text", text: "hi" }])]);
    try {
      session.config = { ...session.config, userId: "user-42" };
      const { spans } = await session.end();
      assert.equal(attr(spans.find((sp) => sp.name === ROOT), "lmnr.association.properties.user_id"), "user-42");
    } finally {
      session.cleanup();
    }
  });

  it("LMNR_SPAN_CONTEXT makes turn roots children of the caller's span", async () => {
    process.env.LMNR_SPAN_CONTEXT = JSON.stringify({
      traceId: "12345678-1234-5678-9abc-def012345678",
      spanId: "00000000-0000-0000-89ab-cdef01234567",
    });
    try {
      const s = await render([userRow("hello"), assistantRow([{ type: "text", text: "hi" }])]);
      assert.equal(s[ROOT]!.traceId, "12345678-1234-5678-9abc-def012345678".replace(/-/g, ""));
      assert.equal(s[ROOT]!.parentSpanId, "89abcdef01234567");
      assert.equal(s["LLM Call 1"]!.traceId, s[ROOT]!.traceId);
      assert.equal(s["LLM Call 1"]!.parentSpanId, s[ROOT]!.spanId);
    } finally {
      delete process.env.LMNR_SPAN_CONTEXT;
    }
  });
});

describe("subagents", () => {
  const delegate = (toolName = "Agent") => [
    userRow("delegate"),
    assistantRow([{ type: "tool_use", id: "tu_task", name: toolName, input: { prompt: "go" } }]),
    toolResultRow("tu_task", "task done", "2026-07-08T10:00:09.000Z"),
    assistantRow([{ type: "text", text: "summary" }], { msgId: "m2", ts: "2026-07-08T10:00:10.000Z" }),
  ];

  it("nest under the tool span that launched them", async () => {
    const s = await render(delegate("Task"), (session) =>
      session.subagent(
        "abc",
        "tu_task",
        [
          userRow("subagent prompt", "2026-07-08T10:00:06.000Z"),
          assistantRow([{ type: "text", text: "subagent answer" }], { msgId: "sm1", ts: "2026-07-08T10:00:08.000Z" }),
        ],
        { agentType: "Explore", description: "find stuff" }
      )
    );
    const sub = s["Subagent: find stuff"]!;
    assert.equal(sub.parentSpanId, s["Task"]!.spanId);
    assert.equal(s["Subagent LLM Call 1"]!.parentSpanId, sub.spanId);
    assert.equal(attr(sub, "claude_code.subagent.type"), "Explore");
    assert.equal(attr(s["Task"], "claude_code.subagent.description"), "find stuff");
    assert.deepEqual(json(sub, "lmnr.span.input"), { role: "user", content: "subagent prompt" });
    assert.deepEqual(json(sub, "lmnr.span.output"), { role: "assistant", content: "subagent answer" });
  });

  it("a nested subagent nests under its parent subagent's tool span", async () => {
    const s = await render(delegate(), (session) => {
      session.subagent(
        "outer",
        "tu_task",
        [
          userRow("launch a nested one", "2026-07-08T10:00:06.000Z"),
          assistantRow([{ type: "tool_use", id: "tu_inner", name: "Agent", input: { prompt: "read" } }], {
            msgId: "om1",
            ts: "2026-07-08T10:00:07.000Z",
          }),
          toolResultRow("tu_inner", "first line", "2026-07-08T10:00:08.500Z"),
          assistantRow([{ type: "text", text: "nested said: first line" }], { msgId: "om2", ts: "2026-07-08T10:00:08.800Z" }),
        ],
        { description: "outer" }
      );
      session.subagent(
        "inner",
        "tu_inner",
        [userRow("read", "2026-07-08T10:00:07.500Z"), assistantRow([{ type: "text", text: "first line" }], { msgId: "im1", ts: "2026-07-08T10:00:08.000Z" })],
        { description: "inner" }
      );
    });
    const outer = s.all.filter((sp) => sp.name === "Subagent: outer");
    const inner = s["Subagent: inner"]!;
    assert.equal(outer.length, 1);
    const innerTool = s.all.find((sp) => sp.name === "Agent" && sp.parentSpanId === outer[0]!.spanId)!;
    assert.ok(innerTool, "the outer subagent's Agent call has a tool span under it");
    assert.equal(inner.parentSpanId, innerTool.spanId);
  });

  it("output falls back to a SubagentHandback report", async () => {
    const s = await render(delegate(), (session) =>
      session.subagent(
        "hb",
        "tu_task",
        [
          userRow("count words", "2026-07-08T10:00:06.000Z"),
          assistantRow([{ type: "tool_use", id: "hb", name: "SubagentHandback", input: { message: "14 words" } }], {
            msgId: "sm1",
            ts: "2026-07-08T10:00:08.000Z",
          }),
          toolResultRow("hb", "Report delivered to your caller.", "2026-07-08T10:00:08.500Z"),
        ],
        { description: "count" }
      )
    );
    assert.equal(json(s["Subagent: count"], "lmnr.span.output").content, "14 words");
  });

  it("a forked subagent's turn starts at the tool_result carrying its instructions", async () => {
    // A fork's transcript opens with a copy of the parent's Agent call, then a tool_result row with the fork instructions.
    const instructions = toolResultRow("tu_task", "forked", "2026-07-08T10:00:06.000Z", { isSidechain: true });
    instructions.message.content.push({ type: "text", text: "You are a worker fork." });
    const s = await render(delegate(), (session) =>
      session.subagent(
        "fork1",
        "tu_task",
        [
          { type: "fork-context-ref", agentId: "fork1", parentSessionId: "p" },
          assistantRow([{ type: "tool_use", id: "tu_task", name: "Agent", input: { prompt: "go" } }], { msgId: "parent", ts: "2026-07-08T10:00:05.000Z" }),
          instructions,
          assistantRow([{ type: "text", text: "fork done" }], { msgId: "f1", ts: "2026-07-08T10:00:08.000Z" }),
        ],
        { agentType: "fork", description: "fork work" }
      )
    );
    const fork = s["Subagent: fork work"]!;
    assert.equal(fork.parentSpanId, s["Agent"]!.spanId);
    assert.deepEqual(json(fork, "lmnr.span.input"), { role: "user", content: "You are a worker fork." });
    assert.deepEqual(json(fork, "lmnr.span.output"), { role: "assistant", content: "fork done" });
    assert.equal(s.all.filter((sp) => sp.name.startsWith("Subagent LLM Call")).length, 1);
  });

  it("get the tools from their own transcript", async () => {
    const read = { name: "Read", description: "Reads a file", schema: { type: "object" } };
    const handback = { name: "SubagentHandback", description: "Report back", schema: { type: "object" } };
    const s = await render(delegate(), (session) =>
      session.subagent("t", "tu_task", [
        userRow("sub prompt", "2026-07-08T10:00:06.000Z"),
        promptSnapshotRow([read, handback], "2026-07-08T10:00:06.500Z"),
        assistantRow([{ type: "text", text: "sub answer" }], { msgId: "sm1", ts: "2026-07-08T10:00:08.000Z" }),
      ])
    );
    const names = (span: any) => JSON.parse(attr(span, "gen_ai.tool.definitions") ?? "[]").map((t: any) => t.name);
    assert.deepEqual(names(s["Subagent LLM Call 1"]), ["Read", "SubagentHandback"]);
    assert.deepEqual(names(s["LLM Call 1"]), []); // the main transcript recorded none
  });

  it("a background agent's report is input only to generations after it arrived", async () => {
    const s = await render(
      [
        userRow("delegate async"),
        assistantRow([{ type: "tool_use", id: "tu_task", name: "Task", input: { prompt: "go" } }], { msgId: "m1", ts: "2026-07-08T10:00:05.000Z" }),
        toolResultRow("tu_task", "Async agent launched successfully", "2026-07-08T10:00:09.000Z", {
          toolUseResult: { status: "async_launched" },
        }),
        assistantRow([{ type: "text", text: "working on it" }], { msgId: "m2", ts: "2026-07-08T10:00:12.000Z" }),
        notificationRow("<tool-use-id>tu_task</tool-use-id><result>async task result</result>", "2026-07-08T10:00:20.000Z"),
        assistantRow([{ type: "text", text: "all done" }], { msgId: "m3", ts: "2026-07-08T10:00:25.000Z" }),
      ],
      (session) =>
        session.subagent(
          "async",
          "tu_task",
          [
            userRow("async subagent prompt", "2026-07-08T10:00:15.000Z"),
            assistantRow([{ type: "text", text: "async subagent answer" }], { msgId: "asm1", ts: "2026-07-08T10:00:18.000Z" }),
          ],
          { description: "async work" }
        )
    );
    assert.equal(s["Subagent: async work"]!.parentSpanId, s["Task"]!.spanId);
    // The tool span lasts until the agent reported back.
    assert.equal(s["Task"]!.endMs, Date.parse("2026-07-08T10:00:20.000Z"));

    const last = (messages: any[]) => messages[messages.length - 1].content[0];
    const llm2In = json(s["LLM Call 2"], "gen_ai.input.messages");
    assert.match(String(last(llm2In).content), /Async agent launched/);
    assert.ok(!JSON.stringify(llm2In).includes("async task result"));

    const llm3In = json(s["LLM Call 3"], "gen_ai.input.messages");
    assert.equal(llm3In.length, 5); // prompt, launch, launch result, "working on it", report
    assert.deepEqual(last(llm3In), { type: "tool_result", tool_use_id: "tu_task", content: "async task result" });
    assert.equal(s["LLM Call 3"]!.startMs, Date.parse("2026-07-08T10:00:20.000Z"));
  });
});
