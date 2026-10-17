// Quick check against a *running* Asta daemon (does not start one).
//   node scripts/check-live.mjs [port]
const port = Number(process.argv[2] ?? 7373);
const base = `http://127.0.0.1:${port}`;

const page = await fetch(`${base}/`);
if (!page.ok) {
  console.error(`GET / -> ${page.status}. Is Asta running?`);
  process.exit(1);
}
const html = await page.text();
const token = html.match(/window\.__ASTA_TOKEN__\s*=\s*"([a-f0-9]+)"/)?.[1];
if (!token) {
  console.error("Could not find the dashboard token in the page.");
  process.exit(1);
}
console.log(`page ok, session token ${token.slice(0, 8)}…`);

const api = (p, init = {}) =>
  fetch(base + p, { ...init, headers: { "x-asta-token": token, ...(init.headers ?? {}) } });

const state = await (await api("/api/state")).json();
console.log(`state: status=${state.status} paused=${state.paused}`);
console.log(`system: ${JSON.stringify(state.system, null, 2)}`);

const rem = await (await api("/api/reminders")).json();
console.log(`pending reminders: ${rem.reminders.length}`);

const ac = new AbortController();
const stream = await fetch(`${base}/api/events?token=${token}&level=1`, { signal: ac.signal });
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let levels = 0;
let events = [];
const deadline = Date.now() + 6000;
while (Date.now() < deadline) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  for (const block of buffer.split("\n\n")) {
    const type = block.match(/^event: (\w+)/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (!data) continue;
    if (type === "level") levels++;
    else events.push(JSON.parse(data));
  }
  buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
}
ac.abort();
console.log(`event stream: ${levels} level frames, ${events.length} lifecycle events`);
for (const e of events) console.log(`  ${e.type}: ${JSON.stringify(e).slice(0, 140)}`);
console.log(events.length && levels > 0 ? "\nLIVE CHECK PASSED" : "\nLIVE CHECK INCOMPLETE");
