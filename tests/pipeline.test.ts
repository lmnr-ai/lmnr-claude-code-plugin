import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { toOtlpJson } from "../src/otlp.js";
import { sessionKey } from "../src/state.js";
import {
  assistantRow,
  attr,
  json,
  jsonl,
  notificationRow,
  promptSnapshotRow,
  ROOT,
  SESSION_ID,
  spansByName,
  TestSession,
  toolResultRow,
  userRow,
} from "./helpers.js";

let session: TestSession | null = null;
const open = (rows: any[] = []) => (session = new TestSession(rows));
afterEach(() => {
  session?.cleanup();
  session = null;
});

const text = (t: string) => [{ type: "text", text: t }];
const turnNames = (spans: { name: string }[]) => spans.filter((s) => s.name.startsWith("Claude Code - Turn")).map((s) => s.name);

describe("incremental hook runs", () => {
  it("each Stop exports only the new turns, numbered across runs", async () => {
    const s = open([userRow("one"), assistantRow(text("1"), { msgId: "m1" })]);
    assert.deepEqual(turnNames((await s.stop("1")).spans), [ROOT]);

    s.append([userRow("two", "2026-07-08T10:01:00.000Z"), assistantRow(text("2"), { msgId: "m2", ts: "2026-07-08T10:01:05.000Z" })]);
    assert.deepEqual(turnNames((await s.stop("2")).spans), ["Claude Code - Turn 2 (0123abcd)"]);

    // Nothing new: nothing exported, state unchanged.
    const before = s.state();
    assert.equal((await s.stop("2")).count, 0);
    assert.deepEqual(s.state(), before);
    assert.equal(s.state()!.offset, fs.statSync(s.transcript).size);
    assert.equal(s.state()!.turnCount, 2);
  });

  it("a failed export keeps the offset, so the next run retries the same turns", async () => {
    const s = open([userRow("hello"), assistantRow(text("hi"))]);
    assert.equal((await s.stop("hi", { exportOk: false })).count, 0);
    assert.equal(s.state()!.offset, 0);
    assert.equal(s.state()!.turnCount, 0);

    const retry = await s.stop("hi");
    assert.equal(retry.count, 1);
    assert.equal(s.state()!.turnCount, 1);
  });

  it("a turn that fails to render is skipped for good and not counted", async () => {
    const s = open([
      userRow("a"),
      assistantRow(text("1"), { msgId: "m1" }),
      userRow("b"),
      assistantRow(text("2"), { msgId: "m2" }),
      userRow("c"),
      assistantRow(text("3"), { msgId: "m3" }),
    ]);
    const calls: number[] = [];
    const { count } = await s.end({
      renderFn: (_ctx, _config, _sid, turnNum) => {
        calls.push(turnNum);
        if (calls.length === 2) {
          throw new Error("boom");
        }
      },
    });
    assert.equal(count, 2);
    assert.deepEqual(calls, [1, 2, 2]); // the turn after a failure reuses its number
    assert.equal((await s.end()).count, 0); // not retried
  });

  it("prompts without any reply (e.g. local commands) export nothing", async () => {
    const s = open([userRow("/model"), userRow("hello", "2026-07-08T10:00:01.000Z"), assistantRow(text("hi"))]);
    const { spans } = await s.end();
    assert.deepEqual(turnNames(spans), [ROOT]);
    assert.deepEqual(json(spans.find((x) => x.name === ROOT), "lmnr.span.input"), { role: "user", content: "hello" });
  });
});

describe("export batching", () => {
  // A long turn repeats its growing history on every LLM span.
  const longTurn = (prompt: string, ts: string, calls: number) => {
    const rows: any[] = [userRow(prompt, ts)];
    for (let i = 0; i < calls; i++) {
      rows.push(assistantRow([{ type: "tool_use", id: `${prompt}-${i}`, name: "Read", input: {} }], { msgId: `${prompt}-m${i}`, ts }));
      rows.push(toolResultRow(`${prompt}-${i}`, "x".repeat(20000), ts));
    }
    rows.push(assistantRow(text("done"), { msgId: `${prompt}-end`, ts }));
    return rows;
  };

  it("splits a turn too big for one request across requests under the server's limit", async () => {
    const s = open(longTurn("big", "2026-07-08T10:00:00.000Z", 30));
    const sizes: number[] = [];
    const { count } = await s.end({
      exportFn: async (_config, batch) => {
        sizes.push(Buffer.byteLength(JSON.stringify(toOtlpJson(batch))));
        return true;
      },
    });
    assert.equal(count, 1);
    assert.ok(sizes.length > 1, `one request of ${sizes[0]} bytes`);
    assert.ok(Math.max(...sizes) < 5 * 1024 * 1024, `request sizes ${sizes}`);
  });

  it("after a failed request, only the turns that didn't get through are retried", async () => {
    const s = open([userRow("small"), assistantRow(text("1"), { msgId: "s1" }), ...longTurn("big", "2026-07-08T10:01:00.000Z", 30)]);
    let calls = 0;
    const first = await s.end({ exportFn: async () => ++calls === 1 }); // the second request fails
    assert.equal(first.count, 1);
    const retry = await s.end();
    assert.deepEqual(turnNames(retry.spans), ["Claude Code - Turn 2 (0123abcd)"]);
    assert.equal((await s.end()).count, 0);
  });

  it("an input history too big for one span keeps the prompt and the latest messages", async () => {
    const huge = Array.from({ length: 120 }, (_, i) => ({ type: "text", text: `${i}`.repeat(20000) }));
    const s = open([
      userRow("read everything"),
      assistantRow([{ type: "tool_use", id: "t", name: "Read", input: {} }], { msgId: "m1" }),
      toolResultRow("t", huge),
      assistantRow(text("done"), { msgId: "m2" }),
    ]);
    const input = json(spansByName((await s.end()).spans)["LLM Call 2"], "gen_ai.input.messages");
    assert.deepEqual(input, [
      { role: "user", content: text("read everything") },
      { role: "user", content: text("[2 earlier messages omitted]") },
    ]);
  });
});

describe("transcript reading", () => {
  it("parses a complete final line that has no trailing newline", async () => {
    const s = open();
    fs.writeFileSync(s.transcript, jsonl([userRow("hello")]) + JSON.stringify(assistantRow(text("hi"))));
    assert.equal((await s.stop("hi")).count, 1);
  });

  it("re-reads a partially written final row once it is complete", async () => {
    const s = open();
    const reply = JSON.stringify(assistantRow(text("hi")));
    fs.writeFileSync(s.transcript, jsonl([userRow("hello")]) + reply.slice(0, 20));
    assert.equal((await s.stop("hi")).count, 0);
    fs.appendFileSync(s.transcript, reply.slice(20) + "\n");
    const { spans } = await s.stop("hi");
    assert.deepEqual(json(spansByName(spans)[ROOT], "lmnr.span.output"), { role: "assistant", content: "hi" });
  });

  it("starts over when the transcript shrinks", async () => {
    const s = open([userRow("one"), assistantRow(text("1")), userRow("two"), assistantRow(text("2"), { msgId: "m2" })]);
    assert.equal((await s.stop("2")).count, 2);
    fs.writeFileSync(s.transcript, jsonl([userRow("fresh"), assistantRow(text("3"), { msgId: "m3" })]));
    const { spans } = await s.stop("3");
    assert.deepEqual(turnNames(spans), ["Claude Code - Turn 3 (0123abcd)"]);
  });
});

describe("incomplete trailing turn (flush race)", () => {
  // Claude Code fires Stop before it writes the turn's final row.
  it("holds a prompt with no reply yet, and exports it once the reply lands", async () => {
    const s = open([userRow("hi")]);
    assert.equal((await s.stop("yo")).count, 0);
    s.append([assistantRow(text("yo"))]);
    const { count, spans } = await s.stop("yo");
    assert.equal(count, 1);
    assert.deepEqual(json(spans.find((x) => x.name === ROOT), "lmnr.span.output"), { role: "assistant", content: "yo" });
  });

  it("holds a turn ending in a tool_result, and exports it with its final answer", async () => {
    const s = open([
      userRow("read it"),
      assistantRow([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }], { msgId: "m1" }),
      toolResultRow("t1", "contents"),
    ]);
    assert.equal((await s.stop("done")).count, 0);
    s.append([assistantRow(text("done"), { msgId: "m2", ts: "2026-07-08T10:00:12.000Z" })]);
    const { spans } = await s.stop("done");
    const byName = spansByName(spans);
    assert.ok(byName["LLM Call 2"]);
    assert.match(String(attr(byName[ROOT], "lmnr.span.output")), /done/);
  });

  it("holds a turn until the text the Stop payload names is written", async () => {
    const s = open([userRow("hi"), assistantRow([{ type: "thinking", thinking: "hmm" }], { msgId: "m1" })]);
    assert.equal((await s.stop("All done.")).count, 0);
    s.append([assistantRow(text("All done."), { msgId: "m1" })]);
    const { spans } = await s.stop("All done.");
    assert.match(String(attr(spansByName(spans)[ROOT], "lmnr.span.output")), /All done\./);
  });

  it("SessionEnd exports a held turn as it is", async () => {
    const s = open([userRow("read it"), assistantRow([{ type: "tool_use", id: "t1", name: "Read", input: {} }]), toolResultRow("t1", "x")]);
    assert.equal((await s.stop("")).count, 0);
    assert.equal((await s.end()).count, 1);
  });

  it("earlier complete turns go out while the last one is held", async () => {
    const s = open([userRow("one"), assistantRow(text("1"), { msgId: "m1" }), userRow("two")]);
    assert.deepEqual(turnNames((await s.stop("2")).spans), [ROOT]);
    s.append([assistantRow(text("2"), { msgId: "m2" })]);
    assert.deepEqual(turnNames((await s.stop("2")).spans), ["Claude Code - Turn 2 (0123abcd)"]);
  });
});

describe("background agents", () => {
  const launchTurn = (prompt = "count words in the background", ts = "2026-07-08T10:00:00.000Z") => [
    userRow(prompt, ts),
    assistantRow([{ type: "tool_use", id: "tu_bg", name: "Agent", input: { prompt: "count", run_in_background: true } }], {
      msgId: "m1",
      ts: "2026-07-08T10:00:01.000Z",
    }),
    toolResultRow("tu_bg", "Async agent launched successfully", "2026-07-08T10:00:02.000Z", { toolUseResult: { status: "async_launched" } }),
    assistantRow(text("Running in the background."), { msgId: "m2", ts: "2026-07-08T10:00:03.000Z" }),
  ];
  const report = notificationRow("<tool-use-id>tu_bg</tool-use-id><result>13 words</result>", "2026-07-08T10:00:12.000Z");

  it("a turn waits for its agent's report, and includes Claude's reply to the agent's message", async () => {
    const s = open(launchTurn());
    assert.equal((await s.stop("Running in the background.")).count, 0);

    // The agent reports back as an injected message, and Claude answers it — no new prompt in between.
    s.append([
      userRow("<agent-message>13 words</agent-message>", "2026-07-08T10:00:10.000Z", { isMeta: true }),
      assistantRow(text("It has 13 words."), { msgId: "m3", ts: "2026-07-08T10:00:11.000Z" }),
    ]);
    assert.equal((await s.stop("It has 13 words.")).count, 0);

    s.append([report]);
    const { count, spans } = await s.stop("");
    assert.equal(count, 1);
    const byName = spansByName(spans);
    const input = json(byName["LLM Call 3"], "gen_ai.input.messages");
    assert.deepEqual(input[input.length - 1], { role: "user", content: text("<agent-message>13 words</agent-message>") });
    assert.match(String(attr(byName[ROOT], "lmnr.span.output")), /13 words/);
    assert.equal(byName["Agent"]!.endMs, Date.parse("2026-07-08T10:00:12.000Z"));
  });

  it("later turns go out while an earlier one waits, and are not exported twice", async () => {
    const s = open(launchTurn());
    assert.equal((await s.stop("Running in the background.")).count, 0);

    s.append([userRow("unrelated", "2026-07-08T10:01:00.000Z"), assistantRow(text("sure"), { msgId: "m4", ts: "2026-07-08T10:01:01.000Z" })]);
    assert.deepEqual(turnNames((await s.stop("sure")).spans), [ROOT]); // turn numbers follow export order

    // The report lands after the next prompt; it belongs to the launching turn.
    s.append([{ ...report, timestamp: "2026-07-08T10:01:02.000Z" }, assistantRow(text("noted"), { msgId: "m5", ts: "2026-07-08T10:01:03.000Z" })]);
    const { spans } = await s.stop("noted");
    assert.deepEqual(turnNames(spans), ["Claude Code - Turn 2 (0123abcd)"]);
    assert.equal(json(spans.find((x) => x.name.startsWith("Claude Code")), "lmnr.span.input").content, "count words in the background");
    assert.deepEqual(s.state()!.exported, []);
    assert.equal(s.state()!.offset, fs.statSync(s.transcript).size);
  });

  it("only the delivered report counts, not Claude Code's queue bookkeeping", async () => {
    const s = open(launchTurn());
    s.append([{ type: "queue-operation", operation: "enqueue", timestamp: "2026-07-08T10:00:11.000Z", content: report.message.content }]);
    assert.equal((await s.stop("Running in the background.")).count, 0);

    // Mid-turn, the report reaches the model as a queued_command attachment.
    s.append([
      {
        type: "attachment",
        timestamp: "2026-07-08T10:00:11.000Z",
        attachment: { type: "queued_command", commandMode: "task-notification", prompt: report.message.content },
      },
    ]);
    assert.equal((await s.stop("")).count, 1);
  });

  it("a report that names only the task id is attributed through the subagent's meta.json", async () => {
    const s = open(launchTurn());
    s.subagent("xyz", "tu_bg", [userRow("count"), assistantRow(text("13"))]);
    s.append([notificationRow("<task-id>xyz</task-id><result>13 words</result>", "2026-07-08T10:00:12.000Z")]);
    assert.equal((await s.stop("")).count, 1);
  });

  it("SessionEnd exports a turn still waiting on its agent", async () => {
    const s = open(launchTurn());
    assert.equal((await s.stop("Running in the background.")).count, 0);
    assert.equal((await s.end()).count, 1);
  });

  it("a synchronous agent never makes its turn wait", async () => {
    const s = open([
      userRow("run agent"),
      assistantRow([{ type: "tool_use", id: "tu_sync", name: "Task", input: {} }]),
      toolResultRow("tu_sync", "agent finished: result text"),
      assistantRow(text("summary"), { msgId: "m2" }),
    ]);
    assert.equal((await s.stop("summary")).count, 1);
  });
});

describe("tool definitions across hook runs", () => {
  it("a tool set recorded in an earlier run still applies when later runs record none", async () => {
    const read = { name: "Read", description: "Reads a file", schema: { type: "object" } };
    const s = open([
      userRow("first", "2026-07-08T10:00:00.000Z"),
      promptSnapshotRow([read], "2026-07-08T10:00:00.500Z"),
      assistantRow(text("one"), { msgId: "m1", ts: "2026-07-08T10:00:01.000Z" }),
    ]);
    const tools = (spans: any[]) => json(spansByName(spans)["LLM Call 1"], "gen_ai.tool.definitions");
    assert.deepEqual(tools((await s.stop("one")).spans), [{ name: "Read", description: "Reads a file", input_schema: { type: "object" } }]);

    s.append([userRow("second", "2026-07-08T10:01:00.000Z"), assistantRow(text("two"), { msgId: "m2", ts: "2026-07-08T10:01:01.000Z" })]);
    assert.deepEqual(tools((await s.stop("two")).spans).map((t: any) => t.name), ["Read"]);
  });
});

describe("upgrade from the shared lmnr_state.json of earlier versions", () => {
  const writeLegacy = (s: TestSession, entry: object) => {
    const dir = path.join(s.dir, "state");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "lmnr_state.json"), JSON.stringify({ [sessionKey(SESSION_ID, s.transcript)]: entry }));
  };

  it("resumes where the old version stopped reading, without re-exporting", async () => {
    const done = jsonl([userRow("one"), assistantRow(text("1"))]);
    const s = open();
    fs.writeFileSync(s.transcript, done + '{"partial":');
    writeLegacy(s, { offset: Buffer.byteLength(done) + 11, buffer: '{"partial":', turnCount: 4 });
    fs.writeFileSync(s.transcript, done + jsonl([userRow("two"), assistantRow(text("2"), { msgId: "m2" })]));
    const { spans } = await s.stop("2");
    assert.deepEqual(turnNames(spans), ["Claude Code - Turn 5 (0123abcd)"]);
  });

  it("re-reads turns the old version was holding, and skips the ones it exported", async () => {
    const launch = [
      userRow("launch", "2026-07-08T10:00:00.000Z", { uuid: "u-launch" }),
      assistantRow([{ type: "tool_use", id: "tu_bg", name: "Agent", input: {} }], { msgId: "m1" }),
      toolResultRow("tu_bg", "Async agent launched successfully", undefined, { toolUseResult: { status: "async_launched" } }),
    ];
    const exportedTurn = [userRow("between", "2026-07-08T10:01:00.000Z", { uuid: "u-between" }), assistantRow(text("ok"), { msgId: "m2" })];
    const heldTail = [userRow("last", "2026-07-08T10:02:00.000Z", { uuid: "u-last" })];
    const s = open([...launch, ...exportedTurn, ...heldTail]);
    writeLegacy(s, {
      offset: fs.statSync(s.transcript).size,
      buffer: "",
      turnCount: 1,
      pendingAgentTurns: [{ pendingToolUseIds: ["tu_bg"], resolvedToolUseIds: [], rows: launch }],
      pendingTurnRows: heldTail,
    });
    s.append([
      assistantRow(text("reply"), { msgId: "m3", ts: "2026-07-08T10:02:01.000Z" }),
      notificationRow("<tool-use-id>tu_bg</tool-use-id><result>r</result>", "2026-07-08T10:02:02.000Z"),
    ]);
    const { spans } = await s.end();
    const inputs = spans.filter((x) => x.name.startsWith("Claude Code")).map((x) => json(x, "lmnr.span.input").content);
    assert.deepEqual(inputs.sort(), ["last", "launch"]);
  });
});
