#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { applyVocaloid } from '../effects/vocaloid/dsp.js';

export function decodeFile(input) {
  const info = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'json', input], { encoding: 'utf8' });
  if (info.status !== 0) throw new Error(info.stderr || 'ffprobe failed');
  const stream = JSON.parse(info.stdout).streams[0];
  if (!stream) throw new Error('No audio stream');
  const sampleRate = Number(stream.sample_rate), channels = Number(stream.channels);
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', input, '-map', '0:a:0', '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], { maxBuffer: 512 * 1024 * 1024 });
  if (decoded.status !== 0) throw new Error(decoded.stderr?.toString() || 'ffmpeg decode failed');
  const bytes = decoded.stdout;
  const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { samples, sampleRate, channels };
}

export function processFile(input, output, amount, pcmOutput) {
  const { samples, sampleRate, channels } = decodeFile(input);
  const result = new Float32Array(samples.length);
  for (let c = 0; c < channels; c++) {
    const channel = Float32Array.from({ length: samples.length / channels }, (_, i) => samples[i * channels + c]);
    const processed = applyVocaloid(channel, sampleRate, amount);
    for (let i = 0; i < processed.length; i++) result[i * channels + c] = processed[i];
  }
  const pcm = Buffer.from(result.buffer);
  const encoded = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(sampleRate), '-ac', String(channels), '-i', '-', '-codec:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', output], { input: pcm, maxBuffer: 16 * 1024 * 1024 });
  if (encoded.status !== 0) throw new Error(encoded.stderr?.toString() || 'ffmpeg encode failed');
  if (pcmOutput) writeFileSync(pcmOutput, pcm);
  return { input, output, amount: Math.max(0, Math.min(1, amount)), sampleRate, channels, frames: result.length / channels };
}

function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') { console.log('node cli/vocaloid-filter.js --input in.wav|mp3 [--output out.mp3] [--amount 0.5]'); return; }
    if (!['--input', '--output', '--amount', '--pcm-output'].includes(args[i]) || !args[i + 1]) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    options[args[i].slice(2)] = args[++i];
  }
  if (!options.input) throw new Error('--input is required');
  const amount = Number(options.amount ?? 0.5);
  if (!Number.isFinite(amount)) throw new Error('--amount must be finite');
  const output = options.output ?? 'vocaloid.mp3';
  if (!output.toLowerCase().endsWith('.mp3')) throw new Error('--output must end in .mp3');
  if (output === options.input) throw new Error('Input and output must differ');
  console.log(JSON.stringify(processFile(options.input, output, amount, options['pcm-output'])));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
