// End-to-end test of the dashboard: static assets, auth, REST API, SSE stream,
// and the settings guard that keeps binary paths auto-detected.
// Run: node scripts/test-dashboard.mjs
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";
import { makeRuntime } from "../src/asta.js";
import { bus } from "../src/bus.js";
import { ROOT } from "../src/log.js";

const cfgFile = path.join(ROOT, "config.json");
const originalConfig = fs.readFileSync(cfgFile, "utf8");
// Never leave the user's config edited, even if a test throws.
process.on("exit", () => {
  try {
    fs.writeFileSync(cfgFile, originalConfig);
  } catch {
    /* ignore */
  }
});

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}`);
  }
};

const cfg = loadConfig({ ui: { openOnStart: false, port: 7399 } });

// The real runtime, driven by a minimal state so nothing touches the microphone.
const rtState = {
  stopped: false,
  speaking: false,
  paused: false,
  status: "listening",
  detail: "",
  idleStatus: "listening",
  idleDetail: "",
  wakeAtStart: cfg.wake.mode,
  turn: (fn) => Promise.resolve().then(fn),
  onLevel: () => {},
};
const runtime = makeRuntime(cfg, rtState);

const { server, token, url } = await startServer({ cfg, runtime });
const base = url.replace(/\/$/, "");
const api = (p, init = {}) =>
  fetch(base + p, { ...init, headers: { "x-asta-token": token, ...(init.headers ?? {}) } });
const json = (p, method, body) =>
  api(p, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

console.log("\nassets & auth");

const page = await api("/");
const html = await page.text();
ok(page.status === 200, "GET / returns 200");
ok(html.includes(`"${token}"`), "token injected into the page");
ok(!html.includes("@@ASTA_TOKEN@@"), "placeholder replaced");
ok(html.includes("window.__ASTA_TOKEN__"), "token assigned to the expected global");

const unauth = await fetch(base + "/api/state");
ok(unauth.status === 401, "API rejects requests without a token");

for (const asset of ["/assets/app.css", "/assets/app.js", "/assets/favicon.svg"]) {
  const r = await api(asset);
  ok(r.status === 200 && (await r.text()).length > 100, `GET ${asset}`);
}

const traversal = await api("/assets/../../config.json");
ok(traversal.status !== 200 || !(await traversal.text()).includes('"wake"'), "path traversal blocked");

console.log("\nstate, reminders, memory");

const state = await (await api("/api/state")).json();
ok(state.status === "listening", "GET /api/state");

const paused = await (await json("/api/control", "POST", { action: "pause" })).json();
ok(paused.ok === true && paused.paused === true, "POST /api/control pauses");
const afterPause = await (await api("/api/state")).json();
ok(afterPause.paused === true && afterPause.status === "paused", "GET /api/state reflects the pause");
const resumed = await (await json("/api/control", "POST", { action: "resume" })).json();
ok(resumed.paused === false && afterPause !== resumed, "POST /api/control resumes");
const bogus = await (await json("/api/control", "POST", { action: "explode" })).json();
ok(bogus.ok === false, "POST /api/control rejects an unknown action");

let list = await (await api("/api/reminders")).json();
ok(Array.isArray(list.reminders), "GET /api/reminders");

const added = await (await json("/api/reminders", "POST", { text: "dashboard test", when: "in 5 minutes" })).json();
ok(added.ok === true, "POST /api/reminders");
if (added.ok) {
  const del = await (await api(`/api/reminders/${added.reminder.id}`, { method: "DELETE" })).json();
  ok(del.ok === true, "DELETE /api/reminders/:id");
}
const bad = await (await json("/api/reminders", "POST", { text: "x", when: "gobbledygook" })).json();
ok(bad.ok === false, "POST /api/reminders rejects a nonsense time");

const mem = await (await api("/api/memory")).json();
ok(Array.isArray(mem.items), "GET /api/memory");

const hist = await (await api("/api/history?limit=5")).json();
ok(Array.isArray(hist.events), "GET /api/history");

const missing = await api("/api/nope");
ok(missing.status === 404, "unknown API route 404s");

console.log("\nserver-sent events");

const ac = new AbortController();
const stream = await fetch(base + `/api/events?token=${token}&level=1`, {
  signal: ac.signal,
});
ok(stream.status === 200, "GET /api/events opens");
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
const waitFor = async (predicate, ms = 4000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate(buffer)) return true;
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (predicate(buffer)) return true;
  }
  return predicate(buffer);
};

bus.publish("said", { text: "hello from the test" });
ok(await waitFor((b) => b.includes("hello from the test")), "SSE delivers said events");
bus.publish("level", { level: 1234 });
ok(await waitFor((b) => b.includes('"level":1234')), "SSE delivers level events");
ac.abort();

console.log("\nsettings guard");

const before = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
const readback = await (await api("/api/settings")).json();
ok(readback.config?.wake?.mode === before.wake.mode, "GET /api/settings returns the raw config");
ok(typeof readback.system?.model === "string", "GET /api/settings returns a system summary");

await json("/api/settings", "PUT", { paths: { whisperExe: "C:\\evil\\whisper.exe" } });
const afterTamper = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
ok(afterTamper.paths.whisperExe === before.paths.whisperExe, "PUT /api/settings cannot rewrite binary paths");

await json("/api/settings", "PUT", { tts: { speed: before.tts.speed } });
const afterNoop = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
ok(afterNoop.tts.speed === before.tts.speed, "PUT /api/settings round-trips cleanly");

console.log("\nresults");
console.log(`  ${pass} passed, ${fail} failed`);

server.close();
fs.writeFileSync(cfgFile, originalConfig);
process.exit(fail === 0 ? 0 : 1);
