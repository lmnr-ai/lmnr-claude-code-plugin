import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { withSessionLock } from "../src/state.js";

process.env.CC_LMNR_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lmnr-lock-"));
const lockFile = (key: string) => path.join(process.env.CC_LMNR_STATE_DIR!, "lmnr_sessions", `${key}.lock`);
const fsCjs = createRequire(import.meta.url)("node:fs") as typeof fs;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("session lock", () => {
  // Stale after 150ms untouched; the holder touches it every 30ms.
  const timing = { staleMs: 150, heartbeatMs: 30 };

  it("a run longer than the stale time keeps its lock, and the waiter runs after it", async () => {
    const events: string[] = [];
    const holder = withSessionLock("slow", async () => {
      events.push("holder start");
      await sleep(500);
      events.push("holder end");
    }, timing);
    await sleep(20);
    const waiter = withSessionLock("slow", async () => {
      events.push("waiter");
    }, { ...timing, waitMs: 2000 });
    await Promise.all([holder, waiter]);
    assert.deepEqual(events, ["holder start", "holder end", "waiter"]);
    assert.equal(fs.existsSync(lockFile("slow")), false);
  });

  it("a waiter gives up after its wait while the holder is alive", async () => {
    const holder = withSessionLock("busy", () => sleep(400), timing);
    await sleep(20);
    await assert.rejects(withSessionLock("busy", async () => {}, { ...timing, waitMs: 100 }), /lock timeout/);
    await holder;
  });

  it("takes over a lock left by a killed run", async () => {
    fs.mkdirSync(path.dirname(lockFile("dead")), { recursive: true });
    fs.writeFileSync(lockFile("dead"), "123:gone");
    const old = new Date(Date.now() - 1000);
    fs.utimesSync(lockFile("dead"), old, old);
    let ran = false;
    await withSessionLock("dead", async () => {
      ran = true;
    }, { ...timing, waitMs: 100 });
    assert.ok(ran);
  });

  it("does not release a lock another run took over", async () => {
    await withSessionLock("taken", async () => {
      fs.writeFileSync(lockFile("taken"), "other-run"); // as if another run took it over
    }, timing);
    assert.equal(fs.readFileSync(lockFile("taken"), "utf-8"), "other-run");
  });

  it("a lock it created but couldn't stamp is removed, and the run goes ahead unlocked", async () => {
    const writeSync = fsCjs.writeSync;
    fsCjs.writeSync = (() => {
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    }) as typeof fs.writeSync;
    syncBuiltinESMExports();
    let ran = false;
    try {
      await withSessionLock("nospace", async () => {
        ran = true;
      }, timing);
    } finally {
      fsCjs.writeSync = writeSync;
      syncBuiltinESMExports();
    }
    assert.ok(ran);
    assert.equal(fs.existsSync(lockFile("nospace")), false);
  });
});
