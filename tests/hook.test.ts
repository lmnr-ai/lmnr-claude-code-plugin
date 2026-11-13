import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { assistantRow, ROOT, SESSION_ID, TestSession, userRow, withCollector } from "./helpers.js";

const HOOK = path.join(import.meta.dirname, "..", "src", "hook.ts");
const text = (t: string) => [{ type: "text", text: t }];

let session: TestSession | null = null;
afterEach(() => {
  session?.cleanup();
  session = null;
});

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      return false;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

describe("hook entrypoint", () => {
  // Claude Code cancels SessionEnd hooks after 1.5 s; the export must not depend on the hook process.
  it("SessionEnd returns at once and a detached worker finishes the export", async () => {
    const s = (session = new TestSession([userRow("hi"), assistantRow(text("hello"))]));
    const delayMs = 3000;
    let hookMs = 0;
    let exported = false;
    const requests = await withCollector(
      200,
      async (collector) => {
        const started = Date.now();
        const run = spawnSync(process.execPath, ["--import", "tsx", HOOK], {
          input: JSON.stringify({ session_id: SESSION_ID, transcript_path: s.transcript, hook_event_name: "SessionEnd" }),
          env: { ...process.env, LMNR_PROJECT_API_KEY: "k", LMNR_BASE_URL: collector.baseUrl, CC_LMNR_STATE_DIR: path.join(s.dir, "state") },
        });
        hookMs = Date.now() - started;
        assert.equal(run.status, 0);
        exported = await waitFor(() => s.state()?.turnCount === 1, 20_000);
      },
      { delayMs }
    );
    // spawnSync also waits for the hook's stdout/stderr to close, so this shows the worker holds no pipe of Claude Code's.
    assert.ok(hookMs < delayMs, `the hook took ${hookMs} ms`);
    assert.ok(exported, "the worker never saved its progress");
    const names = requests.flatMap((r) => r.body.resourceSpans.flatMap((rs: any) => rs.scopeSpans.flatMap((ss: any) => ss.spans.map((sp: any) => sp.name))));
    assert.ok(names.includes(ROOT), `exported ${names}`);
  });
});
