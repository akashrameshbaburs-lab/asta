// Asta command line: reminders, memory, and one-off voice actions.
// Designed to be called by the Asta agent through the shell, and by you directly.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { speak } from "./tts.js";
import { ask, resetSession } from "./brain.js";
import * as rem from "./reminders.js";

function usage() {
  return [
    "Asta command line",
    "",
    "  remind <text> <when>   set a reminder (e.g. remind \"call mom\" \"in 20 minutes\")",
    "  list                   show pending reminders",
    "  done <id>              mark a reminder complete",
    "  remove <id|text>       delete a reminder",
    "  remember <fact>        save a fact to the vault",
    "  recall <query>         search memories and the vault",
    "  say <text>             speak text out loud now",
    "  ask <text>             one round-trip through the brain, spoken",
    "  new                    start a fresh conversation",
    "  where                  show resolved paths and detected binaries",
    "",
  ].join("\n");
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "memory";
}

/** Save a durable fact as its own readable note in the vault. */
function remember(cfg, fact) {
  const dir = path.join(cfg.vault.path, cfg.vault.memoryDir);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `${stamp}-${slug(fact)}.md`);
  const body = [
    "---",
    "tags: [asta, memory]",
    `created: ${new Date().toISOString()}`,
    "---",
    "",
    fact.trim(),
    "",
  ].join("\n");
  fs.writeFileSync(file, body);
  return { ok: true, file };
}

/** Naive but useful text search across the vault. */
function recall(cfg, query) {
  const needle = query.toLowerCase();
  const root = cfg.vault.path;
  const hits = [];
  const walk = (dir, depth) => {
    if (depth < 0 || hits.length >= 40) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth - 1);
      else if (e.name.toLowerCase().endsWith(".md")) {
        let text = "";
        try {
          text = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        const idx = text.toLowerCase().indexOf(needle);
        if (idx >= 0) {
          const snippet = text.slice(Math.max(0, idx - 120), idx + 200).replace(/\s+/g, " ").trim();
          hits.push({ file: path.relative(root, full), snippet });
        }
      }
    }
  };
  walk(root, 6);
  return hits;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();

  switch (cmd) {
    case "remind": {
      // Accept either two arguments or one quoted phrase plus a time.
      const when = rest[rest.length - 1];
      const text = rest.slice(0, -1).join(" ");
      const r = rem.addReminder(cfg, text, when);
      if (!r.ok) {
        console.log(`Could not set that reminder: ${r.error}`);
        process.exitCode = 1;
      } else {
        console.log(`Reminder set: "${r.reminder.text}" (${rem.describe(r.reminder)}) id=${r.reminder.id}`);
      }
      break;
    }
    case "list": {
      const items = rem.listReminders(cfg);
      if (!items.length) console.log("No pending reminders.");
      for (const r of items) console.log(`${r.id}  ${r.due}  ${rem.describe(r)}  ${r.text}`);
      break;
    }
    case "done": {
      const r = rem.completeReminder(cfg, rest[0]);
      console.log(r.ok ? `Marked done: ${r.reminder.text}` : "No reminder with that id.");
      process.exitCode = r.ok ? 0 : 1;
      break;
    }
    case "remove": {
      const r = rem.removeReminder(cfg, rest.join(" "));
      console.log(r.ok ? `Removed: ${r.reminder.text}` : "No matching reminder.");
      process.exitCode = r.ok ? 0 : 1;
      break;
    }
    case "remember": {
      const fact = rest.join(" ").trim();
      if (!fact) {
        console.log("Nothing to remember.");
        process.exitCode = 1;
        break;
      }
      const r = remember(cfg, fact);
      console.log(`Saved to vault: ${path.relative(cfg.vault.path, r.file)}`);
      break;
    }
    case "recall": {
      const q = rest.join(" ").trim();
      if (!q) {
        console.log("Give me something to search for.");
        process.exitCode = 1;
        break;
      }
      const hits = recall(cfg, q);
      if (!hits.length) console.log(`Nothing found for "${q}".`);
      for (const h of hits) console.log(`--- ${h.file}\n${h.snippet}\n`);
      break;
    }
    case "say": {
      const text = rest.join(" ").trim();
      if (!text) {
        console.log("Nothing to say.");
        process.exitCode = 1;
        break;
      }
      const r = speak(text, cfg);
      console.log(r.spoke ? `Spoken with ${r.engine}.` : "Could not speak.");
      process.exitCode = r.spoke ? 0 : 1;
      break;
    }
    case "ask": {
      const text = rest.join(" ").trim();
      if (!text) {
        console.log("Nothing to ask.");
        process.exitCode = 1;
        break;
      }
      const { reply } = await ask(text, cfg);
      console.log(reply);
      speak(reply, cfg);
      break;
    }
    case "new": {
      resetSession(cfg);
      console.log("Started a new conversation.");
      break;
    }
    case "where": {
      console.log(`root        ${cfg.paths.root}`);
      console.log(`whisper exe ${cfg.paths.whisperExe || "(not found)"}`);
      console.log(`whisper mdl ${cfg.paths.whisperModel}`);
      console.log(`piper exe   ${cfg.paths.piperExe || "(not found)"}`);
      console.log(`piper voice ${cfg.paths.piperVoice}`);
      console.log(`opencode    ${cfg.paths.opencodeCli || "(not found)"}`);
      console.log(`vault       ${cfg.vault.path}`);
      console.log(`wake mode   ${cfg.wake.mode}`);
      break;
    }
    default:
      console.log(usage());
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  log(`fatal: ${e.message}`, "error");
  console.error(e.message);
  process.exit(1);
});
