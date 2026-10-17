// Minimal 16-bit PCM WAV read/write. No dependencies.
import fs from "node:fs";

/** Write mono 16-bit PCM samples to a WAV file. */
export function writeWav(path, samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);          // fmt chunk size
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  fs.writeFileSync(path, buf);
  return path;
}

/** Read a WAV file: returns { sampleRate, samples } as mono 16-bit PCM. */
export function readWav(path) {
  const buf = fs.readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not a RIFF/WAV file");
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error("missing fmt or data chunk");
  if (fmt.bits !== 16) throw new Error(`expected 16-bit PCM, got ${fmt.bits}-bit`);

  const frames = Math.floor(data.length / 2 / fmt.channels);
  const samples = new Int16Array(frames);
  for (let f = 0; f < frames; f++) {
    if (fmt.channels === 1) {
      samples[f] = data.readInt16LE(f * 2);
    } else {
      // downmix to mono
      let sum = 0;
      for (let c = 0; c < fmt.channels; c++) sum += data.readInt16LE((f * fmt.channels + c) * 2);
      samples[f] = Math.max(-32768, Math.min(32767, Math.round(sum / fmt.channels)));
    }
  }
  return { sampleRate: fmt.sampleRate, samples, channels: fmt.channels };
}

/** Root-mean-square amplitude, used for simple silence detection. */
export function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/** Generate a short sine tone as mono 16-bit samples (for UI feedback blips). */
export function tone({ freq = 880, ms = 110, sampleRate = 16000, volume = 0.25 } = {}) {
  const n = Math.round((ms / 1000) * sampleRate);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    // short fade in/out to avoid clicks
    const fade = Math.min(1, i / (n * 0.15), (n - i) / (n * 0.15));
    out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 32767 * volume * fade);
  }
  return out;
}
