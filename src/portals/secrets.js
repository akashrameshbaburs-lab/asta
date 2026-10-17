// Portal credentials, encrypted at rest with the Windows Data Protection API.
//
// Nothing here ever writes a password in plain text. Encryption and decryption
// are delegated to scripts\secure.ps1, which uses DPAPI scoped to the current
// Windows user - so the blob is unreadable by any other account or machine.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { log } from "../log.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECURE_PS1 = path.join(HERE, "..", "..", "scripts", "secure.ps1");

export function secretsFile(cfg) {
  return path.join(cfg.paths.root, "secrets.json");
}

function powershell(flag, input) {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SECURE_PS1, flag],
    { input, encoding: "utf8", windowsHide: true, timeout: 30000 }
  );
  if (r.status !== 0) throw new Error(`secure.ps1 ${flag} failed: ${(r.stderr || "").trim() || r.status}`);
  return (r.stdout || "").replace(/\r?\n$/, "");
}

/** Encrypt a plain string for this Windows user. */
export function encrypt(plain) {
  return powershell("-Encrypt", plain);
}

/** Decrypt a blob produced by encrypt(). */
export function decrypt(hex) {
  return powershell("-Decrypt", hex);
}

/** Raw file contents (encrypted blobs only), or null when not set up yet. */
export function readRaw(cfg) {
  try {
    return JSON.parse(fs.readFileSync(secretsFile(cfg), "utf8"));
  } catch {
    return null;
  }
}

export function hasCredentials(cfg) {
  const raw = readRaw(cfg);
  return Boolean(raw?.srm?.passwordEnc || raw?.haveloc?.passwordEnc);
}

/**
 * Decrypt the stored credentials.
 * @returns {{srm?: {username: string, password: string}, haveloc?: {username: string, password: string}}}
 */
export function readSecrets(cfg) {
  const raw = readRaw(cfg) ?? {};
  const out = {};
  for (const portal of ["srm", "haveloc"]) {
    const entry = raw[portal];
    if (!entry?.passwordEnc) continue;
    try {
      out[portal] = { username: entry.username ?? "", password: decrypt(entry.passwordEnc) };
    } catch (e) {
      log(`could not decrypt ${portal} credentials: ${e.message}`, "warn");
    }
  }
  return out;
}

/** Which portals have stored credentials. Passwords are never returned. */
export function describe(cfg) {
  const raw = readRaw(cfg) ?? {};
  return {
    srm: raw.srm?.passwordEnc ? { username: raw.srm.username ?? "", stored: true } : { stored: false },
    haveloc: raw.haveloc?.passwordEnc ? { username: raw.haveloc.username ?? "", stored: true } : { stored: false },
    file: secretsFile(cfg),
  };
}
