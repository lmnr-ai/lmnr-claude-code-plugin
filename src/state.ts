/**
 * Per-session state between hook runs: a small JSON file per session plus an O_EXCL
 * lock. Only offsets and counters; transcript rows are re-read, never stored.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { info, readJsonObject, stateDir } from "./config.js";
import { coerceToolSetChanges, type ToolSetChange } from "./tools.js";
import { isPrompt, readLines, type Row } from "./transcript.js";

export interface SessionState {
  // First turn not exported yet (or the end of the last row read); each run re-reads from here.
  offset: number;
  // Turns past `offset` already exported (they went out while an earlier one waited).
  exported: number[];
  turnCount: number;
  // Rows before this offset were already fed to the tool timeline.
  toolsScannedTo: number;
  // When each tool set took effect (the sets themselves are stored by tools.ts).
  toolSetChanges: ToolSetChange[];
}

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

const sessionsDir = () => path.join(stateDir(), "lmnr_sessions");

export function sessionKey(sessionId: string, transcriptPath: string): string {
  return crypto.createHash("sha256").update(`${sessionId}::${transcriptPath}`, "utf-8").digest("hex");
}

export function emptyState(): SessionState {
  return { offset: 0, exported: [], turnCount: 0, toolsScannedTo: 0, toolSetChanges: [] };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

function fromJson(raw: Record<string, any>): SessionState {
  return {
    offset: num(raw.offset),
    exported: Array.isArray(raw.exported) ? raw.exported.filter((x: unknown) => typeof x === "number") : [],
    turnCount: num(raw.turnCount),
    toolsScannedTo: num(raw.toolsScannedTo),
    toolSetChanges: coerceToolSetChanges(raw.toolSetChanges),
  };
}

export function loadState(key: string, transcriptPath: string): SessionState {
  const file = path.join(sessionsDir(), `${key}.json`);
  if (fs.existsSync(file)) {
    return fromJson(readJsonObject(file));
  }
  pruneOldSessions();
  return migrateLegacyState(key, transcriptPath) ?? emptyState();
}

/** Persist the state. Fail-open: a failed write means the next run re-exports (at-least-once). */
export function saveState(key: string, state: SessionState): void {
  try {
    fs.mkdirSync(sessionsDir(), { recursive: true });
    const file = path.join(sessionsDir(), `${key}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state), "utf-8");
    fs.renameSync(`${file}.tmp`, file);
  } catch (e) {
    info(`saveState failed: ${e}; already-exported turns may be re-emitted on the next hook run`);
  }
}

function pruneOldSessions(): void {
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const name of fs.readdirSync(sessionsDir())) {
      const file = path.join(sessionsDir(), name);
      if (fs.statSync(file).mtimeMs < cutoff) {
        fs.rmSync(file, { force: true });
      }
    }
  } catch {
    // Nothing to prune yet.
  }
}

/**
 * Serialize overlapping hook runs for a session. Throws on timeout; runs unlocked
 * if the lock file can't be created.
 */
export async function withSessionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const lock = path.join(sessionsDir(), `${key}.lock`);
  try {
    fs.mkdirSync(sessionsDir(), { recursive: true });
  } catch {
    return fn();
  }
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      break;
    } catch (e: any) {
      if (e?.code !== "EEXIST") {
        return fn();
      }
    }
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(lock, { force: true }); // left by a killed run
        continue;
      }
    } catch {
      continue; // released meanwhile
    }
    if (Date.now() > deadline) {
      throw new Error("session state lock timeout");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/**
 * One-time upgrade from the pre-rewrite shared `lmnr_state.json`: resume at the
 * earliest turn it still held (found by uuid), and mark the later prompts it had
 * read as exported, so the session's history isn't sent again.
 */
function migrateLegacyState(key: string, transcriptPath: string): SessionState | null {
  const legacy = readJsonObject(path.join(stateDir(), "lmnr_state.json"))[key];
  if (typeof legacy !== "object" || legacy === null) {
    return null;
  }
  const readTo = num(legacy.offset) - Buffer.byteLength(typeof legacy.buffer === "string" ? legacy.buffer : "", "utf-8");
  const held: Row[] = [
    ...(Array.isArray(legacy.pendingAgentTurns) ? legacy.pendingAgentTurns.map((t: any) => t?.rows?.[0]) : []),
    Array.isArray(legacy.pendingTurnRows) ? legacy.pendingTurnRows[0] : undefined,
  ];
  const heldUuids = new Set(held.map((r) => r?.uuid).filter((u): u is string => typeof u === "string"));
  const state: SessionState = {
    ...emptyState(),
    offset: Math.max(0, readTo),
    turnCount: num(legacy.turnCount),
    toolsScannedTo: Math.max(0, readTo),
    toolSetChanges: coerceToolSetChanges(legacy.toolSetChanges),
  };
  if (heldUuids.size > 0) {
    const prompts = readLines(transcriptPath).lines.filter((l) => l.offset < readTo && isPrompt(l.row));
    const firstHeld = prompts.find((l) => heldUuids.has(l.row.uuid));
    if (firstHeld) {
      state.offset = firstHeld.offset;
      state.exported = prompts.filter((l) => l.offset > firstHeld.offset && !heldUuids.has(l.row.uuid)).map((l) => l.offset);
    }
  }
  info(`migrated legacy state for session ${key.slice(0, 12)}: resuming at byte ${state.offset}`);
  return state;
}
