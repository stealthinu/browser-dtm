import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { openApp } from "./browser.mjs";
import { ROOT } from "./paths.mjs";
import { corr, decodeMp3, levels, readWav } from "./analyze.mjs";
import { spectralMetrics } from "./vocaloid-metrics.mjs";
const out = (n) => resolve(ROOT, "out", n);
mkdirSync(out("."), { recursive: true });
const results = { checks: [] };
const check = (name, ok, detail = {}) => { results.checks.push({ name, ok, ...detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
const sample = readFileSync(resolve(ROOT, "fixtures/sample-response.txt"), "utf8");
const { page, browser, close } = await openApp({ port: 5503, log: (s) => { if (/error|失敗/i.test(s)) console.log(s); } });
try {
  await page.evaluate((s) => window.app.importText(s), sample);
  await page.$eval("#soundfont", e => e.checked = false);
  results.synth = await page.evaluate(() => window.app.exportAudio({ name: "synth-song", toServer: true, stems: true }));
  await page.$eval("#soundfont", e => e.checked = true);
  results.sf = await page.evaluate(() => window.app.exportAudio({ name: "soundfont-song", toServer: true, stems: true }));
  const [a] = readWav(out("synth-song.acc.wav")), [b] = readWav(out("soundfont-song.acc.wav"));
  const confidence = new Float32Array(a.length).fill(1);
  results.comparison = { correlation: corr(a, b), synthCentroid: spectralMetrics(a, a, confidence).centroidHz,
    sfCentroid: spectralMetrics(b, b, confidence).centroidHz };
  check("FluidR3楽器とドラムをロード", results.sf.soundfont.mode === "soundfont" && results.sf.soundfont.files.some(s => s.startsWith("128")), results.sf.soundfont);
  check("伴奏の波形・スペクトル差", Math.abs(results.comparison.correlation) < 0.9 && Math.abs(results.comparison.synthCentroid - results.comparison.sfCentroid) > 100, results.comparison);
  const [L, R] = decodeMp3(out("soundfont-song.mp3"));
  results.mp3 = { L: levels(L), R: levels(R) };
  check("MP3有音・clip0", results.mp3.L.rmsDb > -40 && results.mp3.L.clipped + results.mp3.R.clipped === 0, results.mp3);
  check("歌・伴奏区間有音", results.sf.vox.rmsDb > -40 && levels(b, 0, 8).rmsDb > -40, { vocal: results.sf.vox, accompaniment: levels(b, 0, 8) });
  check("Chromeで実再生", results.sf.playback.maxRms > 0.001 && results.sf.playback.elapsedSeconds >= results.sf.seconds - 0.05, results.sf.playback);
  // 新しいページで、遷移前に外部音源の遮断とcache無効化を設定する。
  const failurePage = await browser.newPage();
  await failurePage.setCacheEnabled(false);
  await failurePage.setRequestInterception(true);
  let aborted = 0;
  failurePage.on("request", r => { if (r.url().startsWith("https://surikov.github.io/webaudiofontdata/")) { aborted++; r.abort("failed"); } else r.continue(); });
  await failurePage.goto("http://127.0.0.1:5503/", { waitUntil: "load" });
  await failurePage.waitForFunction(() => window.app); await failurePage.evaluate(() => window.app.ready);
  await failurePage.evaluate((s) => window.app.importText(s), sample);
  results.fallback = await failurePage.evaluate(() => window.app.exportAudio({ name: "soundfont-fallback", toServer: true, stems: true }));
  const warning = await failurePage.$eval("#soundfontWarning", e => e.textContent);
  check("失敗時に警告・内蔵で有音", aborted > 0 && results.fallback.soundfont.mode === "synth" && warning.includes("内蔵シンセ") && results.fallback.acc.rmsDb > -40 && results.fallback.playback.maxRms > .001, { aborted, soundfont: results.fallback.soundfont, warning, acc: results.fallback.acc });
  mkdirSync("/workspace/browser-dtm-final", { recursive: true });
  copyFileSync(out("soundfont-song.mp3"), "/workspace/browser-dtm-final/soundfont-song.mp3");
} finally { await close(); writeFileSync(out("e2e-soundfont.json"), JSON.stringify(results, null, 2)); }
assert(results.checks.every(c => c.ok), "SoundFont受入テスト失敗");
