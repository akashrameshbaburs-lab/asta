// Open the dashboard as a standalone app window (no browser chrome, no tabs),
// so it reads like a desktop application rather than a web page.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log.js";

function browserCandidates() {
  const roots = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const out = [];
  for (const r of roots) {
    out.push(path.join(r, "Microsoft", "Edge", "Application", "msedge.exe"));
    out.push(path.join(r, "Google", "Chrome", "Application", "chrome.exe"));
  }
  return out;
}

function findBrowser() {
  return browserCandidates().find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

/** @returns {boolean} true if a window was launched. */
export function openAppWindow(url, { width = 1280, height = 880 } = {}) {
  try {
    const exe = findBrowser();
    if (exe) {
      const child = spawn(exe, [`--app=${url}`, `--window-size=${width},${height}`, "--no-first-run"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      log(`dashboard window opened with ${path.basename(exe)}`, "debug");
      return true;
    }
    // No Chromium browser found: fall back to the default handler.
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    log("dashboard opened in the default browser", "debug");
    return true;
  } catch (e) {
    log(`could not open the dashboard window: ${e.message}`, "warn");
    return false;
  }
}
