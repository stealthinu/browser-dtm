/** Deterministic little-endian PCM WAV decoding (same signed scaling as ffmpeg).
 * Return null for codecs handled by decodeAudioData instead. Never changes sample rate.
 */
export function decodePcmWav(bytes, context) {
  const view = new DataView(bytes);
  if (view.byteLength < 12 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) return null;
  let format, payload;
  for (let p = 12; p + 8 <= view.byteLength;) {
    const id = view.getUint32(p, false), size = view.getUint32(p + 4, true), start = p + 8;
    if (start + size > view.byteLength) throw new Error('WAV chunk が途中で切れています');
    if (id === 0x666d7420 && size >= 16) {
      let tag = view.getUint16(start, true);
      if (tag === 0xfffe && size >= 40) tag = view.getUint16(start + 24, true);
      format = { tag, channels: view.getUint16(start + 2, true), rate: view.getUint32(start + 4, true), block: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true) };
    }
    if (id === 0x64617461) payload = { start, size };
    p = start + size + (size & 1);
  }
  if (!format || !payload) throw new Error('WAV の fmt / data chunk がありません');
  const { tag, channels, rate, block, bits } = format;
  if (!(tag === 1 && [8, 16, 24, 32].includes(bits)) && !(tag === 3 && [32, 64].includes(bits))) return null;
  if (!channels || channels > 2 || rate < 8000 || rate > 192000 || block !== channels * bits / 8 || payload.size % block !== 0 || payload.size === 0) throw new Error('非対応の WAV 形式です（mono / stereo、8〜192 kHz）');
  const frames = payload.size / block;
  const output = context.createBuffer(channels, frames, rate);
  for (let c = 0; c < channels; c++) {
    const data = output.getChannelData(c);
    for (let i = 0; i < frames; i++) {
      const p = payload.start + i * block + c * bits / 8;
      if (tag === 3) data[i] = bits === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true);
      else if (bits === 8) data[i] = (view.getUint8(p) - 128) / 128;
      else if (bits === 16) data[i] = view.getInt16(p, true) / 32768;
      else if (bits === 24) {
        let x = view.getUint8(p) | view.getUint8(p + 1) << 8 | view.getUint8(p + 2) << 16;
        if (x & 0x800000) x -= 0x1000000;
        data[i] = x / 8388608;
      } else data[i] = view.getInt32(p, true) / 2147483648;
    }
  }
  return output;
}
