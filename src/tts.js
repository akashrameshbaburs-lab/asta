// Text-to-speech: Piper (offline, natural) with Windows SAPI fallback.
//
// Both a blocking API (speak) and an async API (speakAsync) are provided.
// The voice assistant uses speakAsync so it can keep draining the microphone
// while audio plays - otherwise Asta would hear its own voice.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log.js";
import { tone, writeWav } from "./wav.js";

const PS = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

/* ------------------------------------------------------------------ playback */

/** Play a .wav file synchronously through the default output device. */
export function playWav(wavPath) {
  const r = spawnSync(PS, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", playCommand(wavPath)], {
    windowsHide: true,
    timeout: 300000,
  });
  if (r.status !== 0) throw new Error(`SoundPlayer failed: ${r.stderr?.toString()?.slice(0, 300)}`);
}

function playCommand(wavPath) {
  return `(New-Object Media.SoundPlayer '${wavPath.replace(/'/g, "''")}').PlaySync()`;
}

/** Run a PowerShell snippet to completion, without blocking the event loop. */
function runPS(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(PS, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error("voice playback timed out"));
    }, timeoutMs);
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(err.slice(0, 300) || `exit ${code}`));
    });
  });
}

export function playWavAsync(wavPath) {
  return runPS(playCommand(wavPath), 300000);
}

/* ------------------------------------------------------------------- synthesis */

/** Piper: read text on stdin, write a wav to disk. */
export function piperToWav(text, cfg) {
  const out = path.join(cfg.paths.tmpDir, "tts.wav");
  // length_scale > 1 is slower speech, so invert the speed setting
  const lengthScale = (1 / Math.max(0.5, Math.min(2, cfg.tts.speed))).toFixed(2);
  const args = [
    "--model", cfg.paths.piperVoice,
    "--output_file", out,
    "--length_scale", String(lengthScale),
    "--sentence_silence", "0.25",
  ];
  const r = spawnSync(cfg.paths.piperExe, args, {
    input: text,
    windowsHide: true,
    timeout: 180000,
    cwd: path.dirname(cfg.paths.piperExe),
  });
  if (r.status !== 0 || !fs.existsSync(out)) {
    throw new Error(`piper failed (exit ${r.status}): ${(r.stderr?.toString() || "").slice(0, 300)}`);
  }
  return out;
}

/** Build the PowerShell that speaks text with the built-in Windows voice. */
function sapiCommand(text, cfg) {
  const tmp = path.join(cfg.paths.tmpDir, "sapi.txt");
  fs.writeFileSync(tmp, text, "utf8");
  const rate = Math.max(-10, Math.min(10, Math.round((cfg.tts.speed - 1) * 8)));
  const voice = cfg.tts.sapiVoice ? `try { $s.SelectVoice(${JSON.stringify(cfg.tts.sapiVoice)}) } catch {};` : "";
  return [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    `$s.Rate = ${rate};`,
    voice,
    `$t = Get-Content -Raw -Encoding UTF8 '${tmp.replace(/'/g, "''")}';`,
    "$s.Speak($t);",
  ].join(" ");
}

/** Windows built-in voice, blocking. */
export function speakSapi(text, cfg) {
  const r = spawnSync(PS, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", sapiCommand(text, cfg)], {
    windowsHide: true,
    timeout: 300000,
  });
  if (r.status !== 0) throw new Error(`SAPI failed: ${r.stderr?.toString()?.slice(0, 300)}`);
}

export function speakSapiAsync(text, cfg) {
  return runPS(sapiCommand(text, cfg), 300000);
}

/* --------------------------------------------------------------------- strings */

/** Strip markdown so we never read symbols aloud. */
export function speakable(text) {
  let t = String(text ?? "");
  t = t.replace(/```[\s\S]*?```/g, " code block omitted. ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/(^|\s)[*_]([^*_]+)[*_](\s|$)/g, "$1$2$3");
  t = t.replace(/^\s*>\s?/gm, "");
  t = t.replace(/^\s*\|.*\|\s*$/gm, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

/* ------------------------------------------------------------------------ speak */

/**
 * Speak text aloud, blocking. Tries Piper then SAPI; never throws: a voice
 * failure must not take down the assistant.
 */
export function speak(text, cfg) {
  const clean = speakable(text);
  if (!clean) return { spoke: false, engine: null };
  try {
    if (cfg.tts.engine === "piper" && cfg.paths.piperExe && fs.existsSync(cfg.paths.piperExe)) {
      playWav(piperToWav(clean, cfg));
      return { spoke: true, engine: "piper" };
    }
  } catch (e) {
    log(`piper TTS failed, falling back to SAPI: ${e.message}`, "warn");
  }
  try {
    speakSapi(clean, cfg);
    return { spoke: true, engine: "sapi" };
  } catch (e) {
    log(`SAPI TTS failed: ${e.message}`, "error");
    return { spoke: false, engine: null };
  }
}

/** Same as speak, but does not block the event loop. */
export async function speakAsync(text, cfg) {
  const clean = speakable(text);
  if (!clean) return { spoke: false, engine: null };
  try {
    if (cfg.tts.engine === "piper" && cfg.paths.piperExe && fs.existsSync(cfg.paths.piperExe)) {
      const wav = piperToWav(clean, cfg); // fast: ~0.4s for a sentence
      await playWavAsync(wav);
      return { spoke: true, engine: "piper" };
    }
  } catch (e) {
    log(`piper TTS failed, falling back to SAPI: ${e.message}`, "warn");
  }
  try {
    await speakSapiAsync(clean, cfg);
    return { spoke: true, engine: "sapi" };
  } catch (e) {
    log(`SAPI TTS failed: ${e.message}`, "error");
    return { spoke: false, engine: null };
  }
}

/** Short non-verbal cue so you know it heard you. */
export function cue(cfg, kind = "listening") {
  if (!cfg.audio.beep) return;
  try {
    const map = {
      listening: { freq: 880, ms: 90, volume: 0.18 },
      thinking: { freq: 1180, ms: 70, volume: 0.12 },
      error: { freq: 300, ms: 220, volume: 0.2 },
    };
    const t = map[kind] ?? map.listening;
    const wavPath = path.join(cfg.paths.tmpDir, `cue-${kind}.wav`);
    if (!fs.existsSync(wavPath)) writeWav(wavPath, tone({ ...t, sampleRate: 16000 }), 16000);
    playWav(wavPath);
  } catch {
    /* cues are cosmetic */
  }
}
