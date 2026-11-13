import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVocaloid, shiftFormants } from '../effects/vocaloid/dsp.js';
const sr = 44100;
const tone = (hz, seconds = 0.25) => Float32Array.from({ length: Math.round(sr * seconds) }, (_, i) => 0.2 * Math.sin(2 * Math.PI * hz * i / sr));
const rms = data => Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);

test('amount=0 and negative amounts are exact bypass without modifying the input', () => {
  const input = tone(220), copy = input.slice();
  for (const a of [0, -0.5, -Infinity]) assert.strictEqual(applyVocaloid(input, sr, a), input);
  assert.deepEqual(input, copy);
});
test('amount clamps above one, deterministic output, unchanged source and length', () => {
  const input = tone(330), copy = input.slice(), expected = applyVocaloid(input, sr, 1);
  for (const a of [2, Infinity]) assert.deepEqual(applyVocaloid(input, sr, a), expected);
  assert.equal(expected.length, input.length); assert.deepEqual(input, copy);
  assert.ok(rms(expected) > 1e-3); assert.notDeepEqual(expected, input);
});
test('silence, empty and very short input remain finite at supported rates', () => {
  for (const rate of [8000, 22050, 44100, 48000, 96000, 192000]) {
    for (const length of [0, 1, 17, 1000]) {
      const out = applyVocaloid(new Float32Array(length), rate, 1);
      assert.equal(out.length, length); assert.ok(out.every(x => x === 0));
    }
  }
});
test('invalid types, NaN and invalid sample rates fail clearly', () => {
  assert.throws(() => applyVocaloid([], sr, 1), TypeError);
  assert.throws(() => applyVocaloid(new Float32Array([NaN]), sr, 1), TypeError);
  assert.throws(() => applyVocaloid(new Float32Array([Infinity]), sr, 0), TypeError);
  for (const rate of [0, 7999, NaN, Infinity, 192001]) assert.throws(() => applyVocaloid(tone(220), rate, 1), RangeError);
  for (const amount of [NaN, undefined, '0.5']) assert.throws(() => applyVocaloid(tone(220), sr, amount), TypeError);
});
test('small positive amount approaches bypass for ordinary normalized input', () => {
  const input = tone(220), out = applyVocaloid(input, sr, 1e-6);
  assert.ok(Math.max(...out.map((x, i) => Math.abs(x - input[i]))) < 1e-5);
});
test('harmonic source keeps F0 at amounts 0, 0.5, 1 (frequency measured independently)', () => {
  const f0 = 233.08;
  const input = Float32Array.from({ length: sr }, (_, i) => {
    let x = 0;
    for (let k = 1; k <= 20; k++) x += 0.08 / k * Math.sin(2 * Math.PI * f0 * k * i / sr);
    return x;
  });
  function measured(data) {
    let best = 0, hz = 0;
    for (let f = f0 - 2; f <= f0 + 2; f += 0.1) {
      let re = 0, im = 0;
      for (let i = sr / 4 | 0; i < sr * 3 / 4; i++) {
        re += data[i] * Math.cos(2 * Math.PI * f * i / sr);
        im += data[i] * Math.sin(2 * Math.PI * f * i / sr);
      }
      if (re * re + im * im > best) { best = re * re + im * im; hz = f; }
    }
    return hz;
  }
  for (const a of [0, 0.5, 1]) {
    const hz = measured(applyVocaloid(input, sr, a));
    assert.ok(Math.abs(1200 * Math.log2(hz / f0)) < 2, `amount=${a}, f0=${hz}`);
  }
});
test('envelope shift lifts a synthetic vowel resonance while keeping harmonic positions', () => {
  const f0 = 100, seconds = 0.5;
  const input = Float32Array.from({ length: sr * seconds }, (_, i) => {
    let x = 0;
    for (let k = 1; k <= 35; k++) {
      const envelope = Math.exp(-0.5 * ((k * f0 - 1300) / 280) ** 2);
      x += 0.03 * envelope * Math.sin(2 * Math.PI * k * f0 * i / sr);
    }
    return x;
  });
  function centroid(data) {
    let total = 0, weighted = 0;
    for (let k = 4; k <= 30; k++) {
      let re = 0, im = 0;
      for (let i = 4410; i < 17640; i++) {
        const phase = 2 * Math.PI * k * f0 * i / sr;
        re += data[i] * Math.cos(phase); im += data[i] * Math.sin(phase);
      }
      const power = re * re + im * im;
      total += power; weighted += k * f0 * power;
    }
    return weighted / total;
  }
  const before = centroid(input), after = centroid(shiftFormants(input, sr, 1.8));
  assert.ok(after > before + 40, `${before} -> ${after}`);
});
test('headroom safety, finite outputs and time alignment for an impulse', () => {
  const input = new Float32Array(8192); input[4096] = 4;
  const out = applyVocaloid(input, sr, 1);
  assert.equal(out.length, input.length); assert.ok(out.every(Number.isFinite));
  assert.ok(Math.max(...out.map(Math.abs)) <= 0.940001);
  const peak = out.reduce((best, x, i) => Math.abs(x) > Math.abs(out[best]) ? i : best, 0);
  assert.equal(peak, 4096);
});
