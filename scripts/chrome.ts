import fs from "node:fs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const candidates = [
  process.env.CHROME_PATH,
  "/usr/local/bin/google-chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean) as string[];

const CHROME = candidates.find((p) => fs.existsSync(p)) || "google-chrome";

export async function launchChrome(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
      "--disable-dev-shm-usage",
    ],
  });
}

export async function waitReady(page: Page, base = "http://127.0.0.1:5300/"): Promise<void> {
  await page.goto(base, { waitUntil: "networkidle2", timeout: 120_000 });
  await page.waitForFunction(() => !!(window as unknown as { __browserDtm?: unknown }).__browserDtm, {
    timeout: 60_000,
  });
}

export { CHROME };
