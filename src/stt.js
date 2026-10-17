// Speech-to-text via whisper.cpp (local, GPU when the CUDA build is installed).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log.js";

function runWhisper(exe, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: -1, out, err: err + " (timed out)" });
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(e.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

/** Whisper emits bracketed timestamps and special tokens; strip them. */
function cleanTranscript(raw) {
  let t = raw;
  t = t.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]/g, " ");
  t = t.replace(/\[BLANK_AUDIO\]|\(blank_audio\)|\[.*?\]|\(.*?\)/gi, " "); // non-speech markers
  t = t.replace(/<\|[^|]*\|>/g, " "); // whisper special tokens
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/**
 * Transcribe a 16 kHz mono WAV file. Returns "" when nothing intelligible
 * was heard, and throws only when whisper itself could not run.
 */
export async function transcribe(wavPath, cfg) {
  const exe = cfg.paths.whisperExe;
  if (!exe || !fs.existsSync(exe)) throw new Error(`whisper executable not found (${exe})`);
  if (!fs.existsSync(cfg.paths.whisperModel)) {
    throw new Error(`whisper model not found (${cfg.paths.whisperModel})`);
  }

  const base = [
    "-m", cfg.paths.whisperModel,
    "-f", wavPath,
    "-l", cfg.stt.language,
    "-t", String(cfg.stt.threads),
  ];
  // Biasing whisper towards the assistant's name makes the wake word far more
  // reliable, and measurably does not leak the name into unrelated speech.
  if (cfg.stt.prompt) base.push("--prompt", cfg.stt.prompt);
  // Newer builds accept -nt/-np; older ones reject them, so fall back.
  let r = await runWhisper(exe, [...base, "-nt", "-np"], cfg.stt.timeoutMs);
  if (r.code !== 0 && /unknown argument|invalid option/i.test(r.err)) {
    log("whisper rejected -nt/-np; retrying with base flags", "debug");
    r = await runWhisper(exe, base, cfg.stt.timeoutMs);
  }
  if (r.code !== 0) {
    throw new Error(`whisper exited ${r.code}: ${(r.err || "").slice(0, 300)}`);
  }
  const text = cleanTranscript(r.out);
  log(`stt: "${text}"`, "debug");
  return text;
}

/** Detect whether the installed whisper build can see a GPU. */
export function whisperDevice(cfg) {
  const dir = path.dirname(cfg.paths.whisperExe || "");
  try {
    const dlls = fs.readdirSync(dir);
    if (dlls.some((f) => /cuda|cublas/i.test(f))) return "cuda";
  } catch {
    /* ignore */
  }
  return "cpu";
}
