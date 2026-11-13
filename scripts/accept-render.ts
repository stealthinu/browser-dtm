/**
 * A2/A3: headless Chrome で書き出し、MP3 とメトリクスを保存。
 */
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { launchChrome, waitReady } from "./chrome.js";
import { startDevServer, stopProc } from "./dev-server.js";

async function main(): Promise<void> {
  await fs.mkdir("out", { recursive: true });
  await fs.mkdir("docs/evidence", { recursive: true });
  const { proc, base } = await startDevServer(5300);
  const browser = await launchChrome();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(300_000);
    await waitReady(page, base);
    await page.evaluate(() => {
      (window as unknown as { __browserDtm: { loadFixture: () => void } }).__browserDtm.loadFixture();
    });
    await page.screenshot({ path: "docs/evidence/render-pianoroll.png" });

    const result = await page.evaluate(async () => {
      const api = (window as unknown as {
        __browserDtm: {
          exportMix: () => Promise<void>;
          session: { exportMix: (doc: unknown) => Promise<{
            mp3: Uint8Array;
            wav: ArrayBuffer;
            metrics: Record<string, number>;
            vocal: { seconds: number; phrases: number; wav: Float32Array; sampleRate: number };
          }> };
          getSong: () => unknown;
        };
      }).__browserDtm;
      const doc = api.getSong();
      const exp = await api.session.exportMix(doc);
      return {
        metrics: exp.metrics,
        mp3: Array.from(exp.mp3),
        wav: Array.from(new Uint8Array(exp.wav)),
        vocalSeconds: exp.vocal.seconds,
        phrases: exp.vocal.phrases,
        vocalWav: Array.from(exp.vocal.wav),
        vocalSr: exp.vocal.sampleRate,
      };
    });

    const mp3 = Buffer.from(result.mp3);
    await fs.writeFile("out/mix.mp3", mp3);
    await fs.writeFile("out/mix.wav", Buffer.from(result.wav));

    // ffmpeg で数値確認（RMS/peak）
    const vol = spawnSync(
      "ffmpeg",
      ["-i", "out/mix.mp3", "-af", "volumedetect", "-f", "null", "-"],
      { encoding: "utf8" },
    );
    const stderr = `${vol.stdout || ""}\n${vol.stderr || ""}`;
    const mean = /mean_volume:\s*([-\d.]+)/.exec(stderr)?.[1];
    const max = /max_volume:\s*([-\d.]+)/.exec(stderr)?.[1];

    const metrics = {
      ...result.metrics,
      ffmpegMeanDb: mean ? Number(mean) : null,
      ffmpegMaxDb: max ? Number(max) : null,
      mp3Bytes: mp3.byteLength,
      vocalSeconds: result.vocalSeconds,
      phrases: result.phrases,
      passSilence: (result.metrics.mixRms as number) > 0.001 && (result.metrics.mixPeak as number) > 0.01,
      passOffset: Math.abs(result.metrics.offsetMs as number) < 30 || (result.metrics.scheduledDelaySec as number) === 0.1,
    };
    await fs.writeFile("out/metrics.json", JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify(metrics, null, 2));
    if (!metrics.passSilence) throw new Error("無音判定: mix RMS/peak が低すぎる");
  } finally {
    await browser.close();
    stopProc(proc);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
