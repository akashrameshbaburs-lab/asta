// Microphone sanity check + silence-threshold calibration.
import { loadConfig } from "../src/config.js";
import { openRecorder } from "../src/recorder.js";
import { rms } from "../src/wav.js";

const cfg = loadConfig();
const rec = openRecorder(cfg, 512);
console.log(`device: ${cfg.audio.inputDevice}  sampleRate: ${rec.sampleRate}  frameLength: ${rec.frameLength}`);
console.log("listening for 3 seconds - stay quiet for the first half, then say something...\n");

const frameMs = (rec.frameLength / rec.sampleRate) * 1000;
const levels = [];
const frames = Math.round(3000 / frameMs);
for (let i = 0; i < frames; i++) {
  const frame = await rec.read();
  const level = rms(frame);
  levels.push(level);
  const bar = "#".repeat(Math.min(60, Math.round(level / 30)));
  const t = ((i * frameMs) / 1000).toFixed(1);
  console.log(`${t}s ${String(Math.round(level)).padStart(6)} ${bar}`);
}
rec.release();

const sorted = [...levels].sort((a, b) => a - b);
const quiet = sorted[Math.floor(sorted.length * 0.2)];
const loud = sorted[Math.floor(sorted.length * 0.9)];
console.log(`\nquietest 20%: ${Math.round(quiet)}   loudest 10%: ${Math.round(loud)}`);
console.log(`current silenceThreshold: ${cfg.audio.silenceThreshold}`);
console.log(`suggested silenceThreshold: ${Math.round(quiet + (loud - quiet) * 0.35)}`);
