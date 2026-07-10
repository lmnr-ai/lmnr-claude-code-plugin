import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";

// Keep the plugin's log/state out of the real ~/.claude/state during tests.
process.env.CC_LMNR_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-testlog-"));

import { getLaminarConfig } from "../src/config.js";
import { getPendingAgentToolUseIds, getTaskIdToToolUseId, getTurnsToEmit, resolveDeferredAgentTurns } from "../src/deferral.js";
import { buildGenerationAttributes } from "../src/genai.js";
import { getResultFromTaskNotification, getToolUseIdForTaskNotification, isTaskNotificationRow } from "../src/notifications.js";
import { getSessionState, SessionState, updateSessionState, type GlobalState } from "../src/state.js";
import { getSubagentTranscriptsByToolUseId } from "../src/subagents.js";
import { extractTextFromContent, getUsageDetailsFromRow, readNewJsonl, truncateText } from "../src/transcript.js";
import { buildTurns, mergeAssistantRows } from "../src/turns.js";
import { assistantRow, toolResultRow, userRow } from "./helpers.js";

describe("buildTurns", () => {
  it("simple turn", () => {
    const turns = buildTurns([userRow("hello"), assistantRow([{ type: "text", text: "hi there" }])]);
    assert.equal(turns.length, 1);
    assert.equal(extractTextFromContent(turns[0]!.userMsg.message.content), "hello");
    assert.equal(turns[0]!.assistantMsgs.length, 1);
  });

  it("two turns", () => {
    const turns = buildTurns([
      userRow("first"),
      assistantRow([{ type: "text", text: "one" }], { msgId: "m1" }),
      userRow("second", "2026-07-08T10:01:00.000Z"),
      assistantRow([{ type: "text", text: "two" }], { msgId: "m2", ts: "2026-07-08T10:01:05.000Z" }),
    ]);
    assert.equal(turns.length, 2);
  });

  it("tool use turn", () => {
    const turns = buildTurns([
      userRow("run ls"),
      assistantRow(
        [
          { type: "text", text: "running" },
          { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
        ],
        { msgId: "m1" }
      ),
      toolResultRow("tu_1", "file.txt"),
      assistantRow([{ type: "text", text: "done" }], { msgId: "m2", ts: "2026-07-08T10:00:15.000Z" }),
    ]);
    assert.equal(turns.length, 1);
    const turn = turns[0]!;
    assert.equal(turn.assistantMsgs.length, 2);
    assert.equal(turn.toolResultsById["tu_1"]!.content, "file.txt");
  });

  it("isMeta rows do not start turns", () => {
    const turns = buildTurns([
      userRow("real prompt"),
      userRow("injected caveat", "2026-07-08T10:00:00.000Z", { isMeta: true }),
      assistantRow([{ type: "text", text: "reply" }]),
    ]);
    assert.equal(turns.length, 1);
    assert.equal(extractTextFromContent(turns[0]!.userMsg.message.content), "real prompt");
  });

  it("injected skill content keyed by tool_use", () => {
    const turns = buildTurns([
      userRow("use skill"),
      assistantRow([{ type: "tool_use", id: "tu_skill", name: "Skill", input: { skill: "coding" } }]),
      {
        type: "user",
        isMeta: true,
        sourceToolUseID: "tu_skill",
        message: { role: "user", content: "skill instructions" },
        timestamp: "2026-07-08T10:00:07.000Z",
      },
      toolResultRow("tu_skill", "ok"),
      assistantRow([{ type: "text", text: "done" }], { msgId: "m2" }),
    ]);
    assert.equal(turns[0]!.injectedByToolId["tu_skill"], "skill instructions");
  });

  it("assistant rows merged by message.id", () => {
    const turns = buildTurns([
      userRow("go"),
      assistantRow([{ type: "text", text: "part1" }], { msgId: "m1" }),
      assistantRow([{ type: "tool_use", id: "tu_1", name: "Bash", input: {} }], { msgId: "m1" }),
    ]);
    assert.equal(turns[0]!.assistantMsgs.length, 1);
    assert.equal(turns[0]!.assistantMsgs[0]!.message.content.length, 2);
  });

  it("assistant before user ignored", () => {
    const turns = buildTurns([
      assistantRow([{ type: "text", text: "orphan" }]),
      userRow("hello"),
      assistantRow([{ type: "text", text: "hi" }], { msgId: "m2" }),
    ]);
    assert.equal(turns.length, 1);
  });

  it("turn without assistant dropped", () => {
    assert.deepEqual(buildTurns([userRow("no reply yet")]), []);
  });
});

describe("mergeAssistantRows", () => {
  it("string content wrapped", () => {
    const merged = mergeAssistantRows([
      { message: { id: "m", role: "assistant", content: "text a" } },
      { message: { id: "m", role: "assistant", content: [{ type: "text", text: "b" }] } },
    ]);
    const content = merged.message.content;
    assert.deepEqual(content[0], { type: "text", text: "text a" });
    assert.deepEqual(content[1], { type: "text", text: "b" });
  });
});

describe("usage", () => {
  it("usage extracted", () => {
    const row = assistantRow([{ type: "text", text: "x" }]);
    row.message.usage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 300,
    };
    assert.deepEqual(getUsageDetailsFromRow(row), {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 300,
    });
  });

  it("zero and missing skipped", () => {
    const row = assistantRow([{ type: "text", text: "x" }]);
    row.message.usage = { input_tokens: 0, output_tokens: 7 };
    assert.deepEqual(getUsageDetailsFromRow(row), { output_tokens: 7 });
  });

  it("no usage", () => {
    const row = assistantRow([{ type: "text", text: "x" }]);
    delete row.message.usage;
    assert.equal(getUsageDetailsFromRow(row), null);
  });
});

describe("truncate", () => {
  it("no truncation", () => {
    const [text, meta] = truncateText("short");
    assert.equal(text, "short");
    assert.equal(meta.truncated, false);
  });

  it("truncation", () => {
    const [text, meta] = truncateText("a".repeat(30000), 100);
    assert.equal(text.length, 100);
    assert.equal(meta.truncated, true);
    assert.equal(meta.orig_len, 30000);
    assert.ok(meta.sha256);
  });
});

describe("async agent deferral", () => {
  const asyncAgentTurnRows = () => [
    userRow("launch agent"),
    assistantRow([{ type: "tool_use", id: "tu_agent", name: "Agent", input: { prompt: "do work" } }]),
    toolResultRow("tu_agent", "Async agent launched successfully", "2026-07-08T10:00:10.000Z", {
      toolUseResult: { status: "async_launched" },
    }),
    assistantRow([{ type: "text", text: "launched, waiting" }], { msgId: "m2" }),
  ];

  it("async turn deferred", () => {
    const turns = buildTurns(asyncAgentTurnRows());
    assert.deepEqual(getPendingAgentToolUseIds(turns[0]!), ["tu_agent"]);

    const state = new SessionState();
    const toEmit = getTurnsToEmit(turns, state);
    assert.deepEqual(toEmit, []);
    assert.equal(state.pendingAgentTurns.length, 1);
    assert.deepEqual(state.pendingAgentTurns[0]!.pendingToolUseIds, ["tu_agent"]);
  });

  it("async turn flushed at session end", () => {
    const turns = buildTurns(asyncAgentTurnRows());
    const state = new SessionState();
    const toEmit = getTurnsToEmit(turns, state, true);
    assert.equal(toEmit.length, 1);
  });

  it("sync agent not deferred", () => {
    const turns = buildTurns([
      userRow("run agent"),
      assistantRow([{ type: "tool_use", id: "tu_sync", name: "Task", input: {} }]),
      toolResultRow("tu_sync", "agent finished: result text"),
      assistantRow([{ type: "text", text: "summary" }], { msgId: "m2" }),
    ]);
    assert.deepEqual(getPendingAgentToolUseIds(turns[0]!), []);
  });

  it("task notification resolves tool result", () => {
    const notification =
      "<task-notification><tool-use-id>tu_agent</tool-use-id>" +
      "<result>agent output here</result></task-notification>";
    const rows = [
      ...asyncAgentTurnRows(),
      userRow(notification, "2026-07-08T10:05:00.000Z"),
      assistantRow([{ type: "text", text: "agent done" }], { msgId: "m3", ts: "2026-07-08T10:05:05.000Z" }),
    ];
    const turns = buildTurns(rows);
    assert.equal(turns.length, 1);
    const entry = turns[0]!.toolResultsById["tu_agent"]!;
    assert.equal(entry.finalContent, "agent output here");
    assert.deepEqual(getPendingAgentToolUseIds(turns[0]!), []);
  });
});

describe("resolveDeferredAgentTurns", () => {
  const deferredState = () =>
    new SessionState({
      pendingAgentTurns: [
        {
          pendingToolUseIds: ["tu_agent"],
          resolvedToolUseIds: [],
          rows: [userRow("launch agent"), assistantRow([{ type: "tool_use", id: "tu_agent", name: "Agent", input: {} }])],
        },
      ],
    });

  const notif = (inner: string, ts = "2026-07-08T10:05:00.000Z") =>
    userRow(`<task-notification>${inner}</task-notification>`, ts);

  it("routes a tool-use-id notification to its deferred turn, pops it, and drops it from the batch", () => {
    const state = deferredState();
    const notification = notif("<tool-use-id>tu_agent</tool-use-id><result>done</result>");
    const unrelated = userRow("new prompt", "2026-07-08T10:06:00.000Z");

    const [resolved, remaining] = resolveDeferredAgentTurns([notification, unrelated], state);

    assert.equal(resolved.length, 1);
    assert.equal(state.pendingAgentTurns.length, 0);
    assert.ok(resolved[0]!.includes(notification));
    assert.deepEqual(remaining, [unrelated]);
  });

  it("resolves a task-id-only notification through the agentId bridge", () => {
    const state = deferredState();
    const [resolved] = resolveDeferredAgentTurns([notif("<task-id>agent-xyz</task-id><result>done</result>")], state, {
      "agent-xyz": "tu_agent",
    });
    assert.equal(resolved.length, 1);
    assert.equal(state.pendingAgentTurns.length, 0);
  });

  it("stashes an unattributable notification for retry instead of dropping it", () => {
    const state = deferredState();
    const [resolved, remaining] = resolveDeferredAgentTurns([notif("<task-id>unknown</task-id><result>done</result>")], state);
    assert.equal(resolved.length, 0);
    assert.equal(state.pendingAgentTurns.length, 1);
    assert.equal(state.pendingTaskNotifications.length, 1);
    assert.deepEqual(remaining, []);
  });

  it("retries a previously stashed notification once the bridge can attribute it", () => {
    const state = deferredState();
    state.pendingTaskNotifications = [notif("<task-id>agent-xyz</task-id><result>done</result>")];
    const [resolved] = resolveDeferredAgentTurns([], state, { "agent-xyz": "tu_agent" });
    assert.equal(resolved.length, 1);
    assert.equal(state.pendingTaskNotifications.length, 0);
  });

  it("leaves an unrelated notification in the batch for normal assembly", () => {
    const state = new SessionState();
    const notification = notif("<tool-use-id>tu_other</tool-use-id><result>x</result>");
    const [resolved, remaining] = resolveDeferredAgentTurns([notification], state);
    assert.equal(resolved.length, 0);
    assert.deepEqual(remaining, [notification]);
  });
});

describe("task-notification parsing", () => {
  const notif = (inner: string) => userRow(`<task-notification>${inner}</task-notification>`);

  it("detects notification rows by leading tag or origin kind", () => {
    assert.equal(isTaskNotificationRow(notif("<result>x</result>")), true);
    assert.equal(isTaskNotificationRow(userRow("a normal prompt")), false);
    assert.equal(isTaskNotificationRow(userRow("hi", undefined, { origin: { kind: "task-notification" } })), true);
  });

  it("extracts the result tag, falling back to the full text when absent", () => {
    assert.equal(getResultFromTaskNotification(notif("<result>the answer</result>")), "the answer");
    assert.ok(getResultFromTaskNotification(notif("<tool-use-id>t</tool-use-id>")).includes("<tool-use-id>"));
  });

  it("prefers tool-use-id, else maps task-id via the bridge, else null", () => {
    assert.equal(getToolUseIdForTaskNotification(notif("<tool-use-id>tu_1</tool-use-id>")), "tu_1");
    assert.equal(getToolUseIdForTaskNotification(notif("<task-id>a1</task-id>"), { a1: "tu_2" }), "tu_2");
    assert.equal(getToolUseIdForTaskNotification(notif("<task-id>a1</task-id>")), null);
    assert.equal(getToolUseIdForTaskNotification(userRow("not a notification")), null);
  });
});

describe("subagent transcript discovery", () => {
  it("maps tool_use ids to subagent transcripts from meta.json files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-disc-"));
    try {
      const transcriptPath = path.join(dir, "session.jsonl");
      fs.writeFileSync(transcriptPath, "");
      const subDir = path.join(dir, "session", "subagents");
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, "agent-xyz.jsonl"), "{}\n");
      fs.writeFileSync(
        path.join(subDir, "agent-xyz.meta.json"),
        JSON.stringify({ toolUseId: "tu_1", agentType: "Explore", description: "d" })
      );
      // A meta.json with no matching .jsonl is ignored.
      fs.writeFileSync(path.join(subDir, "agent-orphan.meta.json"), JSON.stringify({ toolUseId: "tu_2" }));

      const map = getSubagentTranscriptsByToolUseId(transcriptPath);
      assert.deepEqual(Object.keys(map), ["tu_1"]);
      assert.equal(map["tu_1"]!.agentId, "xyz");
      assert.equal(map["tu_1"]!.agentType, "Explore");
      // The agentId->toolUseId bridge derives from the same map.
      assert.deepEqual(getTaskIdToToolUseId(map), { xyz: "tu_1" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty when there is no subagents directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-disc2-"));
    try {
      const transcriptPath = path.join(dir, "session.jsonl");
      fs.writeFileSync(transcriptPath, "");
      assert.deepEqual(getSubagentTranscriptsByToolUseId(transcriptPath), {});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readNewJsonl", () => {
  const withTmp = (fn: (dir: string) => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-test-"));
    try {
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it("incremental read", () => {
    withTmp((dir) => {
      const p = path.join(dir, "t.jsonl");
      fs.writeFileSync(p, JSON.stringify({ a: 1 }) + "\n");
      const state = new SessionState();
      let msgs;
      [msgs] = readNewJsonl(p, state);
      assert.deepEqual(msgs, [{ a: 1 }]);

      fs.appendFileSync(p, JSON.stringify({ b: 2 }) + "\n");
      [msgs] = readNewJsonl(p, state);
      assert.deepEqual(msgs, [{ b: 2 }]);
    });
  });

  it("partial line buffered", () => {
    withTmp((dir) => {
      const p = path.join(dir, "t.jsonl");
      fs.writeFileSync(p, '{"a": 1}\n{"b":');
      const state = new SessionState();
      let msgs;
      [msgs] = readNewJsonl(p, state);
      assert.deepEqual(msgs, [{ a: 1 }]);
      assert.equal(state.buffer, '{"b":');

      fs.appendFileSync(p, " 2}\n");
      [msgs] = readNewJsonl(p, state);
      assert.deepEqual(msgs, [{ b: 2 }]);
    });
  });

  it("complete unterminated final line flushed at session end", () => {
    withTmp((dir) => {
      const p = path.join(dir, "t.jsonl");
      // No trailing newline: the final row would otherwise sit in the buffer
      // forever once offset reaches EOF.
      fs.writeFileSync(p, '{"a": 1}\n{"b": 2}');
      const state = new SessionState();
      let msgs;
      [msgs] = readNewJsonl(p, state);
      assert.deepEqual(msgs, [{ a: 1 }]);
      assert.equal(state.buffer, '{"b": 2}');

      // Later runs read zero new bytes; without flushing the row stays held.
      [msgs] = readNewJsonl(p, state);
      assert.deepEqual(msgs, []);

      [msgs] = readNewJsonl(p, state, true);
      assert.deepEqual(msgs, [{ b: 2 }]);
      assert.equal(state.buffer, "");
    });
  });

  it("genuinely partial line stays buffered even when flushing", () => {
    withTmp((dir) => {
      const p = path.join(dir, "t.jsonl");
      fs.writeFileSync(p, '{"a": 1}\n{"b":');
      const state = new SessionState();
      readNewJsonl(p, state);

      const [msgs] = readNewJsonl(p, state, true);
      assert.deepEqual(msgs, []);
      assert.equal(state.buffer, '{"b":');
    });
  });

  it("shrunk file restarts", () => {
    withTmp((dir) => {
      const p = path.join(dir, "t.jsonl");
      fs.writeFileSync(p, '{"a": 1}\n{"b": 2}\n');
      const state = new SessionState();
      readNewJsonl(p, state);

      fs.writeFileSync(p, '{"c": 3}\n');
      const [msgs] = readNewJsonl(p, state);
      assert.deepEqual(msgs, [{ c: 3 }]);
    });
  });
});

describe("SessionState serialization", () => {
  it("round-trips populated pending fields across a JSON boundary", () => {
    const state = new SessionState({
      offset: 42,
      buffer: "partial-line",
      turnCount: 3,
      pendingAgentTurns: [{ pendingToolUseIds: ["t1"], resolvedToolUseIds: ["t0"], rows: [userRow("held")] }],
      pendingTaskNotifications: [userRow("<task-notification>x</task-notification>")],
      pendingTurnRows: [userRow("trailing")],
    });
    const global: GlobalState = {};
    updateSessionState(global, "k", state);
    // Mirror the on-disk round trip: write → JSON → read.
    const reloaded = getSessionState(JSON.parse(JSON.stringify(global)), "k");

    assert.equal(reloaded.offset, 42);
    assert.equal(reloaded.buffer, "partial-line");
    assert.equal(reloaded.turnCount, 3);
    assert.equal(reloaded.pendingAgentTurns.length, 1);
    assert.deepEqual(reloaded.pendingAgentTurns[0]!.pendingToolUseIds, ["t1"]);
    assert.deepEqual(reloaded.pendingAgentTurns[0]!.resolvedToolUseIds, ["t0"]);
    assert.equal(reloaded.pendingAgentTurns[0]!.rows.length, 1);
    assert.equal(reloaded.pendingTaskNotifications.length, 1);
    assert.equal(reloaded.pendingTurnRows.length, 1);
  });

  it("drops malformed pendingAgentTurns entries instead of trusting them", () => {
    const global: GlobalState = {
      k: {
        offset: 0,
        buffer: "",
        turnCount: 0,
        pendingAgentTurns: [
          { pendingToolUseIds: ["ok"], resolvedToolUseIds: [], rows: [] },
          { pendingToolUseIds: "not-an-array", resolvedToolUseIds: [], rows: [] },
          null,
          42,
        ],
        pendingTaskNotifications: [],
        pendingTurnRows: [],
      },
    };
    const reloaded = getSessionState(global, "k");
    assert.equal(reloaded.pendingAgentTurns.length, 1);
    assert.deepEqual(reloaded.pendingAgentTurns[0]!.pendingToolUseIds, ["ok"]);
  });

  it("defaults missing or garbage-typed fields", () => {
    const reloaded = getSessionState({ k: { pendingAgentTurns: "nope", offset: "x" } }, "k");
    assert.equal(reloaded.buffer, "");
    assert.equal(reloaded.turnCount, 0);
    assert.deepEqual(reloaded.pendingAgentTurns, []);
    assert.deepEqual(reloaded.pendingTaskNotifications, []);
  });
});

describe("user_id resolution", () => {
  it("prefers LMNR_USER_ID, then lmnr-cli credentials email, then null", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-creds-"));
    const saved: Record<string, string | undefined> = {};
    const set = (k: string, v: string | undefined) => {
      if (!(k in saved)) saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    };
    try {
      // Neutralize plugin-option overrides and point the CLI config dir at a temp.
      for (const k of ["CLAUDE_PLUGIN_OPTION_LMNR_PROJECT_API_KEY", "CLAUDE_PLUGIN_OPTION_LMNR_USER_ID", "LMNR_USER_ID"]) {
        set(k, undefined);
      }
      set("LMNR_PROJECT_API_KEY", "k");
      set("XDG_CONFIG_HOME", dir);

      // No credentials file and no explicit id → null.
      assert.equal(getLaminarConfig()!.userId, null);

      // Credentials file present → email wins over user id.
      fs.mkdirSync(path.join(dir, "lmnr"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "lmnr", "credentials.json"),
        JSON.stringify({ userEmail: "me@example.com", userId: "u1" })
      );
      assert.equal(getLaminarConfig()!.userId, "me@example.com");

      // Explicit env overrides the credentials file.
      set("LMNR_USER_ID", "explicit");
      assert.equal(getLaminarConfig()!.userId, "explicit");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("gen_ai wire-format serialization", () => {
  const parse = (v: any) => JSON.parse(v as string);

  it("first generation uses the user prompt as input, and reports usage", () => {
    const [attrs, toolUses] = buildGenerationAttributes(0, assistantRow([{ type: "text", text: "hello" }]), "the question", [], []);
    assert.deepEqual(parse(attrs["gen_ai.input.messages"]), [{ role: "user", content: "the question" }]);
    const output = parse(attrs["gen_ai.output.messages"]);
    assert.equal(output[0].role, "assistant");
    assert.equal(output[0].content, "hello");
    assert.equal(attrs["gen_ai.system"], "anthropic");
    assert.equal(attrs["gen_ai.usage.input_tokens"], 10);
    assert.equal(attrs["gen_ai.usage.output_tokens"], 5);
    assert.equal(attrs["llm.usage.total_tokens"], 15);
    assert.equal(toolUses.length, 0);
  });

  it("later generations fold previous tool results into OpenAI-style tool messages", () => {
    const [attrs] = buildGenerationAttributes(
      1,
      assistantRow([{ type: "text", text: "done" }]),
      "ignored after first generation",
      [{ toolUseId: "t1", toolName: "Bash", output: "ok" }],
      []
    );
    const input = parse(attrs["gen_ai.input.messages"]);
    assert.equal(input.length, 1);
    assert.equal(input[0].role, "tool");
    assert.equal(input[0].tool_call_id, "t1");
    assert.equal(input[0].name, "Bash");
  });

  it("folds ready async results alongside previous tool results", () => {
    const [attrs] = buildGenerationAttributes(
      1,
      assistantRow([{ type: "text", text: "done" }]),
      "",
      [{ toolUseId: "t1", toolName: "Bash", output: "ok" }],
      [{ toolUseId: "a1", toolName: "Agent", output: "async-result" }]
    );
    const input = parse(attrs["gen_ai.input.messages"]);
    assert.deepEqual(
      input.map((m: any) => m.tool_call_id),
      ["t1", "a1"]
    );
  });

  it("emits tool_calls on the output message when the assistant calls tools", () => {
    const asst = assistantRow([
      { type: "text", text: "calling" },
      { type: "tool_use", id: "u1", name: "Read", input: { path: "/x" } },
    ]);
    const [attrs, toolUses] = buildGenerationAttributes(0, asst, "q", [], []);
    const output = parse(attrs["gen_ai.output.messages"]);
    assert.equal(output[0].tool_calls[0].id, "u1");
    assert.equal(output[0].tool_calls[0].name, "Read");
    assert.deepEqual(output[0].tool_calls[0].arguments, { path: "/x" });
    assert.equal(toolUses.length, 1);
  });
});
