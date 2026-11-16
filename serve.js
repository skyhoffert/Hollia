#!/usr/bin/env node
/* Local file server for the Hollia pages (production uses GitHub Pages instead).

   node serve.js              http://localhost:3000
   PORT=8090 node serve.js    another port; HOST (default 127.0.0.1) to open it to the network

   Serves this folder only. Never serves the backend (Hollia-backend/: keys, data, worlds) or
   dotfiles (.git). Then log in with server "localhost:3001" (the backend: npm start in Hollia-backend/). */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const HIDDEN = new Set(["hollia-backend", "node_modules"]);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".md": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, rel);
  const parts = path.relative(ROOT, file).split(path.sep);
  if (!file.startsWith(ROOT + path.sep) || parts.some((p) => p.startsWith(".") || HIDDEN.has(p.toLowerCase()))) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // "/tools/scenes" -> "/tools/scenes/"
      if (!err && st.isDirectory()) { res.writeHead(301, { Location: req.url.replace(/\/?(\?|$)/, "/$1") }); return res.end(); }
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    // no-cache = the browser checks every time; the ETag lets it keep its copy (304) until the file changes.
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const head = { "Cache-Control": "no-cache", ETag: etag, "Last-Modified": st.mtime.toUTCString() };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, head); return res.end(); }
    res.writeHead(200, { ...head, "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Content-Length": st.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => console.log(`Hollia pages on http://localhost:${PORT}  (listening on ${HOST}:${PORT})`));
