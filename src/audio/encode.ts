/** WAV / MP3 エンコード（ブラウザ・Node 共通の純粋関数） */

export function encodeWavPCM16(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const nch = channels.length;
  const n = channels[0]?.length ?? 0;
  const data = new ArrayBuffer(44 + n * nch * 2);
  const v = new DataView(data);
  const str = (o: number, s: string) => {
    for (let k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * nch * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * 2, true);
  v.setUint16(32, nch * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * nch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const y = Math.max(-1, Math.min(1, channels[c][i] ?? 0));
      v.setInt16(o, Math.round(y * 32767), true);
      o += 2;
    }
  }
  return data;
}

/** lamejs が無い環境向けのフォールバックは呼び出し側で ffmpeg に任せる */
export async function encodeMp3Stereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Promise<Uint8Array> {
  try {
    const lame = await import("lamejs");
    const Mp3Encoder =
      lame.Mp3Encoder ||
      (lame as { default?: { Mp3Encoder: typeof lame.Mp3Encoder } }).default?.Mp3Encoder;
    if (!Mp3Encoder) throw new Error("lamejs Mp3Encoder が無い");
    const enc = new Mp3Encoder(2, sampleRate, 128);
    const block = 1152;
    const parts: Uint8Array[] = [];
    const toInt16 = (f: Float32Array, i0: number, n: number) => {
      const a = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const y = Math.max(-1, Math.min(1, f[i0 + i] ?? 0));
        a[i] = y < 0 ? y * 0x8000 : y * 0x7fff;
      }
      return a;
    };
    for (let i = 0; i < left.length; i += block) {
      const n = Math.min(block, left.length - i);
      const buf = enc.encodeBuffer(toInt16(left, i, n), toInt16(right, i, n));
      if (buf.length) parts.push(new Uint8Array(buf));
    }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    if (out.byteLength > 0) return out;
  } catch {
    /* fall through: WAV を返す呼び出し側で ffmpeg してもよい */
  }
  // フォールバック: ブラウザ内では WAV を MP3 コンテナとして渡せないので、
  // 最低限の MPEG フレームが無い場合は空を返さず WAV バイトを返す（accept 側で ffmpeg）。
  const wav = new Uint8Array(encodeWavPCM16([left, right], sampleRate));
  return wav;
}

export function monoToStereo(mono: Float32Array): [Float32Array, Float32Array] {
  return [mono, mono.slice()];
}

export function mixDown(buffers: Array<{ data: Float32Array; gain?: number }>, length: number): Float32Array {
  const out = new Float32Array(length);
  for (const b of buffers) {
    const g = b.gain ?? 1;
    const n = Math.min(length, b.data.length);
    for (let i = 0; i < n; i++) out[i] += b.data[i] * g;
  }
  let peak = 1e-9;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.99) {
    const s = 0.99 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= s;
  }
  return out;
}
