// headless Chrome でアプリを開く共通部品（e2e と MCP サーバーの書き出しで使う）。
import puppeteer from "puppeteer-core";
import { startServer } from "../server/serve.mjs";

export const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

export async function openApp({ port = 5500, log = console.error } = {}) {
  const srv = await startServer(port);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // GPU は使わない（SPEC §4）。音は実際の AudioContext で鳴らす（出力先は headless の仮の音声装置）
    args: ["--autoplay-policy=no-user-gesture-required", "--disable-gpu", "--no-sandbox", "--mute-audio=false"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 900 });
  page.on("console", (m) => log(`[page] ${m.text()}`));
  page.on("pageerror", (e) => log(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.app, { timeout: 30000 });
  await page.evaluate(() => window.app.ready);
  const close = async () => {
    await browser.close();
    await new Promise((ok) => srv.close(ok));
  };
  return { page, browser, srv, close };
}
