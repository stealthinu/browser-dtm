// esbuild で dist/ を作る。VocaTab のソースは import するだけで書き換えない（出力は自分の dist/ へ）。
import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, vocatabDir } from "./paths.mjs";

const VT = vocatabDir();
// npm は内部 SoundFont クラスを export しないため、同版の上流ソースを読取専用 import。
const DTM = resolve(process.env.DTM_DIR ?? "/workspace/dtm-research/dtm");
if (!existsSync(resolve(DTM, "src/instruments/sf/SoundFont.ts"))) throw new Error("DTM_DIR に dtm 2.1.38 のソースを指定してください");
const installed = JSON.parse(readFileSync(resolve(ROOT, "node_modules/@onjmin/dtm/package.json")));
if (JSON.parse(readFileSync(resolve(DTM, "package.json"))).version !== installed.version) throw new Error("DTM_DIR と npm の dtm の版が異なります");
const dtmInternal = { name: "dtm-soundfont", setup(b) {
  b.onResolve({ filter: /^@dtm-soundfont$/ }, () => ({ path: resolve(DTM, "src/instruments/sf/SoundFont.ts") }));
}};
const BUILD = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const common = { bundle: true, target: "es2022", sourcemap: true, logLevel: "warning", define: { __BUILD__: JSON.stringify(BUILD) } };
const vocatabAlias = {
  name: "vocatab-alias",
  setup(b) {
    b.onResolve({ filter: /^@vocatab\// }, (a) => ({ path: resolve(VT, "ui/src", a.path.slice("@vocatab/".length) + ".ts") }));
  },
};
await build({ ...common, entryPoints: [resolve(VT, "ui/src/engine-web/worker.ts")], format: "iife",
              outfile: resolve(ROOT, "dist/engine-worker.js") });
await build({ ...common, entryPoints: [resolve(ROOT, "src/web/main.ts")], format: "esm", outfile: resolve(ROOT, "dist/app.js"),
              plugins: [vocatabAlias, dtmInternal] });
await build({ ...common, entryPoints: [resolve(ROOT, "src/web/gallery.ts")], format: "esm", outfile: resolve(ROOT, "dist/gallery.js") });
console.log(`built dist/ (VocaTab: ${VT}, build ${BUILD})`);
