// Asta - the always-on local voice assistant.
//
//   wake word -> record -> local speech-to-text -> OpenCode brain -> spoken reply
//
// Run:  node src/asta.js                  (uses wake.mode from config.json)
//       node src/asta.js --mode manual    (press Enter to talk)
//       node src/asta.js --once "hello"   (one text round-trip, then exit)
//       node src/asta.js --no-ui          (skip the dashboard)
//
// Alongside the voice loop this process serves a local dashboard (web/) so you
// can watch, type, and manage reminders/memory/settings from a window.
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, readConfig, deepMerge } from "./config.js";
import { log, logSaid, ROOT } from "./log.js";
import { transcribe } from "./stt.js";
import { speakAsync, cue } from "./tts.js";
import { ask, resetSession } from "./brain.js";
import { openRecorder, captureUtterance, waitForSpeech, listInputDevices, readFrame } from "./recorder.js";
import { createPorcupine, describeWakeMode, resolveWakeMode } from "./wake.js";
import { writeWav, rms } from "./wav.js";
import * as rem from "./reminders.js";
import { emit } from "./bus.js";
import { startServer } from "./server.js";
import { openAppWindow } from "./window.js";

const FRAME_LENGTH = 512; // 32 ms at 16 kHz; matches Porcupine's frame size
const SAMPLE_RATE = 16000;
const VERSION = "1.1.0";

// Whisper renders "Asta" a number of ways ("Asta", "Astaire", "He Asta",
// "a star"). Match those tolerant forms, but never bare "star", which would
// trip on ordinary sentences like "Star Wars is a good film".
const WAKE_FILLER = new Set(["hey", "he", "heya", "hi", "hello", "ok", "okay", "yo", "so", "um", "uh"]);
const WAKE_TOKENS = new Set([
  "asta", "astah", "astar", "astair", "astaire", "aster", "astra",
  "astaa", "astu", "asto", "astha", "astas", "ashtar", "stah",
]);
const WAKE_TWO_WORD = new Set(["a sta", "a star", "a stah", "a aster", "a astar"]);

/**
 * Look for the wake word at the start of a transcript.
 * Returns { rest } where rest is the command (possibly empty), or null.
 */
function detectWake(text) {
  const norm = String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return null;
  const words = norm.split(" ");
  let i = 0;
  while (i < words.length && WAKE_FILLER.has(words[i])) i++;
  if (i >= words.length) return null;

  const one = words[i];
  const two = words.slice(i, i + 2).join(" ");
  if (one.startsWith("asta") || WAKE_TOKENS.has(one)) {
    return { rest: words.slice(i + 1).join(" ").trim() };
  }
  if (WAKE_TWO_WORD.has(two)) {
    return { rest: words.slice(i + 2).join(" ").trim() };
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One "turn" at a time: something that listens through the microphone and then
 * talks. The voice loop and the dashboard can both start one, and without this
 * they would talk over each other. Rejections are swallowed on the chain (so
 * a failed turn never wedges the queue) but still surface to the caller.
 */
function makeTurnQueue() {
  let tail = Promise.resolve();
  return function turn(fn) {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => {},
      () => {}
    );
    return run;
  };
}

/** Publish status changes, but only when they actually change. */
function setStatus(state, status, detail = "") {
  if (state.status === status && state.detail === detail) return;
  state.status = status;
  state.detail = detail;
  emit.status(status, detail);
}

/** Microphone meter for the dashboard, throttled to ~11 Hz. */
function makeLevelEmitter() {
  let last = 0;
  return (level) => {
    const now = Date.now();
    if (now - last < 90) return;
    last = now;
    emit.level(Math.round(level));
  };
}

/**
 * Speak, while continuously draining the microphone.
 *
 * This matters: Asta listens through the same speakers it talks out of, so
 * without draining it would record its own voice, and because its greeting
 * used to contain the wake word it could talk itself into a loop.
 */
async function say(text, cfg, state) {
  if (!text || !String(text).trim()) return;
  state.speaking = true;
  setStatus(state, "speaking");
  emit.said(text);
  try {
    const done = speakAsync(text, cfg);
    let finished = false;
    void done.then(
      () => (finished = true),
      () => (finished = true)
    );
    while (!finished && !state.stopped && state.recorder) {
      try {
        const frame = await readFrame(state.recorder); // discard
        state.onLevel(rms(frame)); // the meter still shows the room, even our own voice
      } catch {
        break;
      }
    }
    await done;
    // Let the room settle so the tail of our own voice is discarded too.
    const until = Date.now() + 400;
    while (Date.now() < until && !state.stopped && state.recorder) {
      try {
        await readFrame(state.recorder); // discard
      } catch {
        break;
      }
    }
  } finally {
    state.speaking = false;
    if (!state.stopped) setStatus(state, state.paused ? "paused" : state.idleStatus, state.paused ? "" : state.idleDetail);
  }
}

/** Voice commands handled instantly, without a round-trip to the brain. */
function localReply(text, cfg) {
  const t = text.toLowerCase().trim();
  if (/^(stop|cancel|never ?mind|forget it|quiet)[.!]*$/.test(t)) return { reply: "Okay." };
  if (/(new topic|start over|forget (this|our) conversation|clear (the )?conversation)/.test(t)) {
    resetSession(cfg);
    return { reply: "Starting a new conversation." };
  }
  if (/(what('s| is) the time|what time is it|tell me the time)/.test(t)) {
    return { reply: `It's ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` };
  }
  if (/(what('s| is) the date|what day is it)/.test(t)) {
    return { reply: `Today is ${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}.` };
  }
  if (/^(list|show|what are) (my )?reminders/.test(t)) {
    const items = rem.listReminders(cfg);
    if (!items.length) return { reply: "You have no reminders." };
    const said = items.slice(0, 5).map((r) => `${r.text}, ${rem.describe(r)}`).join(". ");
    return { reply: `You have ${items.length} reminder${items.length === 1 ? "" : "s"}. ${said}.` };
  }
  return null;
}

/** Answer something the user said, out loud. */
async function respond(text, cfg, state) {
  const cleaned = (text ?? "").trim();
  if (!cleaned) {
    await say("I didn't catch that.", cfg, state);
    return;
  }

  const local = localReply(cleaned, cfg);
  if (local) {
    logSaid(local.reply);
    await say(local.reply, cfg, state);
    return;
  }

  log(`you: ${cleaned}`, "info");
  setStatus(state, "thinking", "Asking the brain…");
  cue(cfg, "thinking");
  const { reply } = await ask(cleaned, cfg);
  logSaid(reply);
  await say(reply, cfg, state);
  cfg.__lastActivity = Date.now();
}

/**
 * Announce any reminders that have come due.
 * Runs as its own turn so it can never interrupt a reply in flight.
 */
async function pumpReminders(cfg, state) {
  if (!cfg.reminders.enabled || state.stopped) return false;
  const due = rem.dueReminders(cfg);
  if (!due.length) return false;
  return state.turn(async () => {
    if (state.speaking || state.stopped) return false;
    for (const item of due) {
      const line = `Reminder. ${item.text}.`;
      logSaid(line);
      emit.reminder(item.text, item.id);
      await say(line, cfg, state);
      rem.markSpoken(cfg, item.id);
    }
    return true;
  });
}

/** Only hit the disk about once a second while checking for due reminders. */
function makeReminderTicker(cfg, state) {
  let last = 0;
  return async () => {
    const now = Date.now();
    if (now - last < 1000) return false;
    last = now;
    return pumpReminders(cfg, state);
  };
}

/**
 * Turn recorded audio into a spoken answer.
 * `requireWake` is used by whisper wake mode: the utterance must contain the
 * wake word before we act on it.
 *
 * The whole thing is a single turn so a typed message from the dashboard can
 * never wedge itself into the middle of a recording.
 */
async function handleUtterance(pcm, cfg, state, { requireWake = false } = {}) {
  if (!pcm || state.stopped) return false;
  return state.turn(() => transcribeAndRespond(pcm, cfg, state, { requireWake }));
}

async function transcribeAndRespond(pcm, cfg, state, { requireWake }) {
  try {
    await doTranscribeAndRespond(pcm, cfg, state, { requireWake });
  } finally {
    // Whatever happened (including "that was not the wake word"), settle back
    // into the idle status so the dashboard never shows a stale detail.
    if (!state.stopped && !state.speaking) setStatus(state, state.idleStatus, state.idleDetail);
  }
}

async function doTranscribeAndRespond(pcm, cfg, state, { requireWake }) {
  const wav = path.join(cfg.paths.tmpDir, "utterance.wav");
  writeWav(wav, pcm.samples, SAMPLE_RATE);

  let text;
  try {
    text = await transcribe(wav, cfg);
  } catch (e) {
    log(`transcription failed: ${e.message}`, "error");
    emit.notice(`Speech recognition failed: ${e.message}`, "error");
    await say("My speech recognition had a problem.", cfg, state);
    return false;
  }
  if (!text) return false;

  if (requireWake) {
    const detected = detectWake(text);
    if (!detected) {
      log(`(ignored) ${text}`, "debug");
      emit.heard(text, { ignored: true });
      return false;
    }
    emit.heard(text, { ignored: false });
    if (detected.rest.split(/\s+/).filter(Boolean).length >= 2) {
      await respond(detected.rest, cfg, state);
      return true;
    }
    // Just the wake word: prompt with a beep, then listen for the request.
    cue(cfg, "listening");
    setStatus(state, "listening", "Listening for your request…");
    const follow = await captureUtterance(state.recorder, cfg, { onLevel: state.onLevel });
    if (follow) {
      writeWav(wav, follow.samples, SAMPLE_RATE);
      const followText = await transcribe(wav, cfg).catch(() => "");
      if (followText) {
        emit.heard(followText, { ignored: false });
        await respond(followText, cfg, state);
      }
    }
    return true;
  }

  emit.heard(text, { ignored: false });
  await respond(text, cfg, state);
  return true;
}

async function runManual(cfg, state) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q) => new Promise((res) => rl.question(q, res));
  log("Manual mode. Type a message and press Enter. Press Enter on its own to talk.", "info");
  log("Commands: :quit, :new, :devices", "info");
  while (!state.stopped) {
    if (state.paused) {
      await sleep(300);
      continue;
    }
    await pumpReminders(cfg, state);
    const typed = (await question("> ")).trim();
    if (typed === ":quit") break;
    if (typed === ":new") {
      resetSession(cfg);
      log("started a new conversation", "info");
      continue;
    }
    if (typed === ":devices") {
      listInputDevices().forEach((d, i) => log(`[${i}] ${d}`, "info"));
      continue;
    }
    if (typed) {
      logSaid(`(typed) ${typed}`);
      emit.typed(typed);
      await state.turn(() => respond(typed, cfg, state));
      setStatus(state, state.idleStatus, state.idleDetail);
      continue;
    }
    cue(cfg, "listening");
    setStatus(state, "listening", "Recording…");
    const pcm = await captureUtterance(state.recorder, cfg, { onLevel: state.onLevel });
    if (pcm) await handleUtterance(pcm, cfg, state);
    else log("heard nothing", "debug");
    setStatus(state, state.idleStatus, state.idleDetail);
  }
  rl.close();
}

/** Drain a frame without processing it, so pausing does not back up the device. */
async function idleWhilePaused(state) {
  setStatus(state, "paused");
  try {
    await readFrame(state.recorder);
  } catch {
    await sleep(100);
  }
}

async function runPorcupine(cfg, state) {
  const engine = createPorcupine(cfg);
  state.engine = engine;
  log(`Listening for the wake word. Say "${cfg.wake.label}".`, "info");
  log(`(engine: ${engine.describe()})`, "info");
  const tick = makeReminderTicker(cfg, state);
  setStatus(state, "listening");

  while (!state.stopped) {
    if (state.paused) {
      await idleWhilePaused(state);
      continue;
    }
    if (state.status === "paused") setStatus(state, state.idleStatus, state.idleDetail);
    if (await tick()) continue;
    let frame;
    try {
      frame = await readFrame(state.recorder);
    } catch {
      await sleep(50);
      continue;
    }
    state.onLevel(rms(frame));
    if (state.speaking || state.paused) continue;
    if (engine.process(frame) >= 0) {
      log("wake word detected", "debug");
      cue(cfg, "listening");
      const pcm = await captureUtterance(state.recorder, cfg, { onLevel: state.onLevel });
      await handleUtterance(pcm, cfg, state);
    }
  }
}

async function runWhisperWake(cfg, state) {
  log(`Listening locally for "${cfg.wake.label}" (no signup needed).`, "info");
  log("Tip: whisper wake mode transcribes what it hears, so expect a beat of latency.", "info");
  const tick = makeReminderTicker(cfg, state);
  setStatus(state, "listening");

  while (!state.stopped) {
    if (state.paused) {
      await idleWhilePaused(state);
      continue;
    }
    if (state.status === "paused") setStatus(state, state.idleStatus, state.idleDetail);
    if (await tick()) continue;
    const first = await waitForSpeech(state.recorder, cfg, 60 * 30 * 1000, state.onLevel);
    if (!first || state.stopped || state.speaking || state.paused) continue;
    const pcm = await captureUtterance(state.recorder, cfg, { initialFrame: first, onLevel: state.onLevel });
    await handleUtterance(pcm, cfg, state, { requireWake: true });
  }
}

/** Snapshot handed to the dashboard. */
function systemSummary(cfg) {
  const humanMode = { whisper: "whisper (no signup)", porcupine: "porcupine (best)", manual: "manual" };
  return {
    wake: humanMode[cfg.wake.mode] ?? cfg.wake.mode,
    model: cfg.brain.model,
    "speech to text": cfg.paths.whisperExe ? "whisper.cpp · CUDA" : "not found",
    "text to speech":
      cfg.tts.engine === "piper" ? (cfg.paths.piperExe ? "Piper · en_US-amy-medium" : "Piper (missing)") : cfg.tts.engine,
    agent: `opencode --agent ${cfg.brain.agent}`,
    vault: cfg.vault.path,
    config: path.join(ROOT, "config.json"),
    logs: path.join(ROOT, "logs", "asta.log"),
    version: `Asta ${VERSION}`,
  };
}

/** Everything the dashboard is allowed to read or change. */
export function makeRuntime(cfg, state) {
  return {
    getStatus: () => ({
      status: state.status ?? "idle",
      detail: state.detail ?? "",
      paused: Boolean(state.paused),
      speaking: Boolean(state.speaking),
      since: Date.now(),
      system: systemSummary(cfg),
    }),

    ask(text) {
      emit.typed(text);
      const run = state.turn(() => respond(text, cfg, state));
      run.catch((e) => {
        log(`dashboard ask failed: ${e.message}`, "error");
        emit.notice(`Something went wrong: ${e.message}`, "error");
      });
      return run;
    },

    control(action) {
      if (action === "pause") {
        state.paused = true;
        setStatus(state, "paused");
        log("listening paused from the dashboard", "info");
      } else if (action === "resume") {
        state.paused = false;
        setStatus(state, state.idleStatus, state.idleDetail);
        log("listening resumed from the dashboard", "info");
      } else {
        return { ok: false, error: "unknown action", paused: state.paused };
      }
      return { ok: true, paused: state.paused };
    },

    getSettings: () => ({ config: readConfig(), system: systemSummary(cfg) }),

    saveSettings(patch) {
      const clean = { ...patch };
      delete clean.paths; // binary paths stay auto-detected
      saveConfig(clean);
      Object.assign(cfg, deepMerge(cfg, clean));
      log("settings saved from the dashboard", "info");
      emit.notice("Settings saved.", "ok");
      if (clean?.wake?.mode && clean.wake.mode !== state.wakeAtStart) {
        emit.notice("Restart Asta for the new wake mode to take effect.", "ok");
        return { ok: true, needsRestart: true, config: readConfig() };
      }
      return { ok: true, config: readConfig() };
    },
  };
}

export async function main() {
  const argv = process.argv.slice(2);
  const argOf = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const mode = argOf("--mode");
  const once = argOf("--once");
  const noUi = argv.includes("--no-ui");

  const cfg = loadConfig(mode ? { wake: { mode } } : {});
  const state = {
    stopped: false,
    speaking: false,
    paused: false,
    status: "idle",
    detail: "",
    idleStatus: "listening",
    idleDetail: "",
    engine: null,
    recorder: null,
    wakeAtStart: cfg.wake.mode,
    turn: makeTurnQueue(),
    onLevel: makeLevelEmitter(),
  };

  // --once: text in, spoken reply out. Handy for testing without a microphone.
  if (once !== undefined) {
    await respond(once, cfg, state);
    return;
  }

  if (!cfg.paths.whisperExe) log("Warning: whisper.cpp not found - speech recognition will not work.", "warn");
  if (!cfg.paths.piperExe) log("Warning: Piper not found - falling back to the Windows voice.", "warn");

  const resolved = resolveWakeMode(cfg);
  cfg.wake.mode = resolved.mode;
  if (resolved.note) log(resolved.note, "warn");
  state.idleStatus = cfg.wake.mode === "manual" ? "idle" : "listening";
  state.idleDetail = cfg.wake.mode === "manual" ? "Type below, or press Enter to record" : "";

  log(`Asta starting. Wake: ${describeWakeMode(cfg)}`, "info");
  state.recorder = openRecorder(cfg, FRAME_LENGTH);

  // ---- dashboard ---------------------------------------------------------
  let dashboard = null;
  if (cfg.ui.enabled && !noUi) {
    try {
      dashboard = await startServer({ cfg, runtime: makeRuntime(cfg, state) });
    } catch (e) {
      if (e.code === "EADDRINUSE") {
        log(`Dashboard port ${cfg.ui.port} is already in use - another Asta may be running. Continuing without it.`, "warn");
      } else {
        log(`Dashboard failed to start: ${e.message}`, "warn");
      }
    }
  }

  const shutdown = () => {
    if (state.stopped) return;
    state.stopped = true;
    log("Shutting down.", "info");
    try {
      dashboard?.server.close();
    } catch {
      /* ignore */
    }
    try {
      state.recorder?.release();
    } catch {
      /* ignore */
    }
    try {
      state.engine?.release();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("uncaughtException", (e) => {
    log(`uncaught: ${e.stack || e.message}`, "error");
    emit.notice(`Unexpected error: ${e.message}`, "error");
  });

  setStatus(state, "idle", "Starting up…");
  // Greeting deliberately avoids the wake word, so Asta cannot trigger itself.
  await say("Online and listening.", cfg, state);

  if (cfg.ui.openOnStart && dashboard) {
    // The dashboard gets a moment to accept the first event stream.
    setTimeout(() => openAppWindow(dashboard.url), 600);
  }

  if (cfg.wake.mode === "porcupine") await runPorcupine(cfg, state);
  else if (cfg.wake.mode === "whisper") await runWhisperWake(cfg, state);
  else await runManual(cfg, state);

  shutdown();
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirect) {
  main().catch((e) => {
    log(`fatal: ${e.stack || e.message}`, "error");
    process.exit(1);
  });
}
