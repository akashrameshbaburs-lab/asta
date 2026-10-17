// Environment check: run this first if anything misbehaves.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "./config.js";
import { listInputDevices } from "./recorder.js";
import { whisperDevice } from "./stt.js";
import { describeWakeMode } from "./wake.js";

const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok, detail });
  const mark = ok === true ? " OK " : ok === false ? "FAIL" : "WARN";
  console.log(`[${mark}] ${label}${detail ? "  -  " + detail : ""}`);
};

console.log("Asta doctor\n===========\n");

check("Node.js", process.versions.node.startsWith("2") ? true : "warn", `v${process.versions.node}`);
check("Platform", process.platform === "win32" ? true : "warn", `${process.platform} (built for Windows)`);

const cfg = loadConfig();
check("Config file", fs.existsSync(path.join(cfg.paths.root, "config.json")), "config.json");

const whisperOk = Boolean(cfg.paths.whisperExe && fs.existsSync(cfg.paths.whisperExe));
check("whisper.cpp binary", whisperOk, cfg.paths.whisperExe || "not found - run scripts/download.ps1 then scripts/extract.ps1");
if (whisperOk) check("whisper GPU backend", whisperDevice(cfg) === "cuda" ? true : "warn", whisperDevice(cfg));

const modelOk = fs.existsSync(cfg.paths.whisperModel);
const modelMb = modelOk ? (fs.statSync(cfg.paths.whisperModel).size / 1048576).toFixed(0) : 0;
check("whisper model", modelOk, modelOk ? `${path.basename(cfg.paths.whisperModel)} (${modelMb} MB)` : cfg.paths.whisperModel);

const piperOk = Boolean(cfg.paths.piperExe && fs.existsSync(cfg.paths.piperExe));
check("Piper voice binary", piperOk, cfg.paths.piperExe || "not found - Windows voice will be used instead");

const voiceOk = fs.existsSync(cfg.paths.piperVoice);
check("Piper voice model", voiceOk, voiceOk ? path.basename(cfg.paths.piperVoice) : cfg.paths.piperVoice);

check("OpenCode CLI", Boolean(cfg.paths.opencodeCli && fs.existsSync(cfg.paths.opencodeCli)), cfg.paths.opencodeCli || "not found");

const agentFile = path.join(os.homedir(), ".config", "opencode", "agents", `${cfg.brain.agent}.md`);
check(`OpenCode agent "${cfg.brain.agent}"`, fs.existsSync(agentFile), agentFile);

const vaultOk = fs.existsSync(cfg.vault.path);
check("Obsidian vault", vaultOk, cfg.vault.path);

const devices = listInputDevices();
check("Microphone", devices.length > 0, devices.length ? devices.map((d, i) => `[${i}] ${d}`).join("; ") : "no input devices found");

console.log(`\nWake mode: ${describeWakeMode(cfg)}`);
if (cfg.wake.mode === "porcupine") {
  check("Picovoice AccessKey", Boolean(cfg.wake.picovoiceAccessKey), cfg.wake.picovoiceAccessKey ? "set" : "missing - get one free at console.picovoice.ai");
  const ppn = cfg.wake.keywordPaths ?? [];
  check("Keyword files", ppn.length > 0 && ppn.every((p) => fs.existsSync(p)), ppn.length ? ppn.join("; ") : "no .ppn files - create an Asta keyword in the Picovoice console");
} else if (cfg.wake.mode === "whisper") {
  console.log("  (no signup needed: Asta listens locally and reacts to its label)");
} else {
  console.log("  (manual: press Enter to talk. Set wake.mode to porcupine or whisper for hands-free.)");
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log("\nProblems to fix:");
  for (const f of failed) console.log(`  - ${f.label}: ${f.detail}`);
}
process.exitCode = failed.length ? 1 : 0;
