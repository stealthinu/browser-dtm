import { applyVocaloid } from '../../effects/vocaloid/dsp.js';
self.onmessage = ({ data }) => {
  try {
    const channels = data.channels.map(channel => applyVocaloid(channel, data.sampleRate, data.amount));
    self.postMessage({ channels }, channels.map(channel => channel.buffer));
  } catch (error) { self.postMessage({ error: error.message }); }
};
