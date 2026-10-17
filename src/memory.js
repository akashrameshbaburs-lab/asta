// Long-term memory: facts saved as notes in the vault, plus simple search.
import fs from "node:fs";
import path from "node:path";

export function slug(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "memory"
  );
}

/** Save a durable fact as its own readable note in the vault. */
export function remember(cfg, fact) {
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

/** List saved memory notes, newest first. */
export function listMemory(cfg, limit = 100) {
  const dir = path.join(cfg.vault.path, cfg.vault.memoryDir);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => {
      const full = path.join(dir, e.name);
      let text = "";
      try {
        text = fs.readFileSync(full, "utf8");
      } catch {
        /* ignore */
      }
      // strip frontmatter for display
      const body = text.replace(/^---[\s\S]*?---\s*/, "").trim();
      return { name: e.name, text: body, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

/** Naive but useful text search across the vault. */
export function recall(cfg, query, maxHits = 40) {
  const needle = String(query ?? "").toLowerCase().trim();
  if (!needle) return [];
  const root = cfg.vault.path;
  const hits = [];
  const walk = (dir, depth) => {
    if (depth < 0 || hits.length >= maxHits) return;
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

/** Search across saved memories only. */
export function searchMemory(cfg, query) {
  const needle = String(query ?? "").toLowerCase().trim();
  if (!needle) return [];
  return listMemory(cfg, 1000).filter((m) => m.text.toLowerCase().includes(needle));
}
