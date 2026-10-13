import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface LaminarConfig {
  apiKey: string;
  baseUrl: string;
  userId: string | null;
}

const env = (name: string): string => process.env[name] ?? "";
const nonEmpty = (v: unknown): string => (typeof v === "string" ? v : "");

export const DEBUG = env("CC_LMNR_DEBUG").toLowerCase() === "true";
export const CAPTURE_SKILL_CONTENT = env("CC_LMNR_CAPTURE_SKILL_CONTENT").toLowerCase() === "true";
export const MAX_CHARS = Number.parseInt(env("CC_LMNR_MAX_CHARS"), 10) || 20000;
// Cap for the OTLP request (connect + response).
export const EXPORT_TIMEOUT_MS = 5000;

/** Where `lmnr-cli` keeps its files. */
function lmnrConfigDir(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, "lmnr");
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "lmnr");
  }
  return path.join(os.homedir(), ".config", "lmnr");
}

/** A JSON object from disk, or {} when missing/unreadable (fail-open). */
export function readJsonObject(file: string): Record<string, any> {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf-8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * API key and base URL from the file `lmnr-cli plugin add claude-code` writes,
 * with env overrides; user id from `LMNR_USER_ID` or `lmnr-cli login`. Null without a key.
 */
export function getLaminarConfig(): LaminarConfig | null {
  const plugin = readJsonObject(path.join(lmnrConfigDir(), "claude-code-plugin.json"));
  const apiKey = env("LMNR_PROJECT_API_KEY") || nonEmpty(plugin.projectApiKey);
  if (!apiKey) {
    return null;
  }
  const baseUrl = (env("LMNR_BASE_URL") || nonEmpty(plugin.baseUrl) || "https://api.lmnr.ai").replace(/\/+$/, "");
  const creds = readJsonObject(path.join(lmnrConfigDir(), "credentials.json"));
  const userId = env("LMNR_USER_ID") || nonEmpty(creds.userEmail) || nonEmpty(creds.userId) || null;
  return { apiKey, baseUrl, userId };
}

// Resolved at call time so CC_LMNR_STATE_DIR can relocate it (tests use a temp dir).
export function stateDir(): string {
  return env("CC_LMNR_STATE_DIR") || path.join(os.homedir(), ".claude", "state");
}

const LOG_MAX_BYTES = 5_000_000;

function writeLog(level: string, msg: string): void {
  try {
    const file = path.join(stateDir(), "lmnr_hook.log");
    fs.mkdirSync(stateDir(), { recursive: true });
    try {
      if (fs.statSync(file).size > LOG_MAX_BYTES) {
        fs.renameSync(file, `${file}.1`);
      }
    } catch {
      // No log yet.
    }
    fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${msg}\n`, "utf-8");
  } catch {
    // Logging must never throw.
  }
}

export function debug(msg: string): void {
  if (DEBUG) {
    writeLog("DEBUG", msg);
  }
}

export function info(msg: string): void {
  writeLog("INFO", msg);
}
