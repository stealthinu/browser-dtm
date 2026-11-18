// 受入テスト A1〜A4（SPEC §3）: headless Chrome でアプリを開き、見本返答を貼り戻して鳴らし、録った音を MP3 に書き出して測る。
//   node scripts/e2e.mjs        A1/A2/A3（out/song.mp3 と stem、docs/evidence/pianoroll.png、out/e2e.json）
//   node scripts/e2e.mjs --fx   A4（エフェクト4種 × 強度 0/1、out/fx-*.mp3、out/e2e-fx.json）
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { corr, decodeMp3, diffDb, lagMs, levels, onsetMs, readWav, SR } from "./analyze.mjs";
import { openApp } from "./browser.mjs";
import { ROOT, finalDir } from "./paths.mjs";
const final = finalDir();
import { build } from "esbuild";
import { spectralMetrics } from "./vocaloid-metrics.mjs";

const FX = process.argv.includes("--fx");
const out = (f) => resolve(ROOT, "out", f);
mkdirSync(resolve(ROOT, "out"), { recursive: true });
const sample = readFileSync(resolve(ROOT, "fixtures/sample-response.txt"), "utf8");
const t0 = Date.now();
const { page, close } = await openApp({ port: Number(process.env.PORT ?? 5500), log: () => {} });
const results = { checks: {} };
const check = (k, ok, detail) => {
  results.checks[k] = { ok, ...detail };
  console.log(`${ok ? "PASS" : "FAIL"} ${k} ${JSON.stringify(detail)}`);
};

try {
  // 画面の操作どおり: 見本返答を貼り戻し欄へ入れ、「読み込む」を押す
  await page.click("#sample");
  await page.waitForFunction(() => document.getElementById("answer").value.length > 100);
  await page.click("#load");
  await page.waitForFunction(() => !document.getElementById("load").disabled && window.app.isPlaying(), { timeout: 120000 });
  const problems = await page.$eval("#problems", (e) => e.textContent);
  const doc = await page.evaluate(() => window.app.getDoc());
  check("A1.import", problems === "問題なし" && !!doc, { problems, tracks: doc?.tracks.map((t) => `${t.id}:${t.kind}`) });
  const bars = doc.bars, spb = (60 / doc.bpm) * doc.beatsPerBar;

  if (!FX) {
    const s = await page.evaluate(() => window.app.exportAudio({ format: "mp3", name: "song", toServer: true, stems: true }));
    await page.screenshot({ path: resolve(ROOT, "docs/evidence/pianoroll.png") });
    results.browser = s;
    check("A2.actual-playback", s.playback?.maxRms > 0.001 && s.playback.elapsedSeconds >= s.seconds - 0.05 && s.playback.observations > 0, {playback:s.playback});
    const [L, R] = decodeMp3(out("song.mp3"));
    const [acc] = readWav(out("song.acc.wav"));
    const [vox] = readWav(out("song.vox.wav"));
    const [ref] = readWav(out("song.vox-ref.wav"));
    const [mL] = readWav(out("song.mix.wav"));
    const mp3 = { seconds: +(L.length / SR).toFixed(3), L: levels(L), R: levels(R), mp3VsWavLagMs: lagMs(mL, L, 80) };
    // 小節ごとの RMS（歌の区間・伴奏の区間がそれぞれ鳴っているか）
    const perBar = [];
    for (let b = 0; b < bars + 1; b++) {
      perBar.push({ bar: b + 1, mix: levels(mL, b * spb, (b + 1) * spb).rmsDb, acc: levels(acc, b * spb, (b + 1) * spb).rmsDb,
                    vox: levels(vox, b * spb, (b + 1) * spb).rmsDb });
    }
    // 歌の区間: 最初の音符〜最後の音符の終わり。伴奏の区間: 0〜bars 小節
    const v = doc.tracks.find((t) => t.kind === "vocal");
    const lastNote = v.notes[v.notes.length - 1];
    const vocalEnd = ((lastNote.bar - 1) * doc.beatsPerBar + (lastNote.beat - 1)) * (60 / doc.bpm) + 1.5 * (60 / doc.bpm) * 2;
    const sections = {
      vocalSection: { from: 0, to: +vocalEnd.toFixed(2), vox: levels(vox, 0, vocalEnd), acc: levels(acc, 0, vocalEnd) },
      accSection: { from: 0, to: +(bars * spb).toFixed(2), acc: levels(acc, 0, bars * spb) },
      afterSong: { from: +(bars * spb + 1).toFixed(2), vox: levels(vox, bars * spb + 1), acc: levels(acc, bars * spb + 1) },
    };
    // 頭のずれ: 伴奏の最初の音（1小節目の頭）の立ち上がり、歌の置き場所（録った歌と合成したままの歌の相互相関）
    const accOnset = onsetMs(acc, 0.01);
    const voxLag = lagMs(ref, vox, 60);
    const voxOnsetRec = onsetMs(vox, 0.01), voxOnsetRef = onsetMs(ref, 0.01);
    const head = { accOnsetMs: accOnset, vocalPlacementLagMs: voxLag, vocalOnsetRecordedMs: voxOnsetRec, vocalOnsetRenderedMs: voxOnsetRef,
                   scheduledDiffMs: +((s.scheduled.vocalSongZero - s.scheduled.accStart) * 1000).toFixed(3),
                   headOffsetMs: +Math.abs(voxLag - accOnset).toFixed(3) };
    // 録音の傷（参照: 合成したままの歌と、録った歌の 256 サンプル区間ごとの食い違い）。合否には使わない計測値
    let glitchBlocks = 0;
    for (let i = 0; i + 256 <= Math.min(ref.length, vox.length); i += 256) {
      let d = 0;
      for (let k = i; k < i + 256; k++) d = Math.max(d, Math.abs(vox[k] - ref[k]));
      if (d > 0.02) glitchBlocks++;
    }
    head.recorderGlitchBlocks256 = glitchBlocks;
    Object.assign(results, { mp3, perBar, sections, head });
    console.log(JSON.stringify({ mp3, sections, head }, null, 1));
    console.table(perBar);
    check("A2.mp3-not-silent", mp3.L.rmsDb > -40 && mp3.L.peakDb > -20, { rmsDb: mp3.L.rmsDb, peakDb: mp3.L.peakDb });
    check("A2.mp3-not-clipping", mp3.L.clipped + mp3.R.clipped === 0 && mp3.L.rmsDb < -6, { clipped: mp3.L.clipped + mp3.R.clipped });
    check("A2.vocal-section", sections.vocalSection.vox.rmsDb > -40, { voxRmsDb: sections.vocalSection.vox.rmsDb });
    check("A2.acc-section", sections.accSection.acc.rmsDb > -40, { accRmsDb: sections.accSection.acc.rmsDb });
    check("A2.each-bar", perBar.slice(0, bars).every((p) => p.acc > -45 && p.mix > -40), { bars });
    check("A3.head-offset<30ms", head.headOffsetMs < 30, head);
  } else {
    const fxRes = {};
    const types = ["kero", "vocoder", "bitcrusher", "doubling"];
    let base = null;
    for (const type of types) {
      for (const amount of [0, 1]) {
        if (amount === 0 && base) { fxRes[`${type}@0`] = fxRes[`${types[0]}@0`]; continue; } // 強度 0 は全部同じ（エフェクト無し）
        await page.evaluate((fx) => window.app.setEffects(fx), [{ type, amount }]);
        const name = `fx-${type}-${amount}`;
        const s = await page.evaluate((n) => window.app.exportAudio({ format: "mp3", name: n, toServer: true, stems: true }), name);
        check(`A4.${type}.${amount}.playback`,s.playback?.maxRms>0.001 && s.playback.elapsedSeconds>=s.seconds-0.05,{playback:s.playback});
        fxRes[`${type}@${amount}`] = { name, vox: s.vox, mixL: s.mixL, mixR: s.mixR };
        if (amount === 0) base = name;
      }
    }
    // 強度 0 と 1 の差: 歌の stem（録ったもの）の相関と差分の大きさ、MP3 の L/R の差（ダブリングはステレオになる）
    const [b0] = readWav(out(`${base}.vox.wav`));
    const [m0L] = decodeMp3(out(`${base}.mp3`));
    // 対照: エフェクト無しをもう一度書き出し、同じ設定なら歌の stem がほぼ同じになる（差はエフェクトのせい）ことを確かめる
    await page.evaluate(() => window.app.setEffects([]));
    await page.evaluate(() => window.app.exportAudio({ format: "mp3", name: "fx-none-repeat", toServer: true, stems: true }));
    const [rep] = readWav(out("fx-none-repeat.vox.wav"));
    const [baseMix] = readWav(out(`${base}.mix.wav`));
    const [repeatMix] = readWav(out("fx-none-repeat.mix.wav"));
    const [repeatMp3] = decodeMp3(out("fx-none-repeat.mp3"));
    const ctl = { corrVox: corr(b0, rep), corrMix: corr(baseMix, repeatMix), corrMp3: corr(m0L, repeatMp3), identicalMp3: readFileSync(out(`${base}.mp3`)).equals(readFileSync(out("fx-none-repeat.mp3"))), diffVoxDb: +diffDb(b0, rep).toFixed(2) };
    fxRes.control = ctl;
    check("A4.control(no-fx twice)", ctl.corrVox > 0.999 && ctl.corrMix > 0.999 && ctl.corrMp3 > 0.999, ctl);
    for (const type of types) {
      const n = `fx-${type}-1`;
      const [v1] = readWav(out(`${n}.vox.wav`));
      const [m1L, m1R] = decodeMp3(out(`${n}.mp3`));
      const r = { corrVox: corr(b0, v1), diffVoxDb: +diffDb(b0, v1).toFixed(2), corrMp3L: corr(m0L, m1L),
                  lrDiffDb: +diffDb(m1L, m1R).toFixed(2), vox0: fxRes[`${type}@0`].vox, vox1: fxRes[`${type}@1`].vox };
      fxRes[`${type}@1`].vs0 = r;
      check(`A4.${type}`, r.corrVox < 0.98 && r.diffVoxDb > -30, r);
    }
    results.fx = fxRes;
    await build({entryPoints:[resolve(ROOT,"src/core/vocaloid.ts")],bundle:true,platform:"node",format:"esm",outfile:out("vocaloid-node.mjs")});
    const { voicedConfidence } = await import(out("vocaloid-node.mjs"));
    const { applyVocaloid } = await import("../src/core/vocaloid-v2.js");
    const confidence = voicedConfidence(b0, SR);
    const dryMetrics = spectralMetrics(b0,b0,confidence);
    const originalV2 = spectralMetrics(b0,applyVocaloid(b0,SR,1),confidence);
    const vocaloid = { dry: dryMetrics, originalV2, amounts: {} };
    mkdirSync(finalDir(),{recursive:true});
    for(const amount of [0,0.5,1]) {
      await page.evaluate(fx=>window.app.setEffects(fx),[{type:"vocaloid",amount}]);
      const name=`vocaloid-${amount}`;
      const s=await page.evaluate(n=>window.app.exportAudio({format:"mp3",name:n,toServer:true,stems:true}),name);
      check(`vocaloid.${amount}.playback`,s.playback?.maxRms>0.001 && s.playback.elapsedSeconds>=s.seconds-0.05,{playback:s.playback});
      const [v]=readWav(out(`${name}.vox.wav`)),[l,r]=decodeMp3(out(`${name}.mp3`));
      const metrics=spectralMetrics(b0,v,confidence);
      const mp3={L:levels(l),R:levels(r)};
      vocaloid.amounts[amount]={...metrics,mp3,browser:s};
      check(`vocaloid.${amount}.loudness`,Math.abs(metrics.voicedRmsDeltaDb)<=1,metrics);
      check(`vocaloid.${amount}.consonants`,metrics.unvoicedFrames>0&&metrics.consonantBandDeltaDb>=-6,metrics);
      check(`vocaloid.${amount}.audio`,mp3.L.clipped+mp3.R.clipped===0&&s.vox.rmsDb>-40&&s.acc.rmsDb>-40,{mp3,vox:s.vox,acc:s.acc});
      if(amount===0) check("vocaloid.zero-identical",corr(b0,v)===1&&diffDb(b0,v)<-100,{corr:corr(b0,v),diffDb:diffDb(b0,v)});
      if(amount===1) {
        const lift=metrics.centroidHz-dryMetrics.centroidHz,originalLift=originalV2.centroidHz-dryMetrics.centroidHz;
        check("vocaloid.timbre",lift>0&&lift>=originalLift*0.7,{liftHz:lift,originalLiftHz:originalLift,retained:lift/originalLift});
      }
      copyFileSync(out(`${name}.mp3`),`${final}/${name}.mp3`);
    }
    results.vocaloid=vocaloid;
  }
} finally {
  results.elapsedSec = (Date.now() - t0) / 1000;
  writeFileSync(out(FX ? "e2e-fx.json" : "e2e.json"), JSON.stringify(results, null, 1));
  await close();
}
const fails = Object.entries(results.checks).filter(([, v]) => !v.ok).map(([k]) => k);
console.log(fails.length ? `FAILED: ${fails.join(", ")}` : `ALL PASS (${results.elapsedSec}s)`);
process.exit(fails.length ? 1 : 0);
