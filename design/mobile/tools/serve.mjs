import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  const p = path.normalize(path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  // POST /<file> writes the body to <root>/<file> (the browser tool cannot write files itself): used to save hash dumps.
  if (req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { fs.writeFileSync(p, Buffer.concat(chunks)); res.writeHead(200); res.end("saved"); });
    return;
  }
  fs.readFile(p, (e, b) => {
    if (e) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" }); res.end(b);
  });
}).listen(8791, "127.0.0.1", () => console.log("listening"));
