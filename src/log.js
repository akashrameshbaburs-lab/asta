// Tiny leveled logger. Writes to console, to logs/asta.log, and optionally
// to a log file the UI can tail.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LOG_DIR = path.join(ROOT, "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, "asta.log");
const MAX_BYTES = 5 * 1024 * 1024;

let initialized = false;
function ensureLog() {
  if (initialized) return;
  initialized = true;
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_BYTES) {
      fs.renameSync(LOG_FILE, path.join(LOG_DIR, "asta.old.log"));
    }
  } catch {
    /* logging must never crash the assistant */
  }
}

const COLORS = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m", said: "\x1b[35m" };

export function log(msg, level = "info") {
  ensureLog();
  const t = new Date();
  const stamp = t.toTimeString().slice(0, 8);
  const line = `${stamp} [${level.toUpperCase().padEnd(5)}] ${msg}`;
  try {
    process.stdout.write(`${COLORS[level] ?? ""}${line}\x1b[0m\n`);
  } catch {
    /* ignore */
  }
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {
    /* ignore */
  }
}

/** Log something the assistant will say, so transcripts are easy to scan. */
export function logSaid(text) {
  log(text, "said");
}
