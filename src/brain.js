// The brain: asks OpenCode (with its vault/MCP tools, shell, everything) for a reply.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log.js";

const STATE_FILE = (cfg) => path.join(cfg.paths.root, "state", "session.json");

function loadSessionID(cfg) {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE(cfg), "utf8"));
    return typeof raw.sessionID === "string" && raw.sessionID.startsWith("ses") ? raw.sessionID : null;
  } catch {
    return null;
  }
}

function saveSessionID(cfg, sessionID) {
  try {
    const f = STATE_FILE(cfg);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ sessionID, updated: new Date().toISOString() }, null, 2));
  } catch (e) {
    log(`could not persist session id: ${e.message}`, "warn");
  }
}

/** Pull assistant text and the session id out of OpenCode's NDJSON event stream. */
function parseStream(stdout) {
  const chunks = [];
  let sessionID = null;
  let sawJson = false;

  for (const line of stdout.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    let evt;
    try {
      evt = JSON.parse(s);
    } catch {
      continue;
    }
    sawJson = true;
    if (typeof evt.sessionID === "string" && evt.sessionID.startsWith("ses")) sessionID = evt.sessionID;
    const part = evt.part;
    if (evt.type === "text" && part && typeof part.text === "string") {
      chunks.push(part.text);
    } else if (evt.type === "text" && typeof evt.text === "string") {
      chunks.push(evt.text);
    }
  }

  if (sawJson) return { reply: chunks.join("\n").trim(), sessionID };

  // Fallback: plain-text output (no --format json).
  const plain = stdout
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith(">"))
    .join("\n")
    .trim();
  return { reply: plain, sessionID };
}

/**
 * Send `text` to OpenCode and resolve with its spoken-ready reply.
 * Never rejects: a failure is returned as a friendly message so the
 * assistant can say something instead of going silent.
 */
export function ask(text, cfg) {
  return new Promise((resolve) => {
    const cli = cfg.paths.opencodeCli;
    if (!cli || !fs.existsSync(cli)) {
      return resolve({ reply: "I can't find the OpenCode command line tool.", sessionID: null, ok: false });
    }

    const args = ["run", text, "--format", "json", "--auto"];
    if (cfg.brain.agent) args.push("--agent", cfg.brain.agent);
    if (cfg.brain.model) args.push("--model", cfg.brain.model);
    const prior = loadSessionID(cfg);
    if (prior) args.push("--session", prior);
    else args.push("--title", "Asta voice");

    log(`brain: ${args.filter((a) => a !== "--auto" && a !== "--format" && a !== "json").slice(0, 2).join(" ")} ...`, "debug");

    const child = spawn(cli, args, { windowsHide: true, cwd: cfg.paths.root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish({ reply: "That took too long, so I stopped it.", sessionID: null, ok: false });
    }, cfg.brain.timeoutMs);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => finish({ reply: `I couldn't start OpenCode: ${e.message}`, sessionID: null, ok: false }));
    child.on("close", (code) => {
      const { reply, sessionID } = parseStream(out);
      if (sessionID) saveSessionID(cfg, sessionID);
      if (code !== 0 && !reply) {
        log(`brain exited ${code}: ${err.slice(0, 400)}`, "warn");
        return finish({ reply: "Something went wrong while I was thinking.", sessionID, ok: false });
      }
      if (!reply) {
        log(`brain returned no text (exit ${code})`, "warn");
        return finish({ reply: "I didn't have an answer for that.", sessionID, ok: false });
      }
      finish({ reply, sessionID, ok: true });
    });
  });
}

/** Start a fresh conversation (used by the CLI and voice commands like "new topic"). */
export function resetSession(cfg) {
  try {
    fs.rmSync(STATE_FILE(cfg), { force: true });
    return true;
  } catch {
    return false;
  }
}
