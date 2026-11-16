// 歌トラックのエフェクト（SPEC §2-4）。合成済みの歌の波形（モノラル 44.1 kHz）に掛ける、DOM に依存しない処理。
// 再生と書き出しで同じ波形を使うので、聞こえる音と書き出す音が同じになる。
// ケロケロボイス（kero）は波形ではなく F0 で掛ける（src/web/vocal.ts の flattenF0。合成し直す）。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.

import { applyVocaloidMatched } from "./vocaloid";

export interface CarrierNote {
  startSec: number;
  endSec: number;
  midi: number;
}

/** 2 次の帯域通過（RBJ）。 */
function bandpass(x: Float32Array, sr: number, f0: number, q: number): Float32Array {
  const w = (2 * Math.PI * f0) / sr;
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - al) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

function envelope(x: Float32Array, sr: number, ms: number): Float32Array {
  const a = Math.exp(-1 / ((ms / 1000) * sr));
  const y = new Float32Array(x.length);
  let e = 0;
  for (let i = 0; i < x.length; i++) {
    e = a * e + (1 - a) * Math.abs(x[i]);
    y[i] = e;
  }
  return y;
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/**
 * ボコーダー: 歌（モジュレータ）の帯域ごとの包絡を、音符の音高で鳴らすノコギリ波（＋1 オクターブ下、子音用に少しの雑音）
 * （キャリア）へ掛ける。20 帯域、120 Hz〜7 kHz。amount で原音と混ぜる。
 * offset: 波形のサンプル 0 が曲の何秒か（曲の頭より前の余白ぶん、負）。
 */
export function vocoder(x: Float32Array, sr: number, notes: CarrierNote[], amount: number, offsetSec = 0): Float32Array {
  if (amount <= 0) return x;
  const n = x.length;
  const carrier = new Float32Array(n);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (const note of notes) {
    const a = Math.max(0, Math.floor((note.startSec - offsetSec - 0.08) * sr));
    const b = Math.min(n, Math.ceil((note.endSec - offsetSec + 0.05) * sr));
    const f = 440 * 2 ** ((note.midi - 69) / 12);
    let ph1 = 0, ph2 = 0;
    for (let i = a; i < b; i++) {
      ph1 = (ph1 + f / sr) % 1;
      ph2 = (ph2 + f / 2 / sr) % 1;
      carrier[i] = 0.6 * (2 * ph1 - 1) + 0.4 * (2 * ph2 - 1);
    }
  }
  for (let i = 0; i < n; i++) carrier[i] += 0.08 * rnd();
  const bands = 20;
  const wet = new Float32Array(n);
  for (let k = 0; k < bands; k++) {
    const fc = 120 * (7000 / 120) ** (k / (bands - 1));
    const env = envelope(bandpass(x, sr, fc, 5), sr, 8);
    const cb = bandpass(carrier, sr, fc, 5);
    for (let i = 0; i < n; i++) wet[i] += cb[i] * env[i];
  }
  const g = rms(x) / Math.max(1e-9, rms(wet));
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = (1 - amount) * x[i] + amount * g * wet[i];
  return y;
}

/** ビットクラッシャー: 量子化のビット数（16 → 3）とサンプルの間引き（1 → 10）を amount で強める。 */
export function bitcrusher(x: Float32Array, amount: number): Float32Array {
  if (amount <= 0) return x;
  const bits = 16 - 13 * amount;
  const q = 2 ** (bits - 1);
  const hold = 1 + Math.round(9 * amount);
  const y = new Float32Array(x.length);
  let v = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % hold === 0) v = Math.round(x[i] * q) / q;
    y[i] = v;
  }
  return y;
}

/** ダブリング: 少し遅らせて揺らした写しを 2 本作り、左右に振って重ねる（ステレオになる）。 */
export function doubling(x: Float32Array, sr: number, amount: number): [Float32Array, Float32Array] {
  if (amount <= 0) return [x, x];
  const n = x.length;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const tap = (i: number, ms: number, depthMs: number, rate: number, phase: number) => {
    const d = ((ms + depthMs * Math.sin(2 * Math.PI * rate * (i / sr) + phase)) / 1000) * sr;
    const p = i - d;
    const i0 = Math.floor(p);
    if (i0 < 0 || i0 + 1 >= n) return 0;
    const fr = p - i0;
    return x[i0] * (1 - fr) + x[i0 + 1] * fr;
  };
  const dry = 1 - 0.3 * amount;
  const w = 0.8 * amount;
  for (let i = 0; i < n; i++) {
    const a = tap(i, 22, 4, 0.7, 0);
    const b = tap(i, 31, 5, 0.53, 1.7);
    L[i] = dry * x[i] + w * a + 0.25 * w * b;
    R[i] = dry * x[i] + w * b + 0.25 * w * a;
  }
  return [L, R];
}

/** kero 以外の 3 つを決まった順（ボコーダー → ビットクラッシャー → ダブリング）で掛け、ステレオにする。 */
export function applyWaveEffects(x: Float32Array, sr: number, fx: { vocoder: number; bitcrusher: number; doubling: number; vocaloid?: number },
                                 notes: CarrierNote[], offsetSec: number): [Float32Array, Float32Array] {
  let y = vocoder(x, sr, notes, fx.vocoder, offsetSec);
  y = bitcrusher(y, fx.bitcrusher);
  y = applyVocaloidMatched(y, sr, fx.vocaloid ?? 0);
  return doubling(y, sr, fx.doubling);
}
