// Thin adapter; upstream VocaTab remains read-only, including all copyright headers.
import { Engine } from 'vocatab/engine-web/core';
import { composeF0, frameNotes } from 'vocatab/engine';
import { defaultBase } from 'vocatab/model';
declare const ort: any;
declare function importScripts(...urls: string[]): void;
let engine: Engine;
const bank = 'leapsinger_ja_3singer', vocoder = 'nhvsing_v3_2_1';
self.onmessage = async ({data:m}) => {
  try {
    if (!engine) {
      importScripts('/ort/ort.wasm.min.js');
      ort.env.wasm.wasmPaths = `${self.location.origin}/ort/`;
      ort.env.wasm.numThreads = 1;
      engine = new Engine(ort, (loaded,total) => self.postMessage({progress:{loaded,total}}));
      await engine.init(`${self.location.origin}/vocatab/`, false, false);
    }
    const analyzed = await engine.analyze({voicebank:bank,singer:m.singer,bpm:m.bpm,seed:42,notes:m.notes});
    const track = {notes:m.notes,base:defaultBase(),params:{}} as any;
    const project = {bpm:m.bpm} as any;
    const phrases = [];
    for (const q of analyzed.phrases) {
      const ph = {...q,nFrames:q.n_frames,startFrame:q.start_frame};
      const {log2:f0} = composeF0(ph as any,track,project);
      const fn = frameNotes(ph as any), byId = new Map(m.notes.map((n:any) => [n.id,n]));
      // Hard flattening happens in the F0 domain before VocaTab synthesis.
      for (let i=0;i<f0.length;i++) {
        const n:any = byId.get(fn[i]);
        if (n) f0[i] += m.kerokero * (Math.log2(440) + (n.pitch-69)/12 - f0[i]);
      }
      const s = await engine.synthesize({voicebank:bank,singer:m.singer,key:q.key,f0_log2:f0,vocoder,params:{},mel_out:false,mel_plain:false,retake_mel:{}});
      phrases.push({startSec:q.start_sec,wav:s.wav});
    }
    self.postMessage({id:m.id,phrases,frameRate:analyzed.frame_rate}, {transfer:phrases.map(p=>p.wav.buffer)});
  } catch(e) { self.postMessage({id:m.id,error:e instanceof Error ? e.message : String(e)}); }
};
