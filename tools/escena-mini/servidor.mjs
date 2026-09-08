// Servidor estático mínimo: Playwright necesita un origen http para que los
// import maps y el GLTFLoader funcionen (file:// los bloquea por CORS).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".png": "image/png",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
};

export function levantar() {
  const servidor = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    const abs = path.join(RAIZ, rel);
    // Nada fuera de la raíz de la herramienta, ni con `..` por el camino.
    if (!abs.startsWith(RAIZ) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.writeHead(404).end("no");
      return;
    }
    res.writeHead(200, { "content-type": TIPOS[path.extname(abs)] ?? "application/octet-stream" });
    fs.createReadStream(abs).pipe(res);
  });
  return new Promise((resolver) => {
    servidor.listen(0, "127.0.0.1", () => resolver({ servidor, puerto: servidor.address().port }));
  });
}
