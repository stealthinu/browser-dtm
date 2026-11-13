import { launchChrome, waitReady } from "./chrome.js";

async function main(): Promise<void> {
  const b = await launchChrome();
  const p = await b.newPage();
  p.setDefaultTimeout(600_000);
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  p.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 400)));
  await waitReady(p, "http://127.0.0.1:5300/");
  const result = await p.evaluate(async () => {
    const api = (window as unknown as {
      __browserDtm: {
        getSong: () => unknown;
        session: {
          init: () => Promise<void>;
          vocalEngine: {
            init: (gpu?: boolean) => Promise<void>;
            render: (...args: unknown[]) => Promise<unknown>;
          } | null;
          renderVocal: (doc: unknown) => Promise<{
            seconds: number;
            phrases: number;
            wav: Float32Array;
            sampleRate: number;
            startSec: number;
          }>;
        };
      };
    }).__browserDtm;
    try {
      await api.session.init();
      const urls = await (async () => {
        // probe worker file
        const r = await fetch("/vocatab/ui/dist/engine-worker.js");
        return { workerStatus: r.status, len: (await r.text()).length };
      })();
      const v = await api.session.renderVocal(api.getSong());
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < v.wav.length; i++) {
        const a = Math.abs(v.wav[i]);
        peak = Math.max(peak, a);
        sum += v.wav[i] * v.wav[i];
      }
      return {
        ok: true,
        urls,
        seconds: v.seconds,
        phrases: v.phrases,
        startSec: v.startSec,
        peak,
        rms: Math.sqrt(sum / v.wav.length),
        samples: v.wav.length,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : "",
      };
    }
  });
  console.log(JSON.stringify(result, null, 2));
  await b.close();
  if (!(result as { ok?: boolean }).ok) process.exit(1);
}

main();
