// Wake-word engines.
//
//   porcupine - Picovoice wake word (best accuracy, needs a free AccessKey)
//   whisper   - no signup: listens locally, transcribes short utterances and
//               acts when it hears the wake label (handled in asta.js)
//   manual    - press Enter to talk
import Porcupine from "@picovoice/porcupine-node";
import fs from "node:fs";
import { log } from "./log.js";

/** Picovoice engine. Requires an AccessKey and at least one .ppn keyword file. */
export function createPorcupine(cfg) {
  const key = cfg.wake.picovoiceAccessKey?.trim();
  const paths = (cfg.wake.keywordPaths ?? []).filter(Boolean);
  if (!key) throw new Error("wake.mode is 'porcupine' but wake.picovoiceAccessKey is empty");
  if (!paths.length) throw new Error("wake.mode is 'porcupine' but wake.keywordPaths is empty");
  for (const p of paths) {
    if (!fs.existsSync(p)) throw new Error(`keyword file not found: ${p}`);
  }
  const sensitivities = paths.map((_, i) => cfg.wake.sensitivities?.[i] ?? cfg.wake.sensitivities?.[0] ?? 0.6);
  const engine = new Porcupine(key, paths, sensitivities);
  return {
    mode: "porcupine",
    frameLength: engine.frameLength,
    sampleRate: engine.sampleRate,
    describe: () => `porcupine (${paths.length} keyword${paths.length === 1 ? "" : "s"})`,
    /** Returns the detected keyword index, or -1. */
    process: (frame) => engine.process(frame),
    release: () => engine.release(),
  };
}

/**
 * Validate the configured wake mode and pick a usable one.
 * If Porcupine is selected but not yet set up (no key or keyword files),
 * we fall back to manual so Asta still starts and is usable.
 */
export function resolveWakeMode(cfg) {
  if (cfg.wake.mode !== "porcupine") return { mode: cfg.wake.mode, note: null };
  try {
    const key = cfg.wake.picovoiceAccessKey?.trim();
    const paths = (cfg.wake.keywordPaths ?? []).filter(Boolean);
    if (!key) throw new Error("no Picovoice AccessKey configured");
    if (!paths.length) throw new Error("no .ppn keyword file configured");
    for (const p of paths) if (!fs.existsSync(p)) throw new Error(`keyword file not found: ${p}`);
    return { mode: "porcupine", note: null };
  } catch (e) {
    return {
      mode: "manual",
      note: `Porcupine is not ready (${e.message}). Starting in manual mode - press Enter to talk.`,
    };
  }
}

export function describeWakeMode(cfg) {
  if (cfg.wake.mode === "porcupine") {
    const n = (cfg.wake.keywordPaths ?? []).length;
    return `porcupine (${n} keyword${n === 1 ? "" : "s"})`;
  }
  if (cfg.wake.mode === "whisper") return `whisper listen-for-"${cfg.wake.label}" (no signup needed)`;
  return `manual (press Enter to speak)`;
}
