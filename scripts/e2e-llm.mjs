// 購読 LLM の未編集返答を UI へ貼付→自動再生→MP3 ボタンの実ダウンロード。
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { openApp } from "./browser.mjs";
import { corr, decodeMp3, diffDb, levels, readWav } from "./analyze.mjs";
import { ROOT } from "./paths.mjs";
const out = resolve(ROOT,"out"), final = "/workspace/browser-dtm-final";
mkdirSync(out,{recursive:true}); mkdirSync(final,{recursive:true});
const downloads = resolve(out,`llm-downloads-${Date.now()}`); mkdirSync(downloads,{recursive:true});
const requests=JSON.parse(readFileSync(resolve(ROOT,"fixtures/llm-real/requests.json"),"utf8"));
const provenance=JSON.parse(readFileSync(resolve(ROOT,"fixtures/llm-real/provenance.json"),"utf8"));
const results={checks:{},answers:[]};
function check(k,ok,detail) { results.checks[k]={ok,...detail}; console.log(`${ok?"PASS":"FAIL"} ${k} ${JSON.stringify(detail)}`); }
const app=await openApp({port:5502,log:console.log});
try {
 const {page,browser}=app;
 await browser.defaultBrowserContext().overridePermissions("http://127.0.0.1:5502",["clipboard-read","clipboard-write","clipboard-sanitized-write"]);
 const cdp=await page.createCDPSession();
 await cdp.send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:downloads});
 for(let i=1;i<=2;i++) {
  const text=readFileSync(resolve(ROOT,`fixtures/llm-real/answer-${i}.txt`),"utf8"), req=requests[i-1];
  check(`llm${i}.unmodified`,createHash("sha256").update(text).digest("hex")===provenance[i-1].answer_sha256,{job:provenance[i-1].job});
  await page.evaluate(({text,req})=>{document.getElementById("lyrics").value=req.lyrics;document.getElementById("image").value=req.image;document.getElementById("image").dispatchEvent(new Event("input"));document.getElementById("answer").value=text;}, {text,req});
  await page.click("#copyPrompt");
  await page.waitForFunction(async (lyrics)=>(await navigator.clipboard.readText()).includes(lyrics),{},req.lyrics);
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  check(`llm${i}.copy-prompt`,copied.includes(req.lyrics)&&copied.includes(req.image)&&copied.includes("MML も JSON"),{chars:copied.length});
  await page.click("#load");
  await page.waitForFunction(()=>!document.getElementById("load").disabled,{timeout:120000});
  const state=await page.evaluate(()=>({problems:document.getElementById("problems").textContent,repairs:document.getElementById("repairs").textContent,playing:window.app.isPlaying(),doc:window.app.getDoc(),exportEnabled:!document.getElementById("expMp3").disabled}));
  check(`llm${i}.load-and-play`,state.problems==="問題なし"&&state.playing&&state.exportEnabled,state);
  if(state.problems!=="問題なし"||!state.playing) continue;
  if (i===1) {
    await page.click("#baseSong"); await page.click("#copyPrompt");
    await page.waitForFunction(async ()=>(await navigator.clipboard.readText()).includes("## 今の曲を土台にする"));
    const basePrompt=await page.evaluate(()=>navigator.clipboard.readText());
    check("ui.base-song",basePrompt.includes("今の曲を土台にする")&&basePrompt.includes(state.doc.title),{chars:basePrompt.length});
    await page.click("#baseSong");
  }
  await page.screenshot({path:resolve(final,i===1?"screenshot-main.png":`screenshot-llm-${i}.png`),fullPage:true});
  await page.click("#expMp3");
  await page.waitForFunction(()=>document.getElementById("status").textContent.startsWith("書き出し完了"),{timeout:120000});
  const download=resolve(downloads,`${state.doc.title||"song"}.mp3`);
  // Chrome の download 完了を条件待ち。固定の長時間待機はしない。
  for(let attempt=0;attempt<100&&!existsSync(download);attempt++) await new Promise(r=>setTimeout(r,100));
  check(`llm${i}.mp3-button`,existsSync(download),{download});
  if(!existsSync(download)) continue;
  const s=await page.evaluate(n=>window.app.exportAudio({format:"mp3",name:n,toServer:true,stems:true}),`llm-answer-${i}`);
  check(`llm${i}.actual-playback`,s.playback?.maxRms>0.001 && s.playback.elapsedSeconds>=s.seconds-0.05,{playback:s.playback});
  const target=resolve(out,`llm-answer-${i}.mp3`);
  const [downloadL]=decodeMp3(download), [exportL]=decodeMp3(target);
  const repeat={corr:corr(downloadL,exportL),diffDb:diffDb(downloadL,exportL),bytes:readFileSync(target).length};
  check(`llm${i}.download-matches-export`,repeat.corr>0.999,repeat);
  const [L,R]=decodeMp3(download), [vox]=readWav(resolve(out,`llm-answer-${i}.vox.wav`)), [acc]=readWav(resolve(out,`llm-answer-${i}.acc.wav`));
  const seconds=state.doc.bars*state.doc.beatsPerBar*60/state.doc.bpm;
  const metrics={mixL:levels(L),mixR:levels(R),vocalSection:levels(vox,0,seconds),accSection:levels(acc,0,seconds),seconds};
  check(`llm${i}.audio`,metrics.mixL.rmsDb>-40&&metrics.vocalSection.rmsDb>-40&&metrics.accSection.rmsDb>-40&&metrics.mixL.clipped+metrics.mixR.clipped===0,metrics);
  copyFileSync(download,resolve(final,`llm-answer-${i}.mp3`));
  results.answers.push({i,...metrics,browser:s});
 }
 // エラー表示・修正依頼のコピー内容も UI で確認。
 await page.evaluate(()=>{const d=window.app.getDoc();d.tracks.find(t=>t.kind==="vocal").notes[0].pitch="H4";document.getElementById("answer").value=JSON.stringify(d);});
 await page.click("#load");
 const error=await page.$eval("#fix",e=>e.value);
 check("ui.located-error",/歌 1小節目 1拍目.*H4/.test(error),{fixRequest:error});
 await page.click("#copyFix");
 await page.waitForFunction(async (error)=>(await navigator.clipboard.readText())===error,{},error);
 check("ui.copy-fix",await page.evaluate(()=>navigator.clipboard.readText())===error,{chars:error.length});
} finally { await app.close();writeFileSync(resolve(out,"e2e-llm.json"),JSON.stringify(results,null,2)); }
process.exit(Object.values(results.checks).every(c=>c.ok)&&results.answers.length===2?0:1);
