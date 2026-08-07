/* Minimal static server mirroring Vercel's cleanUrls behaviour:
   /blogs -> blogs.html, /admin -> admin/index.html. Dev only.   */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 4173;
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4",
  ".ico": "image/x-icon", ".txt": "text/plain",
};

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let p = decodeURIComponent(url.pathname);
  if (p.includes("..")) { res.writeHead(400); return res.end(); }
  let file = path.join(ROOT, p);
  // canonical redirect for extensionless directories (/admin -> /admin/),
  // like Vercel — relative asset URLs break without the trailing slash
  if (!p.endsWith("/") && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    res.writeHead(308, { Location: p + "/" + url.search });
    return res.end();
  }
  if (p.endsWith("/")) file = path.join(file, "index.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (fs.existsSync(file + ".html")) file += ".html";
    else if (fs.existsSync(path.join(file, "index.html"))) file = path.join(file, "index.html");
    else { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`dev server on http://127.0.0.1:${PORT}`));
