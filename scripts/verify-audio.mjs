import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const rate=44100;
function decode(file){const b=execFileSync('ffmpeg',['-v','error','-i',file,'-ac','1','-ar',String(rate),'-f','f32le','pipe:1'],{maxBuffer:64*1024*1024});return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}
function stats(data,start=0,end=data.length/rate){let sum=0,peak=0,count=0,clips=0;for(let i=Math.round(start*rate);i<Math.min(data.length,end*rate);i++){const x=data[i];assert.ok(Number.isFinite(x),'finite samples');sum+=x*x;peak=Math.max(peak,Math.abs(x));clips+=Math.abs(x)>=0.999;count++;}return{rms:Math.sqrt(sum/Math.max(1,count)),peak,clipSamples:clips};}
function onset(data){let peak=0;for(const x of data)peak=Math.max(peak,Math.abs(x));const threshold=Math.max(0.001,peak*0.01);const i=data.findIndex(x=>Math.abs(x)>=threshold);return{threshold,sample:i,ms:i/rate*1000};}
const browser=JSON.parse(await readFile('out/browser-result.json','utf8'));
const result={durationSeconds:browser.baseline.duration,stems:{},effects:{},timing:{...browser.baseline.timing}};
for(const id of ['vocal','pf','bs','backing','mix']){
  const d=decode(`out/${id}.wav`);const full=stats(d),sections=[stats(d,0,2),stats(d,2,4),stats(d,4,6),stats(d,6,8)];
  assert.ok(full.rms>0.001,`${id} non-silent`);assert.ok(full.peak<0.99,`${id} not clipped`);
  assert.ok(sections.every(s=>s.rms>0.001),`${id} active each bar`);
  result.stems[id]={...full,sections,onset:onset(d)};
}
const mp3=decode('out/baseline.mp3');result.mp3=stats(mp3);assert.ok(result.mp3.rms>0.001&&result.mp3.peak<0.99);
result.timing.acousticOnsetDeltaMs=Math.abs(result.stems.vocal.onset.ms-result.stems.backing.onset.ms);
result.timing.acousticOnsetDefinition='First sample above max(0.001, 1% stem peak); phonetic attack differs from scheduling.';
result.timing.within30ms=result.timing.acousticOnsetDeltaMs<30;
assert.equal(result.timing.scheduledDeltaMs,0);
assert.ok(result.timing.within30ms,`acoustic onset difference ${result.timing.acousticOnsetDeltaMs.toFixed(3)}ms <30ms`);
for(const effect of ['kerokero','vocoder','bitcrusher','doubling']){
  const zero=decode(`out/${effect}-0-vocal.wav`),one=decode(`out/${effect}-1-vocal.wav`);
  assert.equal(zero.length,one.length);let sum=0,baseDiff=0;
  const dry=decode('out/vocal.wav');
  for(let i=0;i<zero.length;i++){sum+=(one[i]-zero[i])**2;baseDiff+=(zero[i]-dry[i])**2;}
  const differenceRms=Math.sqrt(sum/zero.length),bypassDifferenceRms=Math.sqrt(baseDiff/zero.length);
  const mp3Zero=stats(decode(`out/${effect}-0.mp3`)),mp3One=stats(decode(`out/${effect}-1.mp3`));
  assert.ok(differenceRms>0.0001,`${effect} audible numeric difference`);assert.equal(bypassDifferenceRms,0,`${effect} strength zero bypass`);
  assert.ok(mp3One.rms>0.001&&mp3One.peak<0.99);
  result.effects[effect]={differenceRms,bypassDifferenceRms,zero:stats(zero),one:stats(one),mp3Zero,mp3One};
}
await writeFile('out/audio-metrics.json',JSON.stringify(result,null,2)+'\n');
await writeFile('docs/evidence/audio-metrics.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));console.log('A2/A3/A4 audio verification: PASS');
