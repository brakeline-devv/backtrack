// Dashboard + local API on http://localhost:6200 (127.0.0.1 only: the dashboard is for the human).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./strategy.js";
import * as store from "./store.js";

const ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json" };
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 2e5) req.destroy(); }); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

async function api(req, res, p) {
  const origin = req.headers.origin; // refuse cross-site writes from other websites
  if (req.method !== "GET" && origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return json(res, 403, { error: "forbidden origin" });
  try {
    if (p === "/api/parse" && req.method === "POST") return json(res, 200, parse((await body(req)).text));
    if (p === "/api/backtest" && req.method === "POST") return json(res, 200, await store.run((await body(req)).strategy));
    if (p === "/api/save" && req.method === "POST") { const b = await body(req); return json(res, 200, await store.upsert(b.strategy, { text: b.text, id: b.id })); }
    if (p === "/api/strategies" && req.method === "GET") return json(res, 200, store.list());
    if (p.startsWith("/api/strategy/") && req.method === "GET") return json(res, 200, store.get(decodeURIComponent(p.slice(14))));
    if (p === "/api/promote" && req.method === "POST") return json(res, 200, store.promoteToPaper((await body(req)).id));
    if (p === "/api/status" && req.method === "POST") { const b = await body(req); return json(res, 200, store.setStatusByHuman(b.id, b.status)); }
    if (p === "/api/delete" && req.method === "POST") return json(res, 200, store.remove((await body(req)).id));
    if (p === "/api/signals" && req.method === "POST") { const b = await body(req); return json(res, 200, await store.signals(b.id, b.equity)); }
    if (p === "/api/exits" && req.method === "POST") return json(res, 200, await store.checkExits((await body(req)).id));
    if (p.startsWith("/api/paper/") && req.method === "GET") return json(res, 200, store.paperStatus(decodeURIComponent(p.slice(11))));
    return json(res, 404, { error: "not found" });
  } catch (e) { return json(res, 400, { error: e.message }); }
}

export function startServer(port = Number(process.env.PORT || 6200)) {
  createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.startsWith("/api/")) return api(req, res, p);
    if (p === "/app" || p === "/app/") p = "/app.html";
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(normalize(ROOT))) { res.writeHead(403).end(); return; }
    try {
      const { size } = await stat(file), type = TYPES[extname(file)] || "application/octet-stream";
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || ""), data = await readFile(file);
      if (range) { const a = range[1] ? +range[1] : 0, b = range[2] ? +range[2] : size - 1; res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${a}-${b}/${size}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1 }); res.end(data.subarray(a, b + 1)); }
      else { res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Cache-Control": "no-cache" }); res.end(data); }
    } catch { res.writeHead(404).end("not found"); }
  }).listen(port, "127.0.0.1", () => console.log(`Backtrack → dashboard http://localhost:${port}/app`));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startServer();
