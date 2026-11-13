/**
 * A4: エフェクト4種×強度0/1で歌を書き出し、数値差分を確認。
 */
import fs from "node:fs/promises";
import { launchChrome, waitReady } from "./chrome.js";
import { startDevServer, stopProc } from "./dev-server.js";
import { analyzeBuffer, applyVocalFx, type FxParams } from "../src/fx/vocal-fx.js";
import { encodeWavPCM16, monoToStereo } from "../src/audio/encode.js";

const FX_KEYS = ["kerokero", "vocoder", "bitcrusher", "doubling"] as const;

async function main(): Promise<void> {
  await fs.mkdir("out", { recursive: true });
  const { proc } = await startDevServer(5302);
  const browser = await launchChrome();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(300_000);
    await waitReady(page, "http://127.0.0.1:5302/");
    await page.evaluate(() => {
      (window as unknown as { __browserDtm: { loadFixture: () => void } }).__browserDtm.loadFixture();
    });

    const dry = await page.evaluate(async () => {
      const api = (window as unknown as {
        __browserDtm: {
          getSong: () => unknown;
          session: {
            renderVocal: (
              doc: unknown,
              fx: unknown,
            ) => Promise<{ wav: Float32Array; sampleRate: number; seconds: number }>;
          };
        };
      }).__browserDtm;
      const doc = api.getSong();
      const v = await api.session.renderVocal(doc, {
        kerokero: 0,
        vocoder: 0,
        bitcrusher: 0,
        doubling: 0,
      });
      return { wav: Array.from(v.wav), sampleRate: v.sampleRate, seconds: v.seconds };
    });

    const dryArr = new Float32Array(dry.wav);
    const dryM = analyzeBuffer(dryArr, dry.sampleRate);
    const rows: Record<string, unknown>[] = [];

    for (const key of FX_KEYS) {
      for (const amount of [0, 1] as const) {
        const fx: FxParams = { kerokero: 0, vocoder: 0, bitcrusher: 0, doubling: 0, [key]: amount };
        const wav = amount === 0 ? dryArr : applyVocalFx(dryArr, dry.sampleRate, fx);
        const m = analyzeBuffer(wav, dry.sampleRate);
        const [l, r] = monoToStereo(wav);
        await fs.writeFile(`out/fx-${key}-${amount}.wav`, Buffer.from(encodeWavPCM16([l, r], dry.sampleRate)));
        // SPEC: MP3 も。ffmpeg で変換
        const { spawnSync } = await import("node:child_process");
        spawnSync(
          "ffmpeg",
          ["-y", "-i", `out/fx-${key}-${amount}.wav`, "-codec:a", "libmp3lame", "-qscale:a", "4", `out/fx-${key}-${amount}.mp3`],
          { encoding: "utf8" },
        );
        const changed =
          amount === 0
            ? Math.abs(m.rms - dryM.rms) < 1e-9
            : Math.abs(m.rms - dryM.rms) > 1e-6 || Math.abs(m.peak - dryM.peak) > 1e-6;
        rows.push({
          effect: key,
          amount,
          rms: m.rms,
          peak: m.peak,
          onsetMs: m.onsetMs,
          rmsDelta: m.rms - dryM.rms,
          peakDelta: m.peak - dryM.peak,
          changed,
        });
      }
    }

    const pass = rows.every((r) => r.changed === true);
    const out = { dry: dryM, rows, pass };
    await fs.writeFile("out/fx-metrics.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    if (!pass) throw new Error("エフェクト差分が検出できない行がある");
  } finally {
    await browser.close().catch(() => undefined);
    stopProc(proc);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
