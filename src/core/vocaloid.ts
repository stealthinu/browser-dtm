// feat/vocaloid-filter ae8a772 の v2 DSP に音量補正と無声子音の原音経路を加える。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { applyVocaloid, pitchFrames } from "./vocaloid-v2.js";

/** 0=無声、1=有声。解析窓の中心間を線形補間してクリックを避ける。 */
export function voicedConfidence(input: Float32Array, sr: number): Float32Array {
  const n = 2 ** Math.round(Math.log2(sr * 0.09288)), hop = n / 8;
  const guide = pitchFrames(input, sr, n, hop);
  return Float32Array.from(input, (_, i) => {
    const pos = (i + n / 2 - hop) / hop, left = Math.max(0, Math.min(guide.length - 1, Math.floor(pos)));
    const right = Math.min(guide.length - 1, left + 1), fraction = pos - Math.floor(pos);
    return guide[left].voiced * (1 - fraction) + guide[right].voiced * fraction;
  });
}

/** 強度0はビット一致。音量基準は入力の同じ有声サンプル集合。 */
export function applyVocaloidMatched(input: Float32Array, sr: number, amount: number): Float32Array {
  if (amount <= 0 || !input.length) return input;
  const wet = applyVocaloid(input, sr, amount);
  const confidence = voicedConfidence(input, sr);
  const weight = Float32Array.from(confidence, (v) => Math.max(0, Math.min(1, (v - 0.2) / 0.5)));
  const energy = (x: Float32Array) => {
    let sum = 0;
    for (let i = 0; i < x.length; i++) if (confidence[i] >= 0.75) sum += x[i] ** 2;
    return sum;
  };
  const target = energy(input), measured = energy(wet);
  const gain = target > 1e-12 && measured > 1e-12 ? Math.sqrt(target / measured) : 1;
  const out = Float32Array.from(input, (x, i) => x * (1 - weight[i]) + wet[i] * gain * weight[i]);
  // 遷移窓の dry/wet 干渉も同じ有声集合で補正。無声ではゲインを変えない。
  const after = energy(out);
  const correction = target > 1e-12 && after > 1e-12 ? Math.sqrt(target / after) : 1;
  for (let i = 0; i < out.length; i++) out[i] *= 1 + weight[i] * (correction - 1);
  return out;
}
