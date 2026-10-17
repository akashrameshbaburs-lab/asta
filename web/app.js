// Asta dashboard front-end. Talks to the local server over fetch + SSE.

const TOKEN = window.__ASTA_TOKEN__;
const $ = (sel) => document.querySelector(sel);

const api = {
  async req(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { "x-asta-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
    return data;
  },
  get: (p) => api.req("GET", p),
  post: (p, b) => api.req("POST", p, b),
  put: (p, b) => api.req("PUT", p, b),
  del: (p) => api.req("DELETE", p),
};

/* ------------------------------------------------------------------ toasts */

function toast(message, kind = "ok", ms = 3600) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  $("#toasts").appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s, transform .3s";
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 320);
  }, ms);
}

/* ------------------------------------------------------------------- state */

const STATUS_COPY = {
  idle: { title: "Idle", sub: "Waiting for you to say “Asta”" },
  listening: { title: "Listening", sub: "Go ahead — I’m recording" },
  thinking: { title: "Thinking", sub: "Working on your request" },
  speaking: { title: "Speaking", sub: "" },
  paused: { title: "Paused", sub: "Wake word detection is off — type below to chat" },
};

let state = { status: "idle", paused: false };
let showIgnored = false;

function setStatus(status, detail) {
  state.status = status;
  const copy = STATUS_COPY[status] ?? STATUS_COPY.idle;
  $("#orb").dataset.status = status;
  $("#status-pill").dataset.status = status;
  $("#status-text").textContent = status;
  $("#stage-status").textContent = copy.title;
  $("#stage-sub").textContent = detail || copy.sub;
}

/* -------------------------------------------------------------- transcript */

function addBubble({ who, text, meta, ignored = false }) {
  const empty = $("#transcript-empty");
  if (empty) empty.remove();

  const el = document.createElement("div");
  el.className = `bubble from-${who}${ignored ? " is-ignored" : ""}`;
  if (ignored) el.dataset.ignored = "1";
  if (ignored && !showIgnored) el.style.display = "none";

  const avatar = document.createElement("div");
  avatar.className = "bubble-avatar";
  avatar.textContent = who === "asta" ? "A" : "YOU";

  const body = document.createElement("div");
  body.className = "bubble-body";
  if (ignored) {
    const tag = document.createElement("div");
    tag.className = "bubble-tag";
    tag.textContent = "ignored — no wake word";
    body.appendChild(tag);
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble-text";
  bubble.textContent = text;
  body.appendChild(bubble);
  if (meta) {
    const m = document.createElement("div");
    m.className = "bubble-meta";
    m.textContent = meta;
    body.appendChild(m);
  }

  el.append(avatar, body);
  const feed = $("#transcript");
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;

  // keep the DOM bounded
  while (feed.querySelectorAll(".bubble").length > 200) feed.querySelector(".bubble").remove();
}

const timeOf = (ts) => new Date(ts ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/* ------------------------------------------------------------------- views */

const VIEW_META = {
  console: ["Console", "A live view of what Asta hears and says"],
  reminders: ["Reminders", "Everything Asta will remind you about"],
  memory: ["Memory", "Facts Asta has saved into your vault"],
  settings: ["Settings", "Tune how Asta listens, thinks and speaks"],
};

function showView(name) {
  for (const btn of document.querySelectorAll(".nav-item")) {
    btn.classList.toggle("is-active", btn.dataset.view === name);
  }
  for (const view of document.querySelectorAll(".view")) {
    view.classList.toggle("is-hidden", view.id !== `view-${name}`);
  }
  const [title, sub] = VIEW_META[name] ?? VIEW_META.console;
  $("#view-title").textContent = title;
  $("#view-sub").textContent = sub;

  if (name === "reminders") loadReminders();
  if (name === "memory") loadMemory();
  if (name === "settings") loadSettings();
}

/* --------------------------------------------------------------- reminders */

async function loadReminders() {
  try {
    const { reminders } = await api.get("/api/reminders");
    const list = $("#reminder-list");
    list.innerHTML = "";
    $("#reminder-count").textContent = reminders.length ? `${reminders.length} pending` : "";
    $("#reminder-badge").hidden = reminders.length === 0;
    $("#reminder-badge").textContent = String(reminders.length);

    if (!reminders.length) {
      const p = document.createElement("div");
      p.className = "item";
      p.innerHTML = `<div class="item-main"><div class="item-title">No reminders yet</div><div class="item-sub">Add one above, or just say “Asta, remind me to…”</div></div>`;
      list.appendChild(p);
      return;
    }

    for (const r of reminders) {
      const due = new Date(r.due);
      const item = document.createElement("div");
      item.className = "item";

      const chip = document.createElement("div");
      chip.className = "avatar-chip";
      chip.textContent = "⏰";

      const main = document.createElement("div");
      main.className = "item-main";
      const t = document.createElement("div");
      t.className = "item-title";
      t.textContent = r.text;
      const s = document.createElement("div");
      s.className = "item-sub mono";
      s.textContent = r.id;
      main.append(t, s);

      const dueEl = document.createElement("div");
      dueEl.className = "item-due";
      const strong = document.createElement("strong");
      strong.textContent = due.toLocaleDateString([], { month: "short", day: "numeric" });
      const time = document.createElement("span");
      time.textContent = due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      dueEl.append(strong, time);

      const actions = document.createElement("div");
      actions.className = "item-actions";
      const done = document.createElement("button");
      done.className = "btn sm";
      done.textContent = "Done";
      done.onclick = async () => {
        await api.post(`/api/reminders/${encodeURIComponent(r.id)}`);
        toast("Marked as done");
        loadReminders();
      };
      const del = document.createElement("button");
      del.className = "btn sm danger";
      del.textContent = "Delete";
      del.onclick = async () => {
        await api.del(`/api/reminders/${encodeURIComponent(r.id)}`);
        toast("Reminder deleted");
        loadReminders();
      };
      actions.append(done, del);

      item.append(chip, main, dueEl, actions);
      list.appendChild(item);
    }
  } catch (e) {
    toast(`Could not load reminders: ${e.message}`, "err");
  }
}

/* ------------------------------------------------------------------ memory */

async function loadMemory(q = "") {
  try {
    const { items } = await api.get(`/api/memory${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    const list = $("#memory-list");
    list.innerHTML = "";
    if (!items.length) {
      list.innerHTML = `<div class="item"><div class="item-main"><div class="item-title">${q ? "No matches" : "No memories yet"}</div><div class="item-sub">Ask Asta to “remember that …” and it will appear here.</div></div></div>`;
      return;
    }
    for (const m of items) {
      const item = document.createElement("div");
      item.className = "item";
      const chip = document.createElement("div");
      chip.className = "avatar-chip";
      chip.textContent = "★";
      const main = document.createElement("div");
      main.className = "item-main";
      const t = document.createElement("div");
      t.className = "item-title";
      t.textContent = m.text.length > 160 ? m.text.slice(0, 160).trim() + "…" : m.text;
      const s = document.createElement("div");
      s.className = "item-sub mono";
      s.textContent = `${m.name} · ${new Date(m.mtime).toLocaleString()}`;
      main.append(t, s);
      item.append(chip, main);
      list.appendChild(item);
    }
  } catch (e) {
    toast(`Could not load memory: ${e.message}`, "err");
  }
}

/* ---------------------------------------------------------------- settings */

const SETTINGS_FIELDS = [
  { path: ["wake", "mode"], label: "Wake mode", type: "select", options: ["whisper", "porcupine", "manual"], desc: "whisper: no signup · porcupine: most accurate · manual: press Enter" },
  { path: ["wake", "label"], label: "Wake word", type: "text" },
  { path: ["wake", "picovoiceAccessKey"], label: "Picovoice AccessKey", type: "text", desc: "Only needed for porcupine mode" },
  { path: ["brain", "model"], label: "Brain model", type: "text", desc: "e.g. opencode/beam-free (fastest)" },
  { path: ["brain", "agent"], label: "OpenCode agent", type: "text" },
  { path: ["tts", "engine"], label: "Voice engine", type: "select", options: ["piper", "sapi"] },
  { path: ["tts", "speed"], label: "Speech speed", type: "number", step: 0.05, desc: "1.0 is normal" },
  { path: ["audio", "silenceThreshold"], label: "Mic silence threshold", type: "number", desc: "Raise if noise triggers it; lower if it misses you" },
  { path: ["audio", "silenceMs"], label: "Silence before stopping (ms)", type: "number" },
  { path: ["audio", "maxUtteranceMs"], label: "Max recording length (ms)", type: "number" },
  { path: ["audio", "beep"], label: "Beep when listening", type: "boolean" },
  { path: ["stt", "prompt"], label: "Speech recognition hint", type: "text", wide: true, desc: "Biases recognition towards your wake word" },
  { path: ["reminders", "enabled"], label: "Announce reminders aloud", type: "boolean" },
  { path: ["ui", "openOnStart"], label: "Open this window at startup", type: "boolean" },
];

const getPath = (obj, p) => p.reduce((o, k) => (o == null ? undefined : o[k]), obj);

async function loadSettings() {
  try {
    const data = await api.get("/api/settings");
    const form = $("#settings-form");
    form.innerHTML = "";

    for (const f of SETTINGS_FIELDS) {
      const wrap = document.createElement("div");
      wrap.className = `field${f.wide ? " wide" : ""}`;
      const label = document.createElement("label");
      label.textContent = f.label;
      label.htmlFor = `set-${f.path.join("-")}`;
      wrap.appendChild(label);

      const value = getPath(data.config, f.path);
      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        for (const o of f.options) {
          const opt = document.createElement("option");
          opt.value = o;
          opt.textContent = o;
          input.appendChild(opt);
        }
        input.value = value ?? f.options[0];
      } else if (f.type === "boolean") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(value);
        wrap.classList.add("field-check");
        input.style.width = "auto";
      } else {
        input = document.createElement("input");
        input.type = f.type === "number" ? "number" : "text";
        if (f.step) input.step = String(f.step);
        input.value = value ?? "";
      }
      input.id = `set-${f.path.join("-")}`;
      input.dataset.path = f.path.join(".");
      input.dataset.type = f.type;
      wrap.appendChild(input);
      if (f.desc) {
        const d = document.createElement("div");
        d.className = "desc";
        d.textContent = f.desc;
        wrap.appendChild(d);
      }
      form.appendChild(wrap);
    }

    const paths = $("#paths");
    paths.innerHTML = "";
    const sys = data.system ?? {};
    for (const [k, v] of Object.entries(sys)) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v ?? "—";
      paths.append(dt, dd);
    }
    $("#build-info").textContent = `${sys["wake"] ?? ""}`.trim() || "—";
  } catch (e) {
    toast(`Could not load settings: ${e.message}`, "err");
  }
}

async function saveSettings() {
  const patch = {};
  for (const input of document.querySelectorAll("#settings-form [data-path]")) {
    const keys = input.dataset.path.split(".");
    let value;
    if (input.dataset.type === "boolean") value = input.checked;
    else if (input.dataset.type === "number") value = input.value === "" ? undefined : Number(input.value);
    else value = input.value;

    let node = patch;
    keys.forEach((k, i) => {
      if (i === keys.length - 1) node[k] = value;
      else node = node[k] ??= {};
    });
  }
  try {
    await api.put("/api/settings", patch);
    $("#settings-state").textContent = `saved at ${new Date().toLocaleTimeString()}`;
    toast("Settings saved. Restart Asta to apply wake-mode changes.");
  } catch (e) {
    toast(`Could not save: ${e.message}`, "err");
  }
}

/* ------------------------------------------------------------------- live */

function connect() {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}&level=1`);

  source.addEventListener("open", () => {
    $("#conn").className = "conn is-live";
    $("#conn-text").textContent = "live";
  });

  source.addEventListener("error", () => {
    $("#conn").className = "conn is-down";
    $("#conn-text").textContent = "reconnecting…";
  });

  source.addEventListener("level", (e) => {
    const { level } = JSON.parse(e.data);
    const pct = Math.min(100, (level / 2600) * 100);
    $("#level-fill").style.width = `${pct}%`;
    $("#level-val").textContent = String(Math.round(level));
  });

  source.addEventListener("message", (e) => {
    const ev = JSON.parse(e.data);
    switch (ev.type) {
      case "status":
        setStatus(ev.status, ev.detail);
        break;
      case "heard":
        addBubble({ who: "you", text: ev.text, meta: timeOf(ev.ts), ignored: ev.ignored });
        break;
      case "typed":
        addBubble({ who: "you", text: ev.text, meta: `${timeOf(ev.ts)} · typed` });
        break;
      case "said":
        addBubble({ who: "asta", text: ev.text, meta: timeOf(ev.ts) });
        break;
      case "reminder":
        addBubble({ who: "asta", text: `⏰ Reminder: ${ev.text}`, meta: timeOf(ev.ts) });
        toast(`Reminder: ${ev.text}`);
        loadReminders();
        break;
      case "notice":
        toast(ev.text, ev.level === "error" ? "err" : "ok");
        break;
    }
  });
}

/* ------------------------------------------------------------------ events */

$("#nav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (btn) showView(btn.dataset.view);
});

$("#composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#composer-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    await api.post("/api/ask", { text });
  } catch (err) {
    toast(`Could not send: ${err.message}`, "err");
  }
});

$("#reminder-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#reminder-text").value.trim();
  const when = $("#reminder-when").value.trim();
  if (!text || !when) {
    toast("Give me both the reminder and a time", "err");
    return;
  }
  try {
    await api.post("/api/reminders", { text, when });
    $("#reminder-text").value = "";
    $("#reminder-when").value = "";
    toast("Reminder added");
    loadReminders();
  } catch (err) {
    toast(err.message, "err");
  }
});

$("#memory-search").addEventListener(
  "input",
  debounce((e) => loadMemory(e.target.value.trim()), 220)
);

$("#vault-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#vault-q").value.trim();
  if (!q) return;
  try {
    const { hits } = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
    const box = $("#vault-results");
    box.innerHTML = "";
    if (!hits.length) {
      box.innerHTML = `<div class="item"><div class="item-main"><div class="item-title">No matches in your vault</div></div></div>`;
      return;
    }
    for (const h of hits) {
      const item = document.createElement("div");
      item.className = "item";
      const chip = document.createElement("div");
      chip.className = "avatar-chip";
      chip.textContent = "🔍";
      const main = document.createElement("div");
      main.className = "item-main";
      const t = document.createElement("div");
      t.className = "item-title";
      t.textContent = h.file;
      const s = document.createElement("div");
      s.className = "item-sub";
      s.textContent = h.snippet;
      main.append(t, s);
      item.append(chip, main);
      box.appendChild(item);
    }
  } catch (err) {
    toast(err.message, "err");
  }
});

$("#btn-save").addEventListener("click", saveSettings);
$("#btn-clear").addEventListener("click", () => {
  $("#transcript").innerHTML = `<div class="empty" id="transcript-empty"><p>Nothing yet.</p><p class="muted">Say “Asta, what time is it?” or type below.</p></div>`;
});

$("#toggle-ignored").addEventListener("change", (e) => {
  showIgnored = e.target.checked;
  for (const el of document.querySelectorAll('.bubble[data-ignored="1"]')) {
    el.style.display = showIgnored ? "" : "none";
  }
});

$("#btn-pause").addEventListener("click", async () => {
  try {
    const r = await api.post("/api/control", { action: state.paused ? "resume" : "pause" });
    applyPaused(r.paused);
    toast(r.paused ? "Listening paused" : "Listening resumed");
  } catch (e) {
    toast(e.message, "err");
  }
});

function applyPaused(paused) {
  state.paused = paused;
  $("#pause-label").textContent = paused ? "Resume" : "Pause";
  if (paused) setStatus("paused");
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* -------------------------------------------------------------- bootstrap */

(async function init() {
  try {
    const s = await api.get("/api/state");
    applyPaused(Boolean(s.paused));
    setStatus(s.paused ? "paused" : s.status || "idle");
    if (s.system) $("#build-info").textContent = s.system.wake ?? "—";
  } catch {
    /* the stream will report problems */
  }

  // Replay recent history so the transcript is not empty after a reload.
  try {
    const { events } = await api.get("/api/history?limit=120");
    for (const ev of events) {
      if (ev.type === "heard") addBubble({ who: "you", text: ev.text, meta: timeOf(ev.ts), ignored: ev.ignored });
      else if (ev.type === "typed") addBubble({ who: "you", text: ev.text, meta: `${timeOf(ev.ts)} · typed` });
      else if (ev.type === "said") addBubble({ who: "asta", text: ev.text, meta: timeOf(ev.ts) });
      else if (ev.type === "reminder") addBubble({ who: "asta", text: `⏰ Reminder: ${ev.text}`, meta: timeOf(ev.ts) });
    }
  } catch {
    /* ignore */
  }

  connect();
  loadReminders();
})();
