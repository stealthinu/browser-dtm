// 静的ホスティング相当（GitHub Pages と同じく COOP/COEP なし・/vocatab/ なし）で、
// 公式 VocaTab モデルを使い、実 LLM 返答の貼付→合成→MP3 を確認する。
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { ROOT, finalDir } from "./paths.mjs";
import { CHROME } from "./browser.mjs";

const OFFICIAL = "https://wavtechyukky.github.io/vocatab/";
const SITE = resolve(ROOT, "site");
const STAGE = resolve(ROOT, "out/pages-stage/browser-dtm");
const FINAL = resolve(process.env.FINAL_DIR ?? resolve(ROOT, "out/pages-e2e"));
const PORT = Number(process.env.PAGES_E2E_PORT ?? 8088);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json",
                ".map": "application/json", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
                "": "application/octet-stream" };

if (!existsSync(resolve(SITE, "index.html"))) throw new Error("先に MODEL_BASE を公式にして build し、npm run package:pages してください");

rmSync(resolve(ROOT, "out/pages-stage"), { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
cpSync(SITE, STAGE, { recursive: true });
mkdirSync(FINAL, { recursive: true });

function startStatic(root, port) {
  const srv = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = resolve(root, "." + rel);
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((ok, ng) => { srv.once("error", ng); srv.listen(port, "127.0.0.1", () => ok(srv)); });
}

const checks = [];
const check = (name, ok, detail = {}) => {
  checks.push({ name, ok, ...detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
};

const root = resolve(ROOT, "out/pages-stage");
const srv = await startStatic(root, PORT);
const origin = `http://127.0.0.1:${PORT}`;
const appUrl = `${origin}/browser-dtm/`;
const requests = [];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-gpu", "--no-sandbox", "--mute-audio=false"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 900 });
  page.on("console", (m) => console.log(`[page] ${m.text()}`));
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  page.on("request", (req) => requests.push({ url: req.url(), type: req.resourceType(), method: req.method() }));
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: resolve(FINAL, "downloads") });
  mkdirSync(resolve(FINAL, "downloads"), { recursive: true });

  await page.goto(appUrl, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.app, { timeout: 30000 });
  const modelBase = await page.evaluate(() => window.app.modelBase);
  check("model-base-official", modelBase === OFFICIAL, { modelBase });
  await page.evaluate(() => window.app.ready);
  const status = await page.evaluate(() => document.getElementById("status").textContent);
  check("engine-ready", /エンジン準備完了/.test(status), { status });
  const source = await page.evaluate(() => document.getElementById("model-source")?.textContent ?? "");
  check("model-source-label", source.includes("VocaTab 公式配布") && source.includes("個人・非商用"), { source });

  const request = JSON.parse(readFileSync(resolve(ROOT, "fixtures/llm-real/m3-requests.json"), "utf8"))[0];
  const text = readFileSync(resolve(ROOT, `fixtures/llm-real/${request.answer}`), "utf8");
  await page.evaluate(({ request, text }) => {
    document.getElementById("lyrics").value = request.lyrics;
    document.getElementById("image").value = request.image;
    document.getElementById("answer").value = text;
  }, { request, text });
  await page.click("#load");
  await page.waitForFunction(() => !document.getElementById("load").disabled, { timeout: 360000 });
  const state = await page.evaluate(() => ({
    doc: window.app.getDoc(),
    problems: document.getElementById("problems").textContent,
    playing: window.app.isPlaying(),
    status: document.getElementById("status").textContent,
  }));
  check("paste-and-play", state.problems === "問題なし" && !!state.doc, state);

  await page.screenshot({ path: join(FINAL, "screenshot-main.png"), fullPage: true });

  const exported = await page.evaluate(async () => {
    const s = await window.app.exportAudio({ format: "mp3", name: "llm-gallery-answer", returnBytes: true });
    const data = s.data;
    let b64 = "";
    if (data) {
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
      const chunk = 0x8000;
      for (let i = 0; i < u8.length; i += chunk) b64 += String.fromCharCode(...u8.subarray(i, i + chunk));
      b64 = btoa(b64);
    }
    return { file: s.file, bytes: s.bytes, seconds: s.seconds, playback: s.playback, soundfont: s.soundfont, status: document.getElementById("status").textContent, b64 };
  });
  const dest = join(FINAL, "llm-gallery-answer.mp3");
  if (exported.b64) writeFileSync(dest, Buffer.from(exported.b64, "base64"));
  check("mp3-export", existsSync(dest) && statSync(dest).size > 10000, { path: dest, bytes: exported.bytes, status: exported.status, soundfont: exported.soundfont?.mode, seconds: exported.seconds });

  await page.goto(`${appUrl}gallery.html`, { waitUntil: "load", timeout: 60000 });
  const galleryTitle = await page.title();
  const cards = await page.$$eval(".card", (els) => els.length);
  check("gallery", galleryTitle.includes("サンプル") && cards >= 1, { galleryTitle, cards });
  await page.screenshot({ path: join(FINAL, "screenshot-gallery.png"), fullPage: true });

  const onnx = requests.filter((r) => r.url.includes(".onnx"));
  const officialOnnx = onnx.filter((r) => r.url.startsWith(OFFICIAL));
  const localOnnx = onnx.filter((r) => r.url.startsWith(origin));
  const localModels = requests.filter((r) => r.url.startsWith(origin) && /voicebanks|vocoders|breaths|\.onnx/i.test(r.url));
  const officialHits = requests.filter((r) => r.url.startsWith(OFFICIAL));
  check("models-from-official", officialOnnx.length > 0 && officialHits.some((r) => r.url.endsWith("web_index.json")), {
    officialOnnx: officialOnnx.map((r) => r.url),
    officialCount: officialHits.length,
  });
  check("models-not-from-app-origin", localOnnx.length === 0 && localModels.length === 0, {
    localModels: localModels.map((r) => r.url),
  });

  writeFileSync(join(FINAL, "network.json"), JSON.stringify({ appUrl, modelBase, requests, checks }, null, 2));
} finally {
  await browser.close();
  await new Promise((ok) => srv.close(ok));
}
const failed = checks.filter((c) => !c.ok);
writeFileSync(join(FINAL, "e2e-pages.json"), JSON.stringify({ appUrl, checks }, null, 2));
if (failed.length) {
  console.error(`FAILED ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`ALL ${checks.length} PASS  artifacts: ${FINAL}`);
