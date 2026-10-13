/** Claude Code → Laminar hook (Stop / SessionEnd). Always exits 0: Laminar must never block Claude Code. */
import * as fs from "node:fs";
import * as path from "node:path";
import { debug, getLaminarConfig, info } from "./config.js";
import { processTranscript } from "./pipeline.js";

function readPayload(): Record<string, any> {
  try {
    const payload = JSON.parse(fs.readFileSync(0, "utf-8"));
    return typeof payload === "object" && payload !== null ? payload : {};
  } catch (e) {
    debug(`unreadable hook payload: ${e}`);
    return {};
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
  const count = await processTranscript(config, sessionId, path.resolve(transcriptPath), {
    sessionEnd: payload.hook_event_name === "SessionEnd",
    finalAssistantText: typeof payload.last_assistant_message === "string" ? payload.last_assistant_message : "",
  });
  info(`Processed ${count} turns in ${((Date.now() - start) / 1000).toFixed(2)}s (session=${sessionId})`);
}

main()
  .catch((e) => debug(`Unexpected failure: ${e}`))
  .finally(() => process.exit(0));
