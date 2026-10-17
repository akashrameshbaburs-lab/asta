// Local dashboard server: static UI, live event stream (SSE), and a small API.
// Binds to loopback only and requires a per-run token, so other web pages
// cannot talk to it.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { bus } from "./bus.js";
import { log } from "./log.js";
import * as rem from "./reminders.js";
import * as memory from "./memory.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "web");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** Serve a file from web/, refusing anything outside it. */
function serveStatic(res, rel) {
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(WEB_DIR, safe);
  if (!full.startsWith(WEB_DIR)) {
    res.writeHead(403).end("forbidden");
    return true;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  const type = MIME[path.extname(full).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(full).pipe(res);
  return true;
}

/**
 * Start the dashboard.
 * `runtime` is the assistant handle supplied by asta.js.
 */
export function startServer({ cfg, runtime }) {
  const token = crypto.randomBytes(18).toString("hex");
  const clients = new Set();

  // Fan every bus event out to connected browsers.
  bus.on("event", (event) => {
    if (event.type === "level") {
      // levels are only sent to clients that asked for them
      const frame = `event: level\ndata: ${JSON.stringify(event)}\n\n`;
      for (const c of clients) if (c.wantsLevel) c.res.write(frame);
      return;
    }
    const frame = `event: message\ndata: ${JSON.stringify(event)}\n\n`;
    for (const c of clients) c.res.write(frame);
  });

  const authorised = (req, url) => {
    if (req.headers["x-asta-token"] === token) return true;
    if (url.searchParams.get("token") === token) return true;
    return false;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`);
    const route = url.pathname;

    try {
      // ---- page + assets -------------------------------------------------
      if (route === "/" || route === "/index.html") {
        const html = fs
          .readFileSync(path.join(WEB_DIR, "index.html"), "utf8")
          .replace("@@ASTA_TOKEN@@", token);
        res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
        res.end(html);
        return;
      }
      if (route.startsWith("/assets/")) {
        if (serveStatic(res, route.slice("/assets/".length))) return;
        res.writeHead(404).end("not found");
        return;
      }
      if (route === "/favicon.ico") {
        if (!serveStatic(res, "favicon.svg")) res.writeHead(404).end();
        return;
      }

      // ---- API -----------------------------------------------------------
      if (!route.startsWith("/api/")) {
        res.writeHead(404).end("not found");
        return;
      }
      if (!authorised(req, url)) {
        sendJson(res, 401, { error: "unauthorised" });
        return;
      }

      if (route === "/api/state") {
        sendJson(res, 200, runtime.getStatus());
        return;
      }

      if (route === "/api/history") {
        sendJson(res, 200, { events: bus.recent(Number(url.searchParams.get("limit") ?? 200)) });
        return;
      }

      if (route === "/api/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        res.write("retry: 3000\n\n");
        const client = { res, wantsLevel: url.searchParams.get("level") === "1" };
        clients.add(client);
        const beat = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch {
            /* ignore */
          }
        }, 20000);
        req.on("close", () => {
          clearInterval(beat);
          clients.delete(client);
        });
        return;
      }

      if (route === "/api/ask" && req.method === "POST") {
        const body = await readBody(req);
        const text = String(body.text ?? "").trim();
        if (!text) {
          sendJson(res, 400, { error: "empty message" });
          return;
        }
        runtime.ask(text); // runs queued; results arrive over SSE
        sendJson(res, 202, { ok: true });
        return;
      }

      if (route === "/api/control" && req.method === "POST") {
        const body = await readBody(req);
        sendJson(res, 200, runtime.control(String(body.action ?? "")));
        return;
      }

      if (route === "/api/reminders") {
        if (req.method === "GET") {
          sendJson(res, 200, { reminders: rem.listReminders(cfg, { includeDone: url.searchParams.get("all") === "1" }) });
          return;
        }
        if (req.method === "POST") {
          const body = await readBody(req);
          const r = rem.addReminder(cfg, body.text, body.when);
          sendJson(res, r.ok ? 200 : 400, r);
          return;
        }
      }

      const reminderMatch = route.match(/^\/api\/reminders\/([^/]+)$/);
      if (reminderMatch) {
        const id = decodeURIComponent(reminderMatch[1]);
        if (req.method === "DELETE") {
          sendJson(res, 200, rem.removeReminder(cfg, id));
          return;
        }
        if (req.method === "POST") {
          sendJson(res, 200, rem.completeReminder(cfg, id));
          return;
        }
      }

      if (route === "/api/memory") {
        const q = url.searchParams.get("q");
        const items = q ? memory.searchMemory(cfg, q) : memory.listMemory(cfg);
        sendJson(res, 200, { items });
        return;
      }

      if (route === "/api/search") {
        sendJson(res, 200, { hits: memory.recall(cfg, url.searchParams.get("q") ?? "") });
        return;
      }

      if (route === "/api/settings") {
        if (req.method === "GET") {
          sendJson(res, 200, runtime.getSettings());
          return;
        }
        if (req.method === "PUT") {
          const body = await readBody(req);
          sendJson(res, 200, runtime.saveSettings(body));
          return;
        }
      }

      res.writeHead(404).end("not found");
    } catch (e) {
      log(`dashboard error on ${route}: ${e.message}`, "warn");
      try {
        sendJson(res, 500, { error: e.message });
      } catch {
        /* ignore */
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.ui.port, cfg.ui.host, () => {
      const url = `http://${cfg.ui.host}:${cfg.ui.port}/`;
      log(`dashboard listening on ${url}`, "info");
      resolve({ server, token, url });
    });
  });
}
