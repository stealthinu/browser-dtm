/** Pure-JS v2 mono effect: F0-guided harmonic mask, same-bin formant shift. */
export const VOCALOID_DEFAULTS = Object.freeze({
  formantSemitones: 4.5, noiseFloor: 0.008, highpassHz: 100,
  presenceHz: 4200, presenceDb: 8, airHz: 7000, airDb: 9,
  targetRms: 0.18, compressionExponent: 0.96, ceiling: 0.94,
});
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// In-place radix-2 FFT; inverse includes 1/N normalization.
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size *= 2) {
    const theta = (inverse ? 2 : -2) * Math.PI / size;
    const wr = Math.cos(theta), wi = Math.sin(theta);
    for (let start = 0; start < n; start += size) {
      let ur = 1, ui = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = start + j, b = a + size / 2;
        const tr = ur * re[b] - ui * im[b], ti = ur * im[b] + ui * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const next = ur * wr - ui * wi;
        ui = ur * wi + ui * wr; ur = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** YIN-like analysis only: estimated F0 guides a mask, never a pitch oscillator.
 * Anti-aliased decimation, fixed-length difference, first reliable minimum.
 */
function pitchFrames(input, sr, fftSize, hop) {
  const step = Math.max(1, Math.floor(sr / 11025)), rate = sr / step;
  const filtered = biquad(biquad(input, sr, 'lowpass', 1400), sr, 'lowpass', 1400);
  const data = Float64Array.from({ length: Math.ceil(input.length / step) }, (_, i) => filtered[i * step]);
  const lo = Math.max(2, Math.floor(rate / 1000)), hi = Math.ceil(rate / 65);
  const span = Math.round(rate * 0.045), frame = span + hi;
  const x = new Float64Array(frame), diff = new Float64Array(hi + 1), cmnd = new Float64Array(hi + 1);
  const tracks = [];
  for (let start = -fftSize + hop; start < input.length; start += hop) {
    const center = (start + fftSize / 2) / step;
    const begin = Math.round(center - frame / 2);
    let energy = 0;
    for (let i = 0; i < frame; i++) { x[i] = data[begin + i] ?? 0; energy += x[i] ** 2; }
    if (energy / frame < 1e-8) { tracks.push({ f0: 0, voiced: 0 }); continue; }
    let running = 0;
    cmnd[0] = 1;
    for (let lag = 1; lag <= hi; lag++) {
      let value = 0;
      for (let i = 0; i < span; i++) value += (x[i] - x[i + lag]) ** 2;
      diff[lag] = value; running += value;
      cmnd[lag] = value * lag / Math.max(running, 1e-20);
    }
    let best = lo;
    for (let lag = lo + 1; lag < hi; lag++) {
      if (cmnd[lag] < cmnd[best]) best = lag;
      if (cmnd[lag] < 0.16 && cmnd[lag] <= cmnd[lag - 1] && cmnd[lag] < cmnd[lag + 1]) { best = lag; break; }
    }
    const denominator = diff[best - 1] - 2 * diff[best] + diff[best + 1];
    const delta = best > lo && best < hi && denominator > 1e-20
      ? clamp(0.5 * (diff[best - 1] - diff[best + 1]) / denominator, -0.5, 0.5) : 0;
    const voiced = clamp((0.40 - cmnd[best]) / 0.24, 0, 1);
    tracks.push({ f0: rate / (best + delta), voiced });
  }
  // Smooth confidence only. Do not quantize or smooth the actual pitch contour.
  return tracks.map((track, i) => ({ ...track, voiced:
    ((tracks[i - 1]?.voiced ?? track.voiced) + 2 * track.voiced + (tracks[i + 1]?.voiced ?? track.voiced)) / 4 }));
}

/** Same-bin envelope transformation and optional F0-guided interharmonic gate.
 * No bins are moved, no phase/frequency replacement, no generated excitation.
 */
function spectralTransform(input, sampleRate, semitones, amount = 0, guide = null) {
  if (!input.length) return input.slice();
  const n = 2 ** Math.round(Math.log2(sampleRate * 0.09288));
  const hop = n / 8, half = n / 2, ratio = 2 ** (semitones / 12), binHz = sampleRate / n;
  const tracks = amount > 0 ? (guide ?? pitchFrames(input, sampleRate, n, hop)) : null;
  const window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  const out = new Float64Array(input.length), norm = new Float64Array(input.length);
  const re = new Float64Array(n), im = new Float64Array(n);
  const env = new Float64Array(n), ei = new Float64Array(n), magnitudes = new Float64Array(half + 1);
  const mask = new Float64Array(half + 1);
  const lifter = Math.max(2, Math.round(sampleRate * 0.0015));
  let frameIndex = 0;
  for (let start = -n + hop; start < input.length; start += hop, frameIndex++) {
    re.fill(0); im.fill(0); ei.fill(0);
    for (let j = 0; j < n; j++) {
      const p = start + j;
      if (p >= 0 && p < input.length) re[j] = input[p] * window[j];
    }
    fft(re, im);
    for (let k = 0; k <= half; k++) magnitudes[k] = Math.hypot(re[k], im[k]);
    for (let k = 0; k < n; k++) env[k] = Math.log(Math.max(1e-7, magnitudes[k <= half ? k : n - k]));
    fft(env, ei, true);
    for (let q = 0; q < n; q++) {
      const distance = Math.min(q, n - q);
      env[q] *= distance < lifter ? 0.5 + 0.5 * Math.cos(Math.PI * distance / lifter) : 0;
      ei[q] = 0;
    }
    fft(env, ei);
    if (tracks) {
      const { f0, voiced } = tracks[frameIndex];
      // Keep a quiet unvoiced consonant path; do not force noise onto a fake F0.
      mask.fill(0.35 * (1 - voiced) + VOCALOID_DEFAULTS.noiseFloor * voiced);
      if (f0 > 0 && voiced > 0) for (let hz = f0; hz < sampleRate / 2; hz += f0) {
        const predicted = hz / binHz;
        const radius = Math.max(1, Math.min(f0 * 0.18 / binHz, 2 + predicted * 0.008));
        let peak = Math.round(predicted);
        for (let k = Math.max(1, Math.floor(predicted - radius)); k <= Math.min(half - 1, Math.ceil(predicted + radius)); k++) {
          if (magnitudes[k] > magnitudes[peak]) peak = k;
        }
        // Reject noise-only peaks: a harmonic must stand above the local
        // interharmonic power floor, not merely be near an integer multiple.
        let noisePower = 0, noiseBins = 0;
        const periodBins = f0 / binHz;
        for (let k = Math.max(1, Math.floor(peak - periodBins * 0.48)); k <= Math.min(half, Math.ceil(peak + periodBins * 0.48)); k++) {
          if (Math.abs(k - peak) >= periodBins * 0.28) { noisePower += magnitudes[k] ** 2; noiseBins++; }
        }
        const tonality = clamp(1 - 2 * noisePower / Math.max(1e-20, noiseBins * magnitudes[peak] ** 2), 0, 1);
        // Preserve the observed partial including vibrato spread; suppress gaps.
        const width = Math.min(f0 * 0.30 / binHz, Math.max(1.5, predicted * 0.004));
        for (let k = Math.max(1, Math.floor(peak - width * 1.7)); k <= Math.min(half, Math.ceil(peak + width * 1.7)); k++) {
          const distance = Math.abs(k - peak) / Math.max(width, 0.5);
          const keep = tonality * (distance < 0.65 ? 1 : distance < 1.7 ? 0.5 + 0.5 * Math.cos(Math.PI * (distance - 0.65) / 1.05) : 0);
          mask[k] = Math.max(mask[k], (0.35 + 0.65 * keep) * (1 - voiced) + (VOCALOID_DEFAULTS.noiseFloor + (1 - VOCALOID_DEFAULTS.noiseFloor) * keep) * voiced);
        }
      }
    }
    for (let k = 0; k <= half; k++) {
      const index = k / ratio, left = Math.floor(index), fraction = index - left;
      const shifted = env[left] * (1 - fraction) + env[Math.min(half, left + 1)] * fraction;
      const lowBlend = clamp((k * binHz - 100) / 180, 0, 1);
      // +/-30dB is a numerical guard, not v1's restrictive +/-9dB tone limit.
      const envelopeGain = Math.exp(clamp(shifted - env[k], -3.45388, 3.45388) * lowBlend);
      const g = envelopeGain * (tracks ? 1 + amount * (mask[k] - 1) : 1);
      re[k] *= g; im[k] *= g;
      if (k > 0 && k < half) { re[n - k] *= g; im[n - k] *= g; }
    }
    fft(re, im, true);
    for (let j = 0; j < n; j++) {
      const p = start + j;
      if (p >= 0 && p < out.length) { out[p] += re[j] * window[j]; norm[p] += window[j] ** 2; }
    }
  }
  return Float32Array.from(out, (x, i) => x / Math.max(norm[i], 1e-12));
}

export function shiftFormants(input, sampleRate, semitones) {
  return spectralTransform(input, sampleRate, semitones);
}

/** Exposed for independent noise-suppression tests; no EQ or makeup gain. */
export function suppressAperiodicity(input, sampleRate, amount = 1) {
  return spectralTransform(input, sampleRate, 0, clamp(amount, 0, 1));
}

// RBJ cookbook biquads. Frequencies are bounded for low sample rates.
function biquad(input, sr, type, hz, q = 0.707, decibels = 0) {
  const w = 2 * Math.PI * Math.min(hz, sr * 0.45) / sr;
  const c = Math.cos(w), s = Math.sin(w), alpha = s / (2 * q), A = 10 ** (decibels / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'highpass') {
    b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0;
    a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (type === 'lowpass') {
    b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0;
    a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (type === 'peak') {
    b0 = 1 + alpha * A; b1 = -2 * c; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * c; a2 = 1 - alpha / A;
  } else {
    const t = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * c + t);
    b1 = -2 * A * ((A - 1) + (A + 1) * c);
    b2 = A * ((A + 1) + (A - 1) * c - t);
    a0 = (A + 1) - (A - 1) * c + t;
    a1 = 2 * ((A - 1) - (A + 1) * c);
    a2 = (A + 1) - (A - 1) * c - t;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const out = new Float32Array(input.length);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < input.length; i++) {
    const y = b0 * input[i] + z1;
    z1 = b1 * input[i] - a1 * y + z2; z2 = b2 * input[i] - a2 * y;
    out[i] = y;
  }
  return out;
}

// Centered 20ms RMS leveling. Bounded gain and a soft silence floor prevent
// amplifying tails; the detector has no feedback from the output gain.
function dynamics(input, sr, amount, smoothingSeconds = 0.004, guide = null) {
  const radius = Math.max(1, Math.round(sr * 0.010));
  const sums = new Float64Array(input.length + 1);
  for (let i = 0; i < input.length; i++) sums[i + 1] = sums[i] + input[i] ** 2;
  const out = new Float32Array(input.length);
  let smooth = 1;
  const coefficient = smoothingSeconds > 0 ? Math.exp(-1 / (smoothingSeconds * sr)) : 0;
  for (let i = 0; i < input.length; i++) {
    const lo = Math.max(0, i - radius), hi = Math.min(input.length, i + radius + 1);
    const level = Math.sqrt(Math.max(0, sums[hi] - sums[lo]) / (hi - lo));
    const leveling = Math.min(12, (VOCALOID_DEFAULTS.targetRms / Math.max(level, 0.001)) ** (VOCALOID_DEFAULTS.compressionExponent * amount));
    const gate = Math.min(1, (level / 0.003) ** amount);
    let voiced = 1;
    if (guide) {
      const n = 2 ** Math.round(Math.log2(sr * 0.09288)), hop = n / 8;
      const position = (i + n / 2 - hop) / hop;
      const left = Math.max(0, Math.min(guide.length - 1, Math.floor(position)));
      const right = Math.min(guide.length - 1, left + 1), fraction = position - Math.floor(position);
      voiced = guide[left].voiced * (1 - fraction) + guide[right].voiced * fraction;
    }
    // Do not normalize suppressed breaths back up to the voiced RMS target.
    const target = (1 + voiced * (leveling - 1)) * gate;
    smooth = coefficient * smooth + (1 - coefficient) * target;
    out[i] = input[i] * smooth;
  }
  return out;
}

/** applyVocaloid(Float32Array, Hz, 0..1) -> Float32Array, same length/rate. */
export function applyVocaloid(input, sampleRate, amount) {
  if (!(input instanceof Float32Array)) throw new TypeError('input must be Float32Array');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('sampleRate must be 8000..192000 Hz');
  if (typeof amount !== 'number' || Number.isNaN(amount)) throw new TypeError('amount must be a number');
  for (const x of input) if (!Number.isFinite(x)) throw new TypeError('input must contain finite samples');
  amount = clamp(amount, 0, 1);
  if (amount === 0 || input.length === 0) return input;
  const n = 2 ** Math.round(Math.log2(sampleRate * 0.09288));
  const guide = pitchFrames(input, sampleRate, n, n / 8);
  let out = spectralTransform(input, sampleRate, VOCALOID_DEFAULTS.formantSemitones * amount);
  const hp = biquad(out, sampleRate, 'highpass', VOCALOID_DEFAULTS.highpassHz);
  for (let i = 0; i < out.length; i++) out[i] += amount * (hp[i] - out[i]);
  out = biquad(out, sampleRate, 'peak', VOCALOID_DEFAULTS.presenceHz, 0.8, VOCALOID_DEFAULTS.presenceDb * amount);
  out = biquad(out, sampleRate, 'shelf', VOCALOID_DEFAULTS.airHz, 0.707, VOCALOID_DEFAULTS.airDb * amount);
  out = dynamics(out, sampleRate, amount, 0.004, guide);
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    // Very mild saturation after leveling; no phase oscillator or pitch correction.
    out[i] += amount * (Math.tanh(1.3 * out[i]) / 1.3 - out[i]);

  }
  // Remove interharmonic residuals after rapid leveling. A final centered-RMS
  // pass flattens mask-induced level changes without delayed gain overshoot.
  // Analyze the original voice, not the shifted spectral envelope.
  out = spectralTransform(out, sampleRate, 0, amount, guide);
  out = dynamics(out, sampleRate, amount, 0, guide);
  for (const sample of out) peak = Math.max(peak, Math.abs(sample));
  if (peak > VOCALOID_DEFAULTS.ceiling) for (let i = 0; i < out.length; i++) out[i] *= VOCALOID_DEFAULTS.ceiling / peak;
  return out;
}
