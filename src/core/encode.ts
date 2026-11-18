// 書き出し: MP3（既定。lamejs でブラウザ内エンコード）と WAV（16 bit）。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { Mp3Encoder } from "@breezystack/lamejs";

const toI16 = (x: Float32Array): Int16Array => {
  const y = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = Math.round(Math.max(-1, Math.min(1, x[i])) * 32767);
  return y;
};

export function encodeMp3(ch: Float32Array[], sr: number, kbps = 192): Uint8Array {
  const enc = new Mp3Encoder(ch.length, sr, kbps);
  const L = toI16(ch[0]);
  const R = ch.length > 1 ? toI16(ch[1]) : undefined;
  const parts: Uint8Array[] = [];
  const N = 1152;
  for (let i = 0; i < L.length; i += N) {
    const b = enc.encodeBuffer(L.subarray(i, i + N), R?.subarray(i, i + N));
    if (b.length) parts.push(new Uint8Array(b));
  }
  const f = enc.flush();
  if (f.length) parts.push(new Uint8Array(f));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function encodeWav(ch: Float32Array[], sr: number): Uint8Array {
  const nch = ch.length;
  const n = ch[0].length;
  const buf = new ArrayBuffer(44 + n * nch * 2);
  const v = new DataView(buf);
  const s = (o: number, t: string) => { for (let k = 0; k < 4; k++) v.setUint8(o + k, t.charCodeAt(k)); };
  s(0, "RIFF"); v.setUint32(4, 36 + n * nch * 2, true); s(8, "WAVE"); s(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true); s(36, "data");
  v.setUint32(40, n * nch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      v.setInt16(o, Math.round(Math.max(-1, Math.min(1, ch[c][i])) * 32767), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

/** 区間ごとの数値（RMS・ピーク、dBFS）。 */
export function levels(x: Float32Array, sr: number, fromSec = 0, toSec = x.length / sr): { rmsDb: number; peakDb: number; clipped: number } {
  const a = Math.max(0, Math.floor(fromSec * sr));
  const b = Math.min(x.length, Math.ceil(toSec * sr));
  let s = 0, pk = 0, clip = 0;
  for (let i = a; i < b; i++) {
    const v = Math.abs(x[i]);
    s += v * v;
    if (v > pk) pk = v;
    if (v >= 0.999) clip++;
  }
  const db = (v: number) => (v > 0 ? +(20 * Math.log10(v)).toFixed(2) : -Infinity);
  return { rmsDb: db(Math.sqrt(s / Math.max(1, b - a))), peakDb: db(pk), clipped: clip };
}
