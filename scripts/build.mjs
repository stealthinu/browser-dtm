// esbuild で dist/ を作る。VocaTab のソースは import するだけで書き換えない（出力は自分の dist/ へ）。
import { build } from "esbuild";
import { resolve } from "node:path";
import { ROOT, vocatabDir } from "./paths.mjs";

const VT = vocatabDir();
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
              plugins: [vocatabAlias] });
console.log(`built dist/ (VocaTab: ${VT}, build ${BUILD})`);
