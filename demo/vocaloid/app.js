const $ = id => document.getElementById(id);
const context = new AudioContext();
const analyser = context.createAnalyser();
analyser.fftSize = 2048; analyser.connect(context.destination);
let input, output, outputAmount, source, busy = false;

function status(text) { $('status').textContent = text; }
function controls() {
  $('file').disabled = busy;
  $('amount').disabled = busy;
  $('process').disabled = busy || !input;
  $('original').disabled = busy || !input;
  $('play').disabled = busy || !output;
  $('export').disabled = busy || !output;
  $('stop').disabled = !source;
}
function stop() {
  if (source) { source.onended = null; source.stop(); source.disconnect(); source = null; }
  controls();
}
async function play(buffer) {
  stop(); await context.resume();
  source = context.createBufferSource(); source.buffer = buffer; source.connect(analyser);
  source.onended = () => { source?.disconnect(); source = null; controls(); };
  source.start(); controls();
}
function runWorker(url, data, type = 'module') {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, { type });
    worker.onmessage = ({ data: result }) => {
      worker.terminate();
      if (result.error) reject(new Error(result.error)); else resolve(result);
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage(data);
  });
}
async function load(file) {
  stop(); busy = true; output = undefined; controls(); status('歌声を読み込んでいます…');
  try {
    // A temporary offline decoder retains the file rate instead of using the device rate.
    // WAV parsing supplies its rate; other formats use the normal 44.1kHz decode path.
    const bytes = await file.arrayBuffer();
    const view = new DataView(bytes);
    let rate = 44100;
    if (bytes.byteLength >= 12 && view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645) {
      for (let p = 12; p + 8 <= bytes.byteLength;) {
        const size = view.getUint32(p + 4, true);
        if (view.getUint32(p, false) === 0x666d7420 && size >= 16 && p + 24 <= bytes.byteLength) {
          rate = view.getUint32(p + 12, true); break;
        }
        p += 8 + size + (size & 1);
      }
    }
    const decoder = new OfflineAudioContext(1, 1, rate);
    input = await decoder.decodeAudioData(bytes);
    if (input.numberOfChannels > 2) throw new Error('mono / stereo の歌声を選んでください');
    $('fileInfo').textContent = `${file.name} · ${input.duration.toFixed(2)} 秒 · ${input.sampleRate} Hz · ${input.numberOfChannels} ch`;
    status('強度を選び「この強度で処理」を押してください。');
  } catch (error) { input = undefined; status(`読み込みエラー: ${error.message}`); throw error; }
  finally { busy = false; controls(); }
}
async function processAudio() {
  stop(); busy = true; output = undefined; controls();
  const amount = Number($('amount').value); status(`強度 ${amount.toFixed(2)} で処理中…`);
  try {
    const channels = Array.from({ length: input.numberOfChannels }, (_, c) => input.getChannelData(c));
    const result = await runWorker('dsp-worker.js', { channels, sampleRate: input.sampleRate, amount });
    const offline = new OfflineAudioContext(input.numberOfChannels, input.length, input.sampleRate);
    const buffer = offline.createBuffer(input.numberOfChannels, input.length, input.sampleRate);
    result.channels.forEach((channel, c) => buffer.copyToChannel(channel, c));
    const node = offline.createBufferSource(); node.buffer = buffer; node.connect(offline.destination); node.start();
    output = await offline.startRendering(); outputAmount = amount;
    status(`強度 ${amount.toFixed(2)} の処理が完了しました。再生・MP3 保存ができます。`);
  } catch (error) { status(`処理エラー: ${error.message}`); throw error; }
  finally { busy = false; controls(); }
}
async function exportMp3() {
  busy = true; controls(); status('MP3 を作成しています…');
  try {
    const channels = Array.from({ length: output.numberOfChannels }, (_, c) => output.getChannelData(c));
    const { blob } = await runWorker('encoder-worker.js', { channels, sampleRate: output.sampleRate }, 'classic');
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `browser-vocaloid-${outputAmount}.mp3`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`強度 ${outputAmount.toFixed(2)} の MP3 を保存しました。`);
  } catch (error) { status(`書き出しエラー: ${error.message}`); throw error; }
  finally { busy = false; controls(); }
}
$('file').addEventListener('change', () => { if ($('file').files[0]) load($('file').files[0]).catch(console.error); });
$('amount').addEventListener('input', () => {
  $('amountValue').value = Number($('amount').value).toFixed(2);
  output = undefined; controls();
  if (input) status('強度を変更しました。「この強度で処理」を押してください。');
});
$('process').onclick = () => processAudio().catch(console.error);
$('original').onclick = () => play(input).catch(console.error);
$('play').onclick = () => play(output).catch(console.error);
$('stop').onclick = stop;
$('export').onclick = () => exportMp3().catch(console.error);
// Read-only observability for local integration tests and embedding experiments.
window.vocaloidDemo = {
  get input() { return input; }, get output() { return output; },
  get context() { return context; }, get analyser() { return analyser; }, get busy() { return busy; },
};
controls();
