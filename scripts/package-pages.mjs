// GitHub Pages 用の静的サイトを site/ に組み立てる。歌声モデル・ボコーダ・SoundFont は含めない。
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { ROOT } from "./paths.mjs";

const SITE = resolve(ROOT, "site");
const FORBIDDEN_EXT = new Set([".onnx", ".sf2", ".sf3", ".bin", ".mp3", ".wav", ".wasm"]);
const FORBIDDEN_NAME = /(?:^|\/)(voicebanks|vocoders|breaths)(?:\/|$)/i;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    (statSync(p).isDirectory() ? walk(p, acc) : acc).push(p);
  }
  return acc;
}

function assertClean(dir) {
  const bad = walk(dir).filter((p) => {
    const rel = relative(dir, p).replaceAll("\\", "/");
    return FORBIDDEN_EXT.has(extname(p).toLowerCase()) || FORBIDDEN_NAME.test(rel);
  });
  if (bad.length) throw new Error(`デプロイ物にモデルまたは音源が含まれています:\n${bad.map((p) => relative(dir, p)).join("\n")}`);
}

if (!existsSync(resolve(ROOT, "dist/app.js")) || !existsSync(resolve(ROOT, "dist/engine-worker.js"))) {
  throw new Error("先に npm run build してください");
}

rmSync(SITE, { recursive: true, force: true });
mkdirSync(resolve(SITE, "dist"), { recursive: true });
mkdirSync(resolve(SITE, "fixtures/gallery"), { recursive: true });
cpSync(resolve(ROOT, "web/index.html"), resolve(SITE, "index.html"));
cpSync(resolve(ROOT, "web/gallery.html"), resolve(SITE, "gallery.html"));
cpSync(resolve(ROOT, "LICENSE"), resolve(SITE, "LICENSE"));
cpSync(resolve(ROOT, "NOTICE.md"), resolve(SITE, "NOTICE.md"));
writeFileSync(resolve(SITE, ".nojekyll"), "");
for (const name of readdirSync(resolve(ROOT, "dist"))) {
  if (name.endsWith(".map")) continue; // ソースマップは公開サイトに置かない（ビルド環境のパスが入り得る）
  cpSync(resolve(ROOT, "dist", name), resolve(SITE, "dist", name));
}
cpSync(resolve(ROOT, "fixtures/sample-response.txt"), resolve(SITE, "fixtures/sample-response.txt"));
for (const name of readdirSync(resolve(ROOT, "fixtures/gallery"))) {
  if (name.endsWith(".json")) cpSync(resolve(ROOT, "fixtures/gallery", name), resolve(SITE, "fixtures/gallery", name));
}
assertClean(SITE);
console.log(`packaged ${SITE} (${walk(SITE).length} files)`);
