import puppeteer from 'puppeteer-core';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { createDemoServer } from '../tools/serve-vocaloid.js';
const sample = process.env.VOCALOID_SAMPLE ?? '/workspace/vocaloid-filter-demo/source/vocatab-codex-vocal.wav';
const port = 5447;
await mkdir('out', { recursive: true });
const server = createDemoServer();
await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
let browser;
try {
  browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1100, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('favicon.ico')) errors.push(msg.text()); });
  const session = await page.createCDPSession();
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve('out') });
  await page.goto(`http://127.0.0.1:${port}/demo/vocaloid/`, { waitUntil: 'networkidle0' });
  // A normalized path cannot expose files outside the demo's allowlist.
  assert.equal((await fetch(`http://127.0.0.1:${port}/.git/config`)).status, 404);
  const upload = await page.$('#file'); await upload.uploadFile(sample);
  await page.waitForFunction(() => window.vocaloidDemo?.input && !window.vocaloidDemo.busy, { timeout: 30000 });
  const results = [];
  for (const amount of [0, 0.5, 1]) {
    await page.$eval('#amount', (slider, value) => { slider.value = String(value); slider.dispatchEvent(new Event('input', { bubbles: true })); }, amount);
    await page.click('#process');
    await page.waitForFunction(() => window.vocaloidDemo.output && !window.vocaloidDemo.busy, { timeout: 60000 });
    const raw = await page.evaluate(() => {
      const demo = window.vocaloidDemo, data = demo.output.getChannelData(0), original = demo.input.getChannelData(0);
      let power = 0, peak = 0, difference = 0;
      for (let i = 0; i < data.length; i++) { power += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i])); difference = Math.max(difference, Math.abs(data[i] - original[i])); }
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { pcm: btoa(binary), rms: Math.sqrt(power / data.length), peak, maxBypassDifference: difference, length: data.length, sampleRate: demo.output.sampleRate };
    });
    await writeFile(`out/v2-browser-${amount}.f32`, Buffer.from(raw.pcm, 'base64')); delete raw.pcm;
    assert.ok(raw.rms > 1e-4); assert.ok(raw.peak < 1);
    if (amount === 0) assert.equal(raw.maxBypassDifference, 0);
    await page.click('#play');
    const playback = await page.evaluate(async () => {
      const { context, analyser } = window.vocaloidDemo, data = new Float32Array(analyser.fftSize);
      const start = context.currentTime; let maxRms = 0;
      for (let i = 0; i < 80 && context.currentTime - start < 2.2; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        analyser.getFloatTimeDomainData(data);
        maxRms = Math.max(maxRms, Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length));
      }
      return { state: context.state, elapsed: context.currentTime - start, maxRms };
    });
    assert.equal(playback.state, 'running'); assert.ok(playback.elapsed > 2, JSON.stringify(playback)); assert.ok(playback.maxRms > 1e-4);
    await page.click('#stop'); await page.click('#export');
    await page.waitForFunction(() => !window.vocaloidDemo.busy, { timeout: 60000 });
    const output = `out/browser-vocaloid-v2-${amount}.mp3`;
    let bytes = 0;
    for (let i = 0; i < 100; i++) { try { bytes = (await stat(output)).size; if (bytes > 1000) break; } catch {} await delay(100); }
    assert.ok(bytes > 1000, `missing MP3 download: ${output}`);
    results.push({ amount, ...raw, playback, mp3Bytes: bytes });
  }
  // Test the exported AudioBuffer / OfflineAudioContext adapter independently of the demo.
  const adapter = await page.evaluate(async () => {
    const { renderVocaloid } = await import('/effects/vocaloid/browser.js');
    const result = await renderVocaloid(window.vocaloidDemo.input, 1);
    const expected = window.vocaloidDemo.output;
    let difference = 0;
    for (let i = 0; i < result.length; i++) difference = Math.max(difference, Math.abs(result.getChannelData(0)[i] - expected.getChannelData(0)[i]));
    return { difference, length: result.length };
  });
  assert.equal(adapter.difference, 0);
  await page.screenshot({ path: 'out/v2-vocaloid-demo.png' });
  assert.deepEqual(errors, []);
  await writeFile('out/v2-browser-results.json', JSON.stringify({ results, adapter, errors }, null, 2));
  console.log(JSON.stringify({ results, adapter, errors }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
