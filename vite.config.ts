import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const vocatabRoot = process.env.VOCATAB_DIR
  ? path.resolve(process.env.VOCATAB_DIR)
  : path.resolve(__dirname, "vendor/vocatab");

/** /vocatab/* を VocaTab ルートから静的配信（voicebanks / engine-worker） */
function vocatabStatic(): Plugin {
  return {
    name: "vocatab-static",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/vocatab/")) return next();
        const rel = decodeURIComponent(req.url.slice("/vocatab/".length).split("?")[0]);
        const file = path.resolve(vocatabRoot, rel);
        if (!file.startsWith(vocatabRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const ext = path.extname(file).toLowerCase();
        const types: Record<string, string> = {
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".json": "application/json",
          ".wasm": "application/wasm",
          ".onnx": "application/octet-stream",
          ".bin": "application/octet-stream",
          ".yaml": "text/yaml",
          ".yml": "text/yaml",
          ".txt": "text/plain",
          ".map": "application/json",
        };
        res.setHeader("Content-Type", types[ext] || "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: ".",
  publicDir: "public",
  plugins: [vocatabStatic()],
  server: {
    host: "127.0.0.1",
    port: 5300,
    strictPort: true,
    fs: { allow: [".", vocatabRoot] },
  },
  preview: {
    host: "127.0.0.1",
    port: 5301,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "vocatab-src": path.join(vocatabRoot, "ui/src"),
    },
  },
  optimizeDeps: {
    exclude: ["vocatab-src"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
