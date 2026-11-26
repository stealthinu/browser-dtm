// フルコーラス曲を headless Chrome で合成・MP3書き出しし、無音・クリップ・パート有音を数値確認する。
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openApp } from "./browser.mjs";
import { levels, decodeMp3, readWav, SR } from "./analyze.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "out/fullchorus");
const FINAL = resolve(process.env.FINAL_DIR ?? "/workspace/browser-dtm-final/fullchorus");
mkdirSync(OUT, { recursive: true });
mkdirSync(FINAL, { recursive: true });
mkdirSync(resolve(ROOT, "out"), { recursive: true });

const plans = JSON.parse(readFileSync(resolve(OUT, "prompts/stage1-songs.json"), "utf8")).songs;
const ids = process.argv.slice(2).length ? process.argv.slice(2) : plans.map((s) => s.id);

function check(bag, name, ok, detail = {}) {
  bag[name] = { ok, ...detail };
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) console.log("  ", JSON.stringify(detail));
}

function secOfBar(bar, doc) {
  return (bar - 1) * (doc.beatsPerBar || 4) * 60 / doc.bpm;
}

function silenceRuns(x, thr = 0.01, minSec = 8) {
  const min = Math.round(minSec * SR);
  const runs = [];
  let i = 0;
  while (i < x.length) {
    if (Math.abs(x[i]) > thr) { i++; continue; }
    let j = i;
    while (j < x.length && Math.abs(x[j]) <= thr) j++;
    if (j - i >= min) runs.push({ start: +(i / SR).toFixed(2), end: +(j / SR).toFixed(2), seconds: +((j - i) / SR).toFixed(2) });
    i = j;
  }
  return runs;
}

const results = { checks: {}, songs: [] };
const app = await openApp({ port: 5510, log: console.log });
try {
  const { page } = app;
  page.setDefaultTimeout(1_200_000);
  for (const id of ids) {
    const plan = plans.find((s) => s.id === id);
    const docPath = resolve(OUT, `${id}.song.json`);
    if (!existsSync(docPath)) {
      check(results.checks, `${id}.doc`, false, { message: "validate を先に実行", path: docPath });
      continue;
    }
    const doc = JSON.parse(readFileSync(docPath, "utf8"));
    const duration = doc.bars * (doc.beatsPerBar || 4) * 60 / doc.bpm;
    console.log(`--- ${id} ${doc.title} ${duration.toFixed(1)}s ---`);
    await page.evaluate((doc) => window.app.loadDoc(doc), doc);
    const name = id;
    const timeoutMs = Math.max(600_000, Math.ceil(duration * 1000 + 300_000));
    const stats = await Promise.race([
      page.evaluate((name) => window.app.exportAudio({ name, toServer: true, stems: true }), name),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`export timeout ${timeoutMs}ms`)), timeoutMs)),
    ]);
    const mp3 = resolve(ROOT, "out", `${name}.mp3`);
    const voxPath = resolve(ROOT, "out", `${name}.vox.wav`);
    const accPath = resolve(ROOT, "out", `${name}.acc.wav`);
    check(results.checks, `${id}.files`, existsSync(mp3) && existsSync(voxPath) && existsSync(accPath), { mp3, voxPath, accPath, saved: stats?.saved });
    if (!existsSync(mp3)) continue;
    const [L, R] = decodeMp3(mp3);
    const [vox] = readWav(voxPath);
    const [acc] = readWav(accPath);
    const mixL = levels(L), mixR = levels(R), vocal = levels(vox, 0, duration), accAll = levels(acc, 0, duration);
    check(results.checks, `${id}.clip`, mixL.clipped + mixR.clipped === 0, { mixL, mixR });
    check(results.checks, `${id}.mix-level`, mixL.rmsDb > -40 && mixL.peakDb < 0, { mixL, mixR });
    check(results.checks, `${id}.stems`, vocal.rmsDb > -40 && accAll.rmsDb > -40, { vocal, acc: accAll });

    const perSection = (plan?.bar_map ?? []).map((x) => {
      const [a, b] = x.bars.split("-").map(Number);
      const start = secOfBar(a, doc);
      const end = secOfBar(b + 1, doc);
      const silent = ["intro", "interlude", "outro"].includes(x.section);
      return {
        section: x.section, start: +start.toFixed(2), end: +end.toFixed(2), silent,
        vocal: levels(vox, start, end), acc: levels(acc, start, end), mix: levels(L, start, end),
      };
    });
    const sungOk = perSection.filter((s) => !s.silent).every((s) => s.vocal.rmsDb > -45 && s.acc.rmsDb > -45);
    const accOk = perSection.every((s) => s.acc.rmsDb > -50);
    check(results.checks, `${id}.sections`, sungOk && accOk, { perSection });

    // 歌がある区間の内部で 8 秒以上の無音を許さない（フレーズ切れ検出）。前後の無音はイントロ/アウトロ想定。
    const sungSpans = perSection.filter((s) => !s.silent);
    const gapFlags = [];
    for (const s of sungSpans) {
      const from = Math.floor(s.start * SR), to = Math.min(vox.length, Math.ceil(s.end * SR));
      const runs = silenceRuns(vox.subarray(from, to), 0.008, 8).map((r) => ({ ...r, start: r.start + s.start, end: r.end + s.start, section: s.section }));
      gapFlags.push(...runs);
    }
    check(results.checks, `${id}.vocal-gaps`, gapFlags.length === 0, { gapFlags });
    check(results.checks, `${id}.soundfont`, stats?.soundfont?.mode === "soundfont", { soundfont: stats?.soundfont });
    check(results.checks, `${id}.playback`, stats?.playback?.maxRms > 0.001 && stats?.playback?.elapsedSeconds >= duration - 0.2, { playback: stats?.playback, duration });

    const dest = resolve(FINAL, `${id}.mp3`);
    copyFileSync(mp3, dest);
    copyFileSync(voxPath, resolve(FINAL, `${id}.vox.wav`));
    copyFileSync(accPath, resolve(FINAL, `${id}.acc.wav`));
    results.songs.push({ id, title: doc.title, duration, mp3: dest, metrics: { mixL, mixR, vocal, acc: accAll, perSection }, browser: { soundfont: stats?.soundfont, playback: stats?.playback, seconds: stats?.seconds } });
    console.log("saved", dest);
  }
} catch (e) {
  check(results.checks, "e2e.exception", false, { message: e instanceof Error ? e.message : String(e) });
} finally {
  await app.close();
  writeFileSync(resolve(OUT, "e2e-fullchorus.json"), JSON.stringify(results, null, 2) + "\n");
}
const ok = Object.values(results.checks).length && Object.values(results.checks).every((c) => c.ok);
process.exit(ok ? 0 : 1);
