import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";

process.env.CC_LMNR_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-tools-"));

import { ToolTimeline } from "../src/tools.js";
import { deferredToolsRow, promptSnapshotRow } from "./helpers.js";

const read = { name: "Read", description: "Reads a file", schema: { type: "object" } };
const bash = { name: "Bash", description: "Runs a command", schema: { type: "object" } };
const counter = {
  name: "mcp__demo__word_counter",
  description: "Counts words",
  input_schema: { type: "object" },
  defer_loading: true,
};

describe("ToolTimeline", () => {
  it("tracks inline and deferred tools by time, in Anthropic tool format", () => {
    const timeline = ToolTimeline.fromRows([
      promptSnapshotRow(null, "2026-07-08T10:00:00.000Z"), // first request: not recorded
      promptSnapshotRow([read, bash], "2026-07-08T10:00:02.000Z"),
      deferredToolsRow([counter], "2026-07-08T10:00:04.000Z"),
    ]);
    const names = (ts: string) => timeline.toolsAt(ts)?.map((t) => t.name);

    // Before the first recorded set: the first request was sent the same tools.
    assert.deepEqual(names("2026-07-08T10:00:01.000Z"), ["Read", "Bash"]);
    assert.deepEqual(names("2026-07-08T10:00:03.000Z"), ["Read", "Bash"]);
    assert.deepEqual(names("2026-07-08T10:00:05.000Z"), ["Read", "Bash", "mcp__demo__word_counter"]);

    // `schema` becomes `input_schema`; deferred-only fields are dropped.
    assert.deepEqual(timeline.toolsAt("2026-07-08T10:00:05.000Z")![2], {
      name: "mcp__demo__word_counter",
      description: "Counts words",
      input_schema: { type: "object" },
    });
    assert.deepEqual(timeline.toolsAt("2026-07-08T10:00:03.000Z")![0], {
      name: "Read",
      description: "Reads a file",
      input_schema: { type: "object" },
    });
  });

  it("records a change only when the set actually changes", () => {
    const timeline = ToolTimeline.fromRows([
      promptSnapshotRow([read], "2026-07-08T10:00:00.000Z"),
      promptSnapshotRow([read], "2026-07-08T10:00:05.000Z"),
    ]);
    assert.equal(timeline.changes.length, 1);
  });

  it("has no tools when the transcript records none", () => {
    assert.equal(ToolTimeline.fromRows([promptSnapshotRow(null, "2026-07-08T10:00:00.000Z")]).toolsAt("2026-07-08T10:00:01.000Z"), null);
  });

  it("resumes from persisted changes in a later hook run", () => {
    const first = new ToolTimeline();
    first.observe(promptSnapshotRow([read], "2026-07-08T10:00:00.000Z"));
    // A later run starts from the saved (timestamp, hash) list only.
    const later = new ToolTimeline(first.changes);
    later.observe(deferredToolsRow([counter], "2026-07-08T10:01:00.000Z"));
    assert.deepEqual(later.toolsAt("2026-07-08T10:00:30.000Z")?.map((t) => t.name), ["Read"]);
    assert.deepEqual(later.toolsAt("2026-07-08T10:02:00.000Z")?.map((t) => t.name), ["Read", "mcp__demo__word_counter"]);
  });
});
