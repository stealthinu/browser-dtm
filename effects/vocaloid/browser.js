import { applyVocaloid } from './dsp.js';
export { applyVocaloid } from './dsp.js';

/** AudioBuffer adapter, usable with AudioContext or OfflineAudioContext. */
export function applyVocaloidBuffer(input, amount, context) {
  const output = context.createBuffer(input.numberOfChannels, input.length, input.sampleRate);
  for (let c = 0; c < input.numberOfChannels; c++) {
    output.copyToChannel(applyVocaloid(input.getChannelData(c), input.sampleRate, amount), c);
  }
  return output;
}

/** Render the same samples through Web Audio's offline signal path. */
export async function renderVocaloid(input, amount) {
  const context = new OfflineAudioContext(input.numberOfChannels, input.length, input.sampleRate);
  const source = context.createBufferSource();
  source.buffer = applyVocaloidBuffer(input, amount, context);
  source.connect(context.destination); source.start();
  return context.startRendering();
}
