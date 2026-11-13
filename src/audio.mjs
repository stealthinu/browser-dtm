import { createSynth, parseMML } from '@onjmin/dtm';
import { toVocaNotes, toDtmMml, requireSong, inspectMml } from './song.mjs';
export const RATE = 44100;
let worker, seq = 0;
const waiting = new Map(), voiceCache = new Map();
function callWorker(message, progress) {
  if (!worker) {
    worker = new Worker('/dist/vocal-worker.js');
    worker.onmessage = ({data:m}) => {
      if (m.progress) { for (const w of waiting.values()) w.progress?.(m.progress); return; }
      const w = waiting.get(m.id);
      if (w) { clearTimeout(w.timer); waiting.delete(m.id); m.error ? w.reject(new Error(m.error)) : w.resolve(m); }
    };
    worker.onerror = e => { for (const w of waiting.values()) {clearTimeout(w.timer);w.reject(new Error(e.message));} waiting.clear(); worker.terminate();worker=null; };
  }
  const id = ++seq;
  return new Promise((resolve,reject) => {
    const timer = setTimeout(()=>{waiting.delete(id);reject(new Error('VocaTab synthesis timeout (180s)'));},180000);
    waiting.set(id,{resolve,reject,progress,timer});worker.postMessage({...message,id});
  });
}
function bandpass(freq, q = 2) {
  const w=2*Math.PI*freq/RATE,a=Math.sin(w)/(2*q),a0=1+a;
  const b0=a/a0,b2=-a/a0,a1=-2*Math.cos(w)/a0,a2=(1-a)/a0;
  let x1=0,x2=0,y1=0,y2=0;
  return x=>{const y=b0*x+b2*x2-a1*y1-a2*y2;x2=x1;x1=x;y2=y1;y1=y;return y;};
}
function vocode(input, notes, bpm) {
  const output = new Float32Array(input.length);
  const bands = Array.from({length:16},(_,i)=>{const f=100*1.32**i;return {mod:bandpass(f),car:bandpass(f),env:0};});
  let phase=0, noteIndex=0;
  for(let i=0;i<input.length;i++) {
    const tick=i/RATE*bpm/60*480;
    while(noteIndex<notes.length-1 && notes[noteIndex+1].onset<=tick) noteIndex++;
    const hz=440*2**((notes[noteIndex]?.pitch-69)/12);
    phase=(phase+(Number.isFinite(hz)?hz:220)/RATE)%1;
    const carrier=phase*2-1;
    let value=0;
    for(const b of bands) {
      const rect=Math.abs(b.mod(input[i]));
      b.env += (rect>b.env ? 0.007 : 0.0007)*(rect-b.env);
      value += b.car(carrier)*b.env*7;
    }
    output[i]=value;
  }
  // Filter-bank resonances depend on the singer and melody. Match the wet RMS to
  // the dry singer and keep headroom before PCM16 conversion, including stems.
  let dryEnergy=0,wetEnergy=0,peak=0;
  for(let i=0;i<input.length;i++){dryEnergy+=input[i]**2;wetEnergy+=output[i]**2;peak=Math.max(peak,Math.abs(output[i]));}
  const gain=Math.min(Math.sqrt(dryEnergy/Math.max(1e-20,wetEnergy)),0.8/Math.max(1e-10,peak));
  for(let i=0;i<output.length;i++)output[i]*=gain;
  return output;
}
export function applyPcmEffects(input, effects, notes, bpm) {
  let data = new Float32Array(input);
  for (const name of ['vocoder','bitcrusher','doubling']) {
    const wet = effects[name] ?? 0;
    if (!wet) continue;
    const prev = data;
    if (name === 'vocoder') data = vocode(prev,notes,bpm);
    else if (name === 'bitcrusher') {
      data = new Float32Array(prev.length);
      for(let i=0;i<data.length;i++) data[i]=Math.round(prev[i-i%6]*16)/16;
    } else {
      data = new Float32Array(prev.length);
      for(let i=0;i<data.length;i++) {
        const offset = RATE*(0.018+0.003*Math.sin(2*Math.PI*0.8*i/RATE)), p=i-offset, j=Math.floor(p), f=p-j;
        data[i]=prev[i]*0.7+(j>=0?((prev[j]??0)*(1-f)+(prev[j+1]??0)*f)*0.6:0);
      }
    }
    for(let i=0;i<data.length;i++) data[i]=prev[i]*(1-wet)+data[i]*wet;
  }
  return data;
}
export async function renderSong(song, onProgress = ()=>{}) {
  requireSong(song);
  const duration = song.bars*4*60/song.bpm+0.6, length=Math.ceil(duration*RATE);
  const vocal=song.tracks.find(t=>t.kind==='vocal'), notes=toVocaNotes(song,vocal);
  if(!notes.length) throw new Error('歌の音符がありません');
  const request={notes,bpm:song.bpm,singer:{oniku:0,natsume:1,ritsu:2}[vocal.singer],kerokero:vocal.effects?.kerokero??0};
  const key=JSON.stringify(request);
  let raw=voiceCache.get(key), phraseTimes;
  if(!raw) {
    onProgress('VocaTab / CPU で歌声合成中…');
    const result=await callWorker(request,p=>onProgress(`モデル読み込み ${Math.round(p.loaded/Math.max(1,p.total)*100)}%`));
    raw=new Float32Array(length);phraseTimes=result.phrases.map(p=>p.startSec);
    for(const p of result.phrases) {
      const offset=Math.round(p.startSec*RATE);
      for(let i=Math.max(0,-offset);i<p.wav.length && offset+i<raw.length;i++) raw[offset+i]+=p.wav[i];
    }
    voiceCache.set(key,{data:raw,phraseTimes});
    raw=voiceCache.get(key);
    if(voiceCache.size>4) voiceCache.delete(voiceCache.keys().next().value);
  }
  phraseTimes=raw.phraseTimes;
  const processed=applyPcmEffects(raw.data,vocal.effects??{},notes,song.bpm);
  const stems={vocal:new Float32Array(length)}, insts=song.tracks.filter(t=>t.kind==='inst');
  for(let i=0;i<length;i++) stems.vocal[i]=processed[i]*(vocal.volume??0.7);
  onProgress('dtm / 伴奏を描画中…');
  const placements=parseMML(toDtmMml(song)).placements;
  // Check the strict subset against the actual dtm parser before playing it.
  for(let i=0;i<insts.length;i++) {
    const expected=inspectMml(insts[i].mml,song).placements;
    const actual=placements.filter(p=>p.trackIndex===i).map(p=>({...p,trackIndex:0}));
    const keys=['trackIndex','startStep','durationSteps','pitchUnits','velocity'];
    if(expected.length!==actual.length||expected.some((p,n)=>keys.some(k=>p[k]!==actual[n][k])))throw new Error(`dtm MML conversion differs: ${insts[i].id}`);
  }
  for(let index=0;index<insts.length;index++) {
    const t=insts[index],ctx=new OfflineAudioContext(1,length,RATE);
    const tone=t.program==='piano'?{wave:'triangle',decay:true,gain:0.8}:t.program==='bass'?{wave:'sine',gain:0.8}:{wave:'sawtooth',attack:0.04,gain:0.5};
    const synth=createSynth(ctx,ctx.destination,tone);
    for(const p of placements.filter(p=>p.trackIndex===index)) synth.playNote({trackId:t.id,pitchUnits:p.pitchUnits,velocity:p.velocity,volume:(t.volume??0.35)*p.velocity/127,when:p.startStep/48*60/song.bpm,duration:p.durationSteps/48*60/song.bpm});
    stems[t.id]=new Float32Array((await ctx.startRendering()).getChannelData(0));
  }
  const mix=new Float32Array(length), backing=new Float32Array(length);
  for(const [id,data] of Object.entries(stems)) for(let i=0;i<length;i++) {mix[i]+=data[i];if(id!=='vocal')backing[i]+=data[i];}
  // Fixed master gain keeps effect comparisons meaningful and prevents loud mixes clipping.
  for(let i=0;i<length;i++) {mix[i]=Math.tanh(mix[i]*0.65);backing[i]*=0.65;}
  const timing={sampleRate:RATE,commonStartSample:0,vocalScheduledSample:0,backingScheduledSample:0,scheduledDeltaMs:0,phraseStartSeconds:phraseTimes};
  return {song,stems,backing,mix,timing,duration};
}
let context, playing=[];
export async function playRendered(rendered) {
  stopPlayback();context??=new AudioContext({sampleRate:RATE});await context.resume();
  const b=context.createBuffer(1,rendered.mix.length,RATE);b.copyToChannel(rendered.mix,0);
  const source=context.createBufferSource();source.buffer=b;source.connect(context.destination);
  const when=context.currentTime+0.08;source.start(when);playing.push(source);
  return {contextState:context.state,when,duration:b.duration};
}
export function stopPlayback(){for(const s of playing){try{s.stop();}catch{}}playing=[];}
export function wavBytes(data) {
  const b=new ArrayBuffer(44+data.length*2),v=new DataView(b),write=(offset,s)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i));};
  write(0,'RIFF');v.setUint32(4,b.byteLength-8,true);write(8,'WAVE');write(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,RATE,true);v.setUint32(28,RATE*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);write(36,'data');v.setUint32(40,data.length*2,true);
  for(let i=0;i<data.length;i++)v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,data[i]))*32767),true);
  return b;
}
export async function saveAudio(data, name='song', format='mp3') {
  const r=await fetch(`/api/export?name=${encodeURIComponent(name)}&format=${format}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:wavBytes(data)});
  if(!r.ok)throw new Error(await r.text());return r.json();
}
