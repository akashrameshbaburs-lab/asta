// Microphone capture with simple energy-based endpointing (auto stop on silence).
import { PvRecorder } from "@picovoice/pvrecorder-node";
import { rms } from "./wav.js";
import { log } from "./log.js";

export function listInputDevices() {
  try {
    return PvRecorder.getAvailableDevices();
  } catch (e) {
    log(`could not list input devices: ${e.message}`, "warn");
    return [];
  }
}

export function openRecorder(cfg, frameLength) {
  const rec = new PvRecorder(frameLength, cfg.audio.inputDevice, 300);
  rec.start();
  return rec;
}

/**
 * Read exactly one frame, under a process-wide lock.
 *
 * The wake loop, the endpointing loops and the speaker drain all read the same
 * device handle. Left alone they race each other and end up with garbled or
 * duplicated frames, so every read goes through here. The lock is held for a
 * single 32 ms frame, so the waiters interleave harmlessly.
 */
let micChain = Promise.resolve();
export function readFrame(rec) {
  const run = micChain.then(() => rec.read());
  micChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

/** Flatten an array of equal-length Int16Array frames into one Int16Array. */
export function flatten(frames) {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Int16Array(total);
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += f.length;
  }
  return out;
}

/**
 * Wait until the room is loud enough to be speech. Returns the first frame of
 * speech, or null if `timeoutMs` passes first (used by whisper wake mode).
 * `onLevel` receives each frame's loudness, for the dashboard's meter.
 */
export async function waitForSpeech(rec, cfg, timeoutMs, onLevel = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = await readFrame(rec);
    const level = rms(frame);
    if (onLevel) onLevel(level);
    if (level >= cfg.audio.silenceThreshold) return frame;
  }
  return null;
}

/**
 * Record one spoken command and stop automatically after `silenceMs` of quiet.
 * Leading silence is discarded. Returns { samples, ms } or null if nobody spoke.
 */
export async function captureUtterance(rec, cfg, { initialFrame = null, onLevel = null } = {}) {
  const frameMs = (rec.frameLength / rec.sampleRate) * 1000;
  const maxFrames = Math.ceil(cfg.audio.maxUtteranceMs / frameMs);
  const minFrames = Math.ceil(cfg.audio.minUtteranceMs / frameMs);
  const silenceFrames = Math.max(1, Math.ceil(cfg.audio.silenceMs / frameMs));

  const frames = [];
  let speechStarted = false;
  let quietRun = 0;

  if (initialFrame) {
    frames.push(initialFrame);
    speechStarted = true;
  }

  const deadline = Date.now() + cfg.audio.maxUtteranceMs + cfg.audio.silenceMs + 3000;
  while (frames.length < maxFrames && Date.now() < deadline) {
    const frame = await readFrame(rec);
    const level = rms(frame);
    if (onLevel) onLevel(level);
    if (level >= cfg.audio.silenceThreshold) {
      speechStarted = true;
      quietRun = 0;
      frames.push(frame);
    } else if (speechStarted) {
      quietRun++;
      frames.push(frame);
      if (quietRun >= silenceFrames) break;
    }
    // else: still in leading silence, drop the frame
  }

  if (!speechStarted || frames.length < minFrames) return null;
  const samples = flatten(frames);
  return { samples, ms: Math.round((samples.length / rec.sampleRate) * 1000) };
}
