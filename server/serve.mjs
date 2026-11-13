// 開発用の静的サーバー（手元だけ。公開しない）。ポートは SPEC §4 の claude-code 枠 5100〜5199。
//   /            web/index.html
//   /dist/*      esbuild の出力
//   /vocatab/*   VOCATAB_DIR の web_index.json・voicebanks/・vocoders/（読み取りだけ。再配布しない）
//   /fixtures/*  見本返答
//   POST /api/save?name=x.mp3  本体を out/ に保存（e2e・MCP の書き出し用）
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, extname, normalize, resolve } from "node:path";
import { ROOT, vocatabDir } from "../scripts/paths.mjs";

const VT = vocatabDir();
const OUT = resolve(ROOT, "out");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".map": "application/json",
                ".css": "text/css", ".txt": "text/plain; charset=utf-8", ".onnx": "application/octet-stream", ".bin": "application/octet-stream" };

function safeJoin(base, rel) {
  const p = normalize(resolve(base, "." + normalize("/" + decodeURIComponent(rel))));
  return p.startsWith(base) ? p : null;
}

export function startServer(port = Number(process.env.PORT ?? 5100), host = "127.0.0.1") {
  if (port < 5100 || port > 5199) throw new Error("PORT は 5100〜5199（SPEC §4）");
  const srv = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    // cross-origin isolated にして onnxruntime-web を複数スレッドで回す（CDN の読み込みは credentialless で通す）
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    if (req.method === "POST" && url.pathname === "/api/save") {
      const name = basename(url.searchParams.get("name") ?? "out.bin");
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(resolve(OUT, name), Buffer.concat(chunks));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ saved: `out/${name}` }));
      });
      return;
    }
    if (url.pathname === "/favicon.ico") return void res.writeHead(204).end();
    let file = null;
    const p = url.pathname;
    if (p === "/" || p === "/index.html") file = resolve(ROOT, "web/index.html");
    else if (p.startsWith("/dist/")) file = safeJoin(resolve(ROOT, "dist"), p.slice(6));
    else if (p.startsWith("/fixtures/")) file = safeJoin(resolve(ROOT, "fixtures"), p.slice(10));
    else if (p.startsWith("/web/")) file = safeJoin(resolve(ROOT, "web"), p.slice(5));
    else if (p.startsWith("/vocatab/")) {
      const rel = p.slice(9);
      if (rel === "web_index.json" || rel.startsWith("voicebanks/") || rel.startsWith("vocoders/")) file = safeJoin(VT, rel);
    }
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-length": statSync(file).size,
                         "cache-control": "no-cache" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, ng) => {
    srv.once("error", ng);
    srv.listen(port, host, () => ok(srv));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const srv = await startServer();
  console.log(`http://127.0.0.1:${srv.address().port}/  (VocaTab: ${VT})`);
}
