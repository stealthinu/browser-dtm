// 実LLM未編集返答をUIへ貼付し、再生・書出し・句別時間・同期を測る。
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { openApp } from "./browser.mjs";
import { levels, decodeMp3, readWav, corr, onsetMs, SR } from "./analyze.mjs";
import { finalDir } from "./paths.mjs";
const final=finalDir();
mkdirSync(final,{recursive:true});
await build({entryPoints:["src/core/tools.ts"],bundle:true,platform:"node",format:"esm",outfile:"out/tools-node.mjs"});
const { SongSession }=await import("../out/tools-node.mjs");
globalThis.Worker ??= class {postMessage(){}addEventListener(){}};
const { parseMML }=await import("@onjmin/dtm");
const requests=JSON.parse(readFileSync("fixtures/llm-real/m3-requests.json","utf8"));
const provenance=JSON.parse(readFileSync("fixtures/llm-real/m3-provenance.json","utf8"));
const results={checks:{},answers:[]};
function check(name,ok,detail={}) {results.checks[name]={ok,...detail};console.log(`${ok?"PASS":"FAIL"} ${name} ${JSON.stringify(detail)}`);}
const app=await openApp({port:5506,log:console.log});
try {
 const {page}=app;
 page.setDefaultTimeout(240000);
 const cdp=await page.createCDPSession();
 await cdp.send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:new URL("../out/real-downloads/",import.meta.url).pathname});
 mkdirSync("out/real-downloads",{recursive:true});
 for (const [i,request] of requests.entries()) {
  const name=i===0?"llm-gallery-answer":"llm-long-song";
  const text=readFileSync(`fixtures/llm-real/${request.answer}`,"utf8");
  const origin=provenance.find(p=>p.answer===request.answer);
  check(`${name}.unmodified`,createHash("sha256").update(text).digest("hex")===origin?.answer_sha256,{job:origin?.job});
  await page.evaluate(({request,text})=>{
   document.getElementById("lyrics").value=request.lyrics;
   document.getElementById("image").value=request.image;
   document.getElementById("answer").value=text;
  },{request,text});
  await page.click("#load");
  await page.waitForFunction(()=>!document.getElementById("load").disabled,{timeout:240000});
  const state=await page.evaluate(()=>({doc:window.app.getDoc(),problems:document.getElementById("problems").textContent,repairs:document.getElementById("repairs").textContent,playing:window.app.isPlaying(),status:document.getElementById("status").textContent}));
  check(`${name}.ui-paste-and-play`,state.problems==="問題なし"&&state.playing,state);
  if(state.problems!=="問題なし"||!state.playing) continue;
  const song=new SongSession(state.doc,parseMML);
  const mmlFacts=state.doc.tracks.filter(t=>t.kind==="inst").map(t=>song.mmlFacts(t));
  check(`${name}.mml-full-length`,mmlFacts.every(f=>!f.problems.length&&f.overBars===0&&f.underBars===0),{mmlFacts});
  if(i===1) {
   const vocal=state.doc.tracks.find(t=>t.kind==="vocal");
   check(`${name}.long-form`,state.doc.bars>=16&&vocal.notes.length>=20&&state.doc.tracks.filter(t=>t.kind==="inst").length>=3&&state.doc.tracks.some(t=>t.kind==="drums")&&vocal.effects.some(f=>f.type==="vocaloid")&&state.doc.tracks.filter(t=>t.kind==="inst").every(t=>t.instrument!==undefined),{bars:state.doc.bars,morae:vocal.notes.length});
  }
  // 書出しボタンそのものも押す。長尺は同じ音を2回実再生する。
  await page.click("#expMp3");
  await page.waitForFunction(()=>document.getElementById("status").textContent.startsWith("書き出し完了"),{timeout:240000});
  const downloaded=`out/real-downloads/${state.doc.title||"song"}.mp3`;
  for(let n=0;n<100&&!existsSync(downloaded);n++) await new Promise(r=>setTimeout(r,100));
  check(`${name}.mp3-button`,existsSync(downloaded));
  const stats=await page.evaluate(name=>window.app.exportAudio({name,toServer:true,stems:true}),name);
  const [L,R]=decodeMp3(`out/${name}.mp3`),[vox]=readWav(`out/${name}.vox.wav`),[acc]=readWav(`out/${name}.acc.wav`),[ref]=readWav(`out/${name}.vox-ref.wav`);
  const duration=state.doc.bars*state.doc.beatsPerBar*60/state.doc.bpm;
  const perSection=[];
  for(let start=0;start<duration;start+=duration/2) perSection.push({start,end:start+duration/2,vocal:levels(vox,start,start+duration/2),acc:levels(acc,start,start+duration/2)});
  const metrics={mixL:levels(L),mixR:levels(R),vocal:levels(vox,0,duration),acc:levels(acc,0,duration),perSection};
  check(`${name}.audio`,metrics.mixL.rmsDb>-40&&metrics.mixL.clipped+metrics.mixR.clipped===0&&perSection.every(s=>s.vocal.rmsDb>-40&&s.acc.rmsDb>-40),metrics);
  check(`${name}.actual-playback`,stats.playback.maxRms>0.001&&stats.playback.elapsedSeconds>=stats.seconds-.05,{playback:stats.playback});
  check(`${name}.soundfont`,stats.soundfont.mode==="soundfont",stats.soundfont);
  // 各8小節区間で、参照とstemが同一時間位置にあることを確かめる。
  const correlations=[];
  for(let start=0;start<duration;start+=duration/2) correlations.push(corr(ref.subarray(Math.floor(start*SR),Math.floor((start+duration/2)*SR)),vox.subarray(Math.floor(start*SR),Math.floor((start+duration/2)*SR))));
  const sync={scheduledDiffMs:Math.abs(stats.scheduled.accStart-stats.scheduled.vocalSongZero)*1000,accOnsetMs:onsetMs(acc),vocalReferenceCorrelations:correlations};
  check(`${name}.sync`,sync.scheduledDiffMs<1&&sync.accOnsetMs<30&&correlations.every(c=>c>.999),sync);
  check(`${name}.phrase-timing`,stats.vocalRender.phraseTimings.length>0&&stats.vocalRender.phraseTimings.every(p=>p.ms>0),stats.vocalRender);
  copyFileSync(`out/${name}.mp3`,`${final}/${name}.mp3`);
  if(i===0) await page.screenshot({path:`${final}/screenshot-main.png`,fullPage:true});
  results.answers.push({name,metrics,sync,browser:stats,doc:state.doc});
 }
} finally {await app.close();writeFileSync("out/e2e-real.json",JSON.stringify(results,null,2));}
process.exit(Object.values(results.checks).every(c=>c.ok)&&results.answers.length===2?0:1);
