/** Independent mono effect. No pitch detector, resampling, or frequency-bin remapping. */
export const VOCALOID_DEFAULTS = Object.freeze({
  gateDb: -48, gateRatio: 3, compressionDb: -24, compressionRatio: 8,
  makeupDb: 8, formantSemitones: 1.8, highpassHz: 90,
  presenceHz: 3200, presenceDb: 4, airHz: 9000, airDb: 3,
  deessHz: 5500, deessMaxDb: 6, saturationDrive: 1.6, ceiling: 0.94,
});
const db = x => 20 * Math.log10(Math.max(x, 1e-12));
const gain = x => 10 ** (x / 20);
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

/** Shift only the smooth log spectral envelope, retaining each complex bin's phase/frequency. */
export function shiftFormants(input, sampleRate, semitones) {
  if (!input.length || semitones === 0) return input.slice();
  const n = 2 ** Math.round(Math.log2(sampleRate * 0.04644));
  const hop = n / 4, half = n / 2, ratio = 2 ** (semitones / 12);
  const window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  const out = new Float64Array(input.length), norm = new Float64Array(input.length);
  const re = new Float64Array(n), im = new Float64Array(n);
  const env = new Float64Array(n), ei = new Float64Array(n);
  const lifter = Math.max(2, Math.round(sampleRate * 0.001));
  for (let start = -n + hop; start < input.length; start += hop) {
    re.fill(0); im.fill(0); ei.fill(0);
    for (let j = 0; j < n; j++) {
      const p = start + j;
      if (p >= 0 && p < input.length) re[j] = input[p] * window[j];
    }
    fft(re, im);
    for (let k = 0; k < n; k++) env[k] = Math.log(Math.max(1e-7, Math.hypot(re[k], im[k])));
    fft(env, ei, true);
    // Raised cosine low-quefrency lifter removes the excitation's harmonic ripple.
    for (let q = 0; q < n; q++) {
      const distance = Math.min(q, n - q);
      env[q] *= distance < lifter ? 0.5 + 0.5 * Math.cos(Math.PI * distance / lifter) : 0;
      ei[q] = 0;
    }
    fft(env, ei);
    for (let k = 0; k <= half; k++) {
      const index = k / ratio, left = Math.floor(index), fraction = index - left;
      const shifted = env[left] * (1 - fraction) + env[Math.min(half, left + 1)] * fraction;
      // Keep the lowest region stable; bound envelope compensation to +/-9dB.
      const lowBlend = clamp((k * sampleRate / n - 100) / 200, 0, 1);
      const g = Math.exp(clamp(shifted - env[k], -1.03616, 1.03616) * lowBlend);
      re[k] *= g; im[k] *= g;
      if (k > 0 && k < half) { re[n - k] *= g; im[n - k] *= g; }
    }
    fft(re, im, true);
    for (let j = 0; j < n; j++) {
      const p = start + j;
      if (p >= 0 && p < out.length) {
        out[p] += re[j] * window[j]; norm[p] += window[j] ** 2;
      }
    }
  }
  return Float32Array.from(out, (x, i) => x / Math.max(norm[i], 1e-12));
}

// RBJ cookbook biquads. Frequencies are bounded for low sample rates.
function biquad(input, sr, type, hz, q = 0.707, decibels = 0) {
  const w = 2 * Math.PI * Math.min(hz, sr * 0.45) / sr;
  const c = Math.cos(w), s = Math.sin(w), alpha = s / (2 * q), A = 10 ** (decibels / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'highpass') {
    b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0;
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

function dynamics(input, sr, amount) {
  const out = new Float32Array(input.length);
  const attack = Math.exp(-1 / (0.004 * sr)), release = Math.exp(-1 / (0.080 * sr));
  const gateRelease = Math.exp(-1 / (0.025 * sr));
  let power = 0, gateGain = 1;
  for (let i = 0; i < input.length; i++) {
    const square = input[i] ** 2;
    const coefficient = square > power ? attack : release;
    power = coefficient * power + (1 - coefficient) * square;
    const level = db(Math.sqrt(power));
    const targetGate = gain(Math.max(-36, Math.min(0, (level + 48) * 2 * amount)));
    gateGain = gateRelease * gateGain + (1 - gateRelease) * targetGate;
    const reduction = Math.max(0, level + 24) * (1 - 1 / (1 + 7 * amount));
    out[i] = input[i] * gateGain * gain(8 * amount - reduction);
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
  let out = dynamics(input, sampleRate, amount);
  out = shiftFormants(out, sampleRate, VOCALOID_DEFAULTS.formantSemitones * amount);
  const hp = biquad(out, sampleRate, 'highpass', 90);
  for (let i = 0; i < out.length; i++) out[i] += amount * (hp[i] - out[i]);
  out = biquad(out, sampleRate, 'peak', 3200, 0.8, 4 * amount);
  out = biquad(out, sampleRate, 'shelf', 9000, 0.707, 3 * amount);
  const high = biquad(out, sampleRate, 'highpass', 5500);
  const attack = Math.exp(-1 / (0.002 * sampleRate)), release = Math.exp(-1 / (0.040 * sampleRate));
  let power = 0, peak = 0;
  const drive = 1 + 0.6 * amount;
  for (let i = 0; i < out.length; i++) {
    const square = high[i] ** 2, c = square > power ? attack : release;
    power = c * power + (1 - c) * square;
    const reduction = clamp((db(Math.sqrt(power)) + 30) * 0.65, 0, 6) * amount;
    const deessed = out[i] - high[i] * (1 - gain(-reduction));
    out[i] = deessed + amount * (Math.tanh(drive * deessed) / drive - deessed);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  // A constant safety gain, not a time/pitch operation. Bypass never enters this path.
  if (peak > 0.94) for (let i = 0; i < out.length; i++) out[i] *= 0.94 / peak;
  return out;
}
