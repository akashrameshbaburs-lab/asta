// Reminders: JSON store is the source of truth, mirrored into a human-readable
// note in the vault so you can read and edit them in Obsidian.
import fs from "node:fs";
import path from "node:path";
import { log } from "./log.js";

const storeFile = (cfg) => path.join(cfg.vault.path, cfg.vault.stateDir, "reminders.json");
const mirrorFile = (cfg) => path.join(cfg.vault.path, cfg.vault.remindersFile);

function load(cfg) {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(cfg), "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function save(cfg, list) {
  const f = storeFile(cfg);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(list, null, 2) + "\n");
  writeMirror(cfg, list);
  return list;
}

function writeMirror(cfg, list) {
  const pending = list.filter((r) => !r.done).sort((a, b) => new Date(a.due) - new Date(b.due));
  const lines = [
    "---",
    "tags: [asta, reminders]",
    "---",
    "",
    "# Asta Reminders",
    "",
    "_Managed by Asta. You can edit or delete lines here and Asta will follow the file._",
    "",
  ];
  if (!pending.length) lines.push("_Nothing scheduled._");
  for (const r of pending) {
    lines.push(`- [ ] ${r.due} — ${r.text}  \`${r.id}\``);
  }
  lines.push("");
  try {
    fs.mkdirSync(path.dirname(mirrorFile(cfg)), { recursive: true });
    fs.writeFileSync(mirrorFile(cfg), lines.join("\n"));
  } catch (e) {
    log(`could not write reminder note: ${e.message}`, "warn");
  }
}

/**
 * Understand the times the agent (or you) is likely to say.
 * Supports ISO 8601, "in 10m/2h/30s/3d", "today 17:00", "tomorrow 9am",
 * "17:30" (today, or tomorrow if already past) and "2026-10-18".
 */
export function parseWhen(input, now = new Date()) {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;

  // relative: in 10 minutes / in 2h / in 45s / in 3 days
  const rel = s.match(/^(?:in\s+)?(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
  if (rel) {
    const n = parseFloat(rel[1]);
    const unit = rel[2][0];
    const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit] * n;
    return new Date(now.getTime() + ms);
  }

  const timeMatch = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const wantTime = (base) => {
    if (!timeMatch) return base;
    let h = parseInt(timeMatch[1], 10);
    const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ap = timeMatch[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    base.setHours(h, min, 0, 0);
    return base;
  };

  if (s.startsWith("tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return wantTime(d);
  }
  if (s.startsWith("today") || s.startsWith("tonight")) {
    const d = new Date(now);
    d.setHours(s.startsWith("tonight") ? 20 : 9, 0, 0, 0);
    return wantTime(d);
  }

  // ISO or plain date
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2}))?/);
  if (iso) {
    const d = new Date(now);
    d.setFullYear(+iso[1], +iso[2] - 1, +iso[3]);
    d.setHours(iso[4] ? +iso[4] : 9, iso[5] ? +iso[5] : 0, 0, 0);
    return d;
  }

  // bare time like "17:30" or "5pm"
  if (/^\d{1,2}(:\d{2})?\s*(am|pm)?$/.test(s)) {
    const d = new Date(now);
    wantTime(d);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function addReminder(cfg, text, when) {
  const due = when instanceof Date ? when : parseWhen(when);
  if (!due || Number.isNaN(due.getTime())) return { ok: false, error: `could not understand the time "${when}"` };
  if (!String(text ?? "").trim()) return { ok: false, error: "no reminder text given" };

  const list = load(cfg);
  const item = {
    id: Math.random().toString(36).slice(2, 8),
    text: String(text).trim(),
    due: due.toISOString(),
    created: new Date().toISOString(),
    done: false,
    spoken: false,
  };
  list.push(item);
  save(cfg, list);
  log(`reminder added: ${item.text} @ ${item.due}`);
  return { ok: true, reminder: item };
}

export function listReminders(cfg, { includeDone = false } = {}) {
  const list = load(cfg).filter((r) => includeDone || !r.done);
  return list.sort((a, b) => new Date(a.due) - new Date(b.due));
}

export function removeReminder(cfg, idOrText) {
  const list = load(cfg);
  const needle = String(idOrText ?? "").toLowerCase().trim();
  const idx = list.findIndex((r) => !r.done && (r.id === needle || r.text.toLowerCase().includes(needle)));
  if (idx === -1) return { ok: false, error: "no matching reminder" };
  const [removed] = list.splice(idx, 1);
  save(cfg, list);
  return { ok: true, reminder: removed };
}

export function completeReminder(cfg, id) {
  const list = load(cfg);
  const item = list.find((r) => r.id === id);
  if (!item) return { ok: false };
  item.done = true;
  item.doneAt = new Date().toISOString();
  save(cfg, list);
  return { ok: true, reminder: item };
}

/** Reminders that are due and not yet announced. */
export function dueReminders(cfg, now = new Date()) {
  return load(cfg).filter((r) => !r.done && !r.spoken && new Date(r.due).getTime() <= now.getTime());
}

export function markSpoken(cfg, id) {
  const list = load(cfg);
  const item = list.find((r) => r.id === id);
  if (item) {
    item.spoken = true;
    item.done = true;
    item.doneAt = new Date().toISOString();
    save(cfg, list);
  }
}

/** Human-friendly description, used for confirmations and announcements. */
export function describe(item, now = new Date()) {
  const due = new Date(item.due);
  const diffMs = due.getTime() - now.getTime();
  if (diffMs <= 0) return "right now";
  if (diffMs < 60000) {
    const secs = Math.max(1, Math.round(diffMs / 1000));
    return `in ${secs} second${secs === 1 ? "" : "s"}`;
  }
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin} minute${diffMin === 1 ? "" : "s"}`;
  const time = due.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day =
    due.toDateString() === now.toDateString()
      ? "today"
      : due.toDateString() === new Date(now.getTime() + 86400000).toDateString()
        ? "tomorrow"
        : due.toDateString();
  return `${day} at ${time}`;
}
