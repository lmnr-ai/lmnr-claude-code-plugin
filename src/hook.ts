/** Claude Code → Laminar hook (Stop / SessionEnd). Always exits 0: Laminar must never block Claude Code. */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { debug, getLaminarConfig, info } from "./config.js";
import { processTranscript } from "./pipeline.js";

// argv marker of the detached process a SessionEnd hook hands its export to.
const WORKER_FLAG = "--session-end-worker";

function readPayload(): Record<string, any> {
  try {
    const raw = process.argv[2] === WORKER_FLAG ? process.argv[3] ?? "" : fs.readFileSync(0, "utf-8");
    const payload = JSON.parse(raw);
    return typeof payload === "object" && payload !== null ? payload : {};
  } catch (e) {
    debug(`unreadable hook payload: ${e}`);
    return {};
  }
}

/**
 * Claude Code gives all SessionEnd hooks 1.5 s in total, and a plugin's own
 * `timeout` can't raise it, so exporting inline gets cancelled mid-export — and in
 * `claude -p` the whole run is one turn that only SessionEnd exports (Stop fires
 * before its final row is written). Hand it to a detached copy of this script
 * instead: own process group, no inherited pipes, so neither the cancellation nor
 * Claude Code exiting stops it. Returns false if it couldn't be started.
 */
function detachSessionEnd(sessionId: string, transcriptPath: string): boolean {
  try {
    const payload = JSON.stringify({ session_id: sessionId, transcript_path: transcriptPath, hook_event_name: "SessionEnd" });
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, WORKER_FLAG, payload], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (e) => debug(`SessionEnd worker failed: ${e}`));
    child.unref();
    return child.pid !== undefined;
  } catch (e) {
    debug(`could not start the SessionEnd worker: ${e}`);
    return false;
  }
}

async function main(): Promise<void> {
  const start = Date.now();
  const config = getLaminarConfig();
  if (config === null) {
    return;
  }
  const payload = readPayload();
  const sessionId = payload.session_id;
  const transcriptPath = payload.transcript_path;
  if (typeof sessionId !== "string" || !sessionId || typeof transcriptPath !== "string" || !fs.existsSync(transcriptPath)) {
    debug(`missing session_id or transcript (${transcriptPath}); nothing to do`);
    return;
  }
  const sessionEnd = payload.hook_event_name === "SessionEnd";
  if (sessionEnd && process.argv[2] !== WORKER_FLAG && detachSessionEnd(sessionId, path.resolve(transcriptPath))) {
    debug(`SessionEnd export handed to a detached worker (session=${sessionId})`);
    return;
  }
  const count = await processTranscript(config, sessionId, path.resolve(transcriptPath), {
    sessionEnd,
    finalAssistantText: typeof payload.last_assistant_message === "string" ? payload.last_assistant_message : "",
  });
  info(`Processed ${count} turns in ${((Date.now() - start) / 1000).toFixed(2)}s (session=${sessionId})`);
}

main()
  .catch((e) => debug(`Unexpected failure: ${e}`))
  .finally(() => process.exit(0));
