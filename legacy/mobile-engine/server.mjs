import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4312);
const rootDir = path.dirname(url.fileURLToPath(import.meta.url));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const requestPath = req.url === "/" ? "/index.html" : req.url || "/index.html";
  const filePath = path.join(rootDir, decodeURIComponent(requestPath));
  const normalizedPath = path.normalize(filePath);

  if (!normalizedPath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(normalizedPath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const extension = path.extname(normalizedPath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`mobile-engine dev server running at http://${host}:${port}`);
});
