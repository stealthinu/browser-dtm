import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { processFile } from '../cli/vocaloid-filter.js';
const input = process.env.VOCALOID_SAMPLE ?? '/workspace/vocaloid-filter-demo/source/vocatab-codex-vocal.wav';
const destination = process.env.VOCALOID_DEMO_DIR ?? '/workspace/vocaloid-filter-demo';
mkdirSync('out', { recursive: true }); mkdirSync(destination, { recursive: true });
const results = [];
for (const amount of [0, 0.5, 1]) {
  const output = `${destination}/vocaloid-${amount}.mp3`;
  const result = spawnSync(process.execPath, ['cli/vocaloid-filter.js', '--input', input, '--output', output, '--amount', String(amount), '--pcm-output', `out/cli-${amount}.f32`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  console.log(result.stdout.trim()); results.push(JSON.parse(result.stdout));
}
// The public CLI also accepts MP3 input.
const mp3Input = `${destination}/vocaloid-0.mp3`;
const smoke = processFile(mp3Input, 'out/mp3-input-smoke.mp3', 0.5);
if (smoke.frames <= 0) throw new Error('MP3 input decode returned no samples');
writeFileSync('out/cli-results.json', JSON.stringify({ results, mp3InputSmoke: smoke }, null, 2));
