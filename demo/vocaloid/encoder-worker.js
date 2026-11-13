/* LAME remains a separate, unmodified library with its own LGPL notice. */
importScripts('/node_modules/lamejs/lame.min.js');
self.onmessage = ({ data }) => {
  try {
    const { channels, sampleRate } = data;
    if (channels.length > 2) throw new Error('MP3 書き出しは mono / stereo に対応しています');
    const encoder = new lamejs.Mp3Encoder(channels.length, sampleRate, 192);
    const pcm = channels.map(channel => Int16Array.from(channel, x => {
      const v = Math.max(-1, Math.min(1, x));
      return Math.round(v * (v < 0 ? 32768 : 32767));
    }));
    const chunks = [];
    for (let i = 0; i < pcm[0].length; i += 1152) {
      const left = pcm[0].subarray(i, i + 1152);
      const bytes = encoder.encodeBuffer(left, pcm[1]?.subarray(i, i + 1152));
      if (bytes.length) chunks.push(new Uint8Array(bytes));
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));
    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    self.postMessage({ blob });
  } catch (error) { self.postMessage({ error: error.message }); }
};
