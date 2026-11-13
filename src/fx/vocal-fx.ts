/** 歌トラック向けエフェクト4種（強度 0〜1）。書き出し・再生の両方で同じ処理を使う。 */

export interface FxParams {
  kerokero: number;
  vocoder: number;
  bitcrusher: number;
  doubling: number;
}

export function normalizeFx(partial?: Partial<FxParams> | null): FxParams {
  return {
    kerokero: clamp01(partial?.kerokero ?? 0),
    vocoder: clamp01(partial?.vocoder ?? 0),
    bitcrusher: clamp01(partial?.bitcrusher ?? 0),
    doubling: clamp01(partial?.doubling ?? 0),
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

function mix(a: Float32Array, b: Float32Array, wet: number): Float32Array {
  const out = new Float32Array(a.length);
  const w = clamp01(wet);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * (1 - w) + (b[i] ?? 0) * w;
  return out;
}

/** 簡易オートコレレで周期を推定し、固定周期に引き延ばしてピッチを平らにする（ケロケロ） */
export function applyKerokero(input: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount <= 0) return input;
  const minP = Math.floor(sampleRate / 400);
  const maxP = Math.floor(sampleRate / 80);
  const win = Math.min(input.length, Math.floor(sampleRate * 0.03));
  let bestP = Math.floor(sampleRate / 180);
  let bestC = -Infinity;
  // 冒頭の有声っぽい区間で周期推定
  const start = Math.min(Math.floor(sampleRate * 0.05), Math.max(0, input.length - maxP - win));
  for (let p = minP; p <= maxP; p++) {
    let c = 0;
    for (let i = 0; i < win; i++) c += input[start + i] * input[start + i + p];
    if (c > bestC) {
      bestC = c;
      bestP = p;
    }
  }
  const targetP = bestP;
  const out = new Float32Array(input.length);
  let src = 0;
  let dst = 0;
  while (dst + targetP < out.length && src + maxP < input.length) {
    // 局所周期
    let p = targetP;
    let bc = -Infinity;
    const s0 = Math.min(src, input.length - maxP - 1);
    for (let cand = minP; cand <= maxP; cand++) {
      let c = 0;
      const n = Math.min(win, input.length - s0 - cand);
      for (let i = 0; i < n; i++) c += input[s0 + i] * input[s0 + i + cand];
      if (c > bc) {
        bc = c;
        p = cand;
      }
    }
    for (let i = 0; i < targetP && dst + i < out.length; i++) {
      const t = (i / targetP) * p;
      const i0 = Math.floor(t);
      const f = t - i0;
      const a = input[Math.min(src + i0, input.length - 1)] ?? 0;
      const b = input[Math.min(src + i0 + 1, input.length - 1)] ?? 0;
      out[dst + i] = a * (1 - f) + b * f;
    }
    src += p;
    dst += targetP;
  }
  while (dst < out.length) {
    out[dst] = input[Math.min(src++, input.length - 1)] ?? 0;
    dst++;
  }
  return mix(input, out, amount);
}

/** キャリア（鋸波）とのバンドマルチプライア風ボコーダー */
export function applyVocoder(input: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount <= 0) return input;
  const bands = [200, 400, 800, 1600, 3200, 6400];
  const out = new Float32Array(input.length);
  const carrier = new Float32Array(input.length);
  const freq = 220;
  for (let i = 0; i < carrier.length; i++) {
    const phase = ((i * freq) / sampleRate) % 1;
    carrier[i] = 2 * (phase - 0.5);
  }
  for (const fc of bands) {
    const env = bandEnvelope(input, sampleRate, fc);
    const car = bandpass(carrier, sampleRate, fc);
    for (let i = 0; i < out.length; i++) out[i] += car[i] * env[i];
  }
  // 正規化
  let peak = 1e-9;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = 0.8 / peak;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  return mix(input, out, amount);
}

function bandpass(x: Float32Array, sr: number, fc: number): Float32Array {
  const out = new Float32Array(x.length);
  const r = Math.exp(-2 * Math.PI * (fc * 0.5) / sr);
  const cos = 2 * r * Math.cos((2 * Math.PI * fc) / sr);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = x[i] + cos * y1 - r * r * y2;
    out[i] = y - y2;
    y2 = y1;
    y1 = y;
  }
  return out;
}

function bandEnvelope(x: Float32Array, sr: number, fc: number): Float32Array {
  const bp = bandpass(x, sr, fc);
  const out = new Float32Array(x.length);
  const a = Math.exp(-1 / (sr * 0.01));
  let e = 0;
  for (let i = 0; i < bp.length; i++) {
    const v = Math.abs(bp[i]);
    e = a * e + (1 - a) * v;
    out[i] = e;
  }
  return out;
}

/** ビット深度とサンプルレートを落とす */
export function applyBitcrusher(input: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount <= 0) return input;
  const bits = Math.max(2, Math.round(16 - amount * 12));
  const step = 1 / (2 ** (bits - 1));
  const hold = Math.max(1, Math.round(1 + amount * (sampleRate / 2000)));
  const out = new Float32Array(input.length);
  let last = 0;
  for (let i = 0; i < input.length; i++) {
    if (i % hold === 0) {
      last = Math.round(input[i] / step) * step;
    }
    out[i] = last;
  }
  return mix(input, out, amount);
}

/** 短いディレイ＋微パン相当の加算でダブリング */
export function applyDoubling(input: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount <= 0) return input;
  const delay = Math.floor(sampleRate * (0.018 + 0.012 * amount));
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const d = i >= delay ? input[i - delay] * 0.85 : 0;
    out[i] = input[i] * 0.7 + d * 0.7;
  }
  return mix(input, out, amount);
}

export function applyVocalFx(input: Float32Array, sampleRate: number, fx: Partial<FxParams> | null | undefined): Float32Array {
  const p = normalizeFx(fx);
  let y = input;
  if (p.kerokero > 0) y = applyKerokero(y, sampleRate, p.kerokero);
  if (p.vocoder > 0) y = applyVocoder(y, sampleRate, p.vocoder);
  if (p.bitcrusher > 0) y = applyBitcrusher(y, sampleRate, p.bitcrusher);
  if (p.doubling > 0) y = applyDoubling(y, sampleRate, p.doubling);
  return y;
}

/** メトリクス用: RMS / peak / 有音開始 */
export function analyzeBuffer(ch: Float32Array, sampleRate: number, silenceThresh = 0.01): {
  rms: number;
  peak: number;
  onsetMs: number;
  durationMs: number;
} {
  let sum = 0;
  let peak = 0;
  let onset = -1;
  for (let i = 0; i < ch.length; i++) {
    const a = Math.abs(ch[i]);
    sum += ch[i] * ch[i];
    if (a > peak) peak = a;
    if (onset < 0 && a >= silenceThresh) onset = i;
  }
  return {
    rms: Math.sqrt(sum / Math.max(1, ch.length)),
    peak,
    onsetMs: onset < 0 ? -1 : (onset / sampleRate) * 1000,
    durationMs: (ch.length / sampleRate) * 1000,
  };
}
