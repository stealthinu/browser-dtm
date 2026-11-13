// 書き出した音の数値（SPEC §3 A2・A3）。MP3 は ffmpeg でデコードして測る。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const SR = 44100;

export function decodeMp3(path) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", String(SR), "-"],
                           { maxBuffer: 1 << 30 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const n = all.length / 2;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = all[2 * i]; R[i] = all[2 * i + 1]; }
  return [L, R];
}

/** 16 bit PCM の WAV（encodeWav が書いたもの）→ チャンネルごとの Float32Array */
export function readWav(path) {
  const b = readFileSync(path);
  const nch = b.readUInt16LE(22);
  const n = b.readUInt32LE(40) / 2 / nch;
  const ch = Array.from({ length: nch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) ch[c][i] = b.readInt16LE(44 + (i * nch + c) * 2) / 32768;
  return ch;
}

const db = (v) => (v > 0 ? +(20 * Math.log10(v)).toFixed(2) : -999);

export function levels(x, from = 0, to = x.length / SR) {
  const a = Math.max(0, Math.floor(from * SR)), b = Math.min(x.length, Math.ceil(to * SR));
  let s = 0, pk = 0, clip = 0;
  for (let i = a; i < b; i++) {
    const v = Math.abs(x[i]);
    s += v * v;
    if (v > pk) pk = v;
    if (v >= 0.999) clip++;
  }
  return { rmsDb: db(Math.sqrt(s / Math.max(1, b - a))), peakDb: db(pk), clipped: clip };
}

/** 最初に |x| が thr を超えたサンプルの時刻（ms） */
export function onsetMs(x, thr = 0.01) {
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > thr) return +((i / SR) * 1000).toFixed(2);
  return null;
}

/** y が x からどれだけ遅れているか（ms）。±maxMs の範囲で相互相関が最大になるずれ。 */
export function lagMs(x, y, maxMs = 60, from = 0, len = x.length) {
  const M = Math.round((maxMs / 1000) * SR);
  let best = 0, bestV = -Infinity;
  const end = Math.min(len, x.length, y.length - M);
  for (let d = -M; d <= M; d++) {
    let s = 0;
    for (let i = Math.max(from, -d); i < end; i += 2) s += x[i] * (y[i + d] ?? 0);
    if (s > bestV) { bestV = s; best = d; }
  }
  return +((best / SR) * 1000).toFixed(3);
}

/** 相関係数（波形がどれだけ変わったか） */
export function corr(x, y) {
  const n = Math.min(x.length, y.length);
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; }
  const cov = sxy / n - (sx / n) * (sy / n);
  return +(cov / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2) || 1)).toFixed(4);
}

export function diffDb(x, y) {
  const n = Math.min(x.length, y.length);
  let s = 0, d = 0;
  for (let i = 0; i < n; i++) { s += x[i] * x[i]; d += (x[i] - y[i]) ** 2; }
  return db(Math.sqrt(d / n)) - db(Math.sqrt(s / n));
}
