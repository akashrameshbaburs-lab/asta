// Config loading with binary auto-detection, so paths survive upgrades.
import fs from "node:fs";
import path from "node:path";
import { ROOT, LOG_DIR, log } from "./log.js";

const CONFIG_FILE = path.join(ROOT, "config.json");

/** Recursively find the first file whose name matches one of `names`. */
function findFile(dir, names, depth = 4) {
  if (depth < 0 || !fs.existsSync(dir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && names.includes(e.name.toLowerCase())) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith(".")) {
      const hit = findFile(path.join(dir, e.name), names, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Prefer a whisper build that ships CUDA DLLs next to the binary. */
function findWhisperExe() {
  const binDir = path.join(ROOT, "bin");
  if (!fs.existsSync(binDir)) return "";
  const candidates = [];
  const walk = (dir, depth) => {
    if (depth < 0) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = entries.map((e) => e.name.toLowerCase());
    let exe = null;
    for (const want of ["whisper-cli.exe", "main.exe", "whisper.exe"]) {
      const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === want);
      if (hit) {
        exe = hit;
        break;
      }
    }
    if (exe) {
      const hasCuda = names.some((n) => /cuda|cublas/.test(n));
      const hasModel = names.some((n) => /^ggml-.*\.bin$/.test(n));
      candidates.push({ exe: path.join(dir, exe.name), score: (hasCuda ? 2 : 0) + (hasModel ? 1 : 0) });
    }
    for (const e of entries) if (e.isDirectory()) walk(path.join(dir, e.name), depth - 1);
  };
  walk(binDir, 4);
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.exe ?? "";
}

/** Newest bundled opencode-cli.exe under the desktop app's cli folder. */
function findOpenCodeCli() {
  const base = path.join(process.env.APPDATA || "", "ai.opencode.desktop", "cli");
  if (!fs.existsSync(base)) return "";
  const dirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(base, e.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const d of dirs) {
    const exe = path.join(d, "opencode-cli.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return "";
}

export function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
}

export function deepMerge(base, patch) {
  if (patch === undefined) return base;
  if (Array.isArray(base) || Array.isArray(patch) || typeof base !== "object" || base === null || typeof patch !== "object" || patch === null) {
    return patch;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
  return out;
}

export function loadConfig(overrides = {}) {
  const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  const cfg = deepMerge(raw, overrides);

  cfg.paths.root = ROOT;
  cfg.paths.logDir = LOG_DIR;
  cfg.paths.tmpDir = path.join(ROOT, "tmp");
  fs.mkdirSync(cfg.paths.tmpDir, { recursive: true });

  // Resolve relative asset paths against the project root.
  for (const key of ["whisperModel", "piperVoice"]) {
    if (cfg.paths[key] && !path.isAbsolute(cfg.paths[key])) cfg.paths[key] = path.join(ROOT, cfg.paths[key]);
  }

  // Dashboard defaults, so older configs keep working.
  cfg.ui = { enabled: true, host: "127.0.0.1", port: 7373, openOnStart: true, ...(cfg.ui ?? {}) };

  // Auto-detect anything not explicitly set (or no longer present).
  if (!cfg.paths.whisperExe || !fs.existsSync(cfg.paths.whisperExe)) {
    const found = findWhisperExe();
    if (found && found !== cfg.paths.whisperExe) log(`detected whisper: ${found}`, "debug");
    cfg.paths.whisperExe = found;
  }
  if (!cfg.paths.piperExe || !fs.existsSync(cfg.paths.piperExe)) {
    const found = findFile(path.join(ROOT, "bin"), ["piper.exe"]);
    if (found && found !== cfg.paths.piperExe) log(`detected piper: ${found}`, "debug");
    cfg.paths.piperExe = found ?? "";
  }
  if (!cfg.paths.opencodeCli || !fs.existsSync(cfg.paths.opencodeCli)) {
    cfg.paths.opencodeCli = findOpenCodeCli();
  }

  return cfg;
}

export function saveConfig(partial) {
  const current = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  const next = deepMerge(current, partial);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}
