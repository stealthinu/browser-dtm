/**
 * A1: 見本返答を貼り戻し相当で SongDoc を読み、再生経路まで到達する。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { launchChrome, waitReady } from "./chrome.js";
import { startDevServer, stopProc } from "./dev-server.js";

async function main(): Promise<void> {
  await fs.mkdir("out", { recursive: true });
  await fs.mkdir("docs/evidence", { recursive: true });
  const { proc, base } = await startDevServer(5300);
  const browser = await launchChrome();
  try {
    const page = await browser.newPage();
    await waitReady(page, base);
    const sample = await fs.readFile("fixtures/llm-response-sample.txt", "utf8");
    await page.evaluate(async (text) => {
      const api = (window as unknown as {
        __browserDtm: {
          loadPaste: () => Promise<void>;
        };
      }).__browserDtm;
      (document.getElementById("paste") as HTMLTextAreaElement).value = text;
      await api.loadPaste();
    }, sample);
    const song = await page.evaluate(() => {
      return (window as unknown as { __browserDtm: { getSong: () => unknown } }).__browserDtm.getSong();
    });
    if (!song || typeof song !== "object") throw new Error("SongDoc が読み込めない");
    const tracks = (song as { tracks: Array<{ kind: string }> }).tracks;
    const inst = tracks.filter((t) => t.kind === "inst").length;
    const vocal = tracks.filter((t) => t.kind === "vocal").length;
    if (vocal < 1 || inst < 2) throw new Error(`パート不足 vocal=${vocal} inst=${inst}`);

    // 再生開始（合成に時間がかかる）
    await page.evaluate(async () => {
      await (window as unknown as { __browserDtm: { play: () => Promise<void> } }).__browserDtm.play();
    });
    await new Promise((r) => setTimeout(r, 3000));
    await page.screenshot({ path: "docs/evidence/a1-pianoroll.png", fullPage: true });
    const status = await page.evaluate(
      () => (window as unknown as { __browserDtm: { getStatus: () => string } }).__browserDtm.getStatus(),
    );
    const report = { ok: true, inst, vocal, status };
    await fs.writeFile("out/a1.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    stopProc(proc);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
