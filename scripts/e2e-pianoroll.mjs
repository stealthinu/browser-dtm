import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, finalDir } from "./paths.mjs";
const final = finalDir();
import { openApp } from "./browser.mjs";
import { decodeMp3, levels, corr, readWav } from "./analyze.mjs";
const results = { checks: [] };
const check = (name, ok, detail = {}) => { results.checks.push({ name, ok, ...detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); assert(ok, name); };
const out = n => resolve(ROOT, "out", n);
const { page, close } = await openApp({ port: 5504, log: () => {} });
const song = { version: 1, title: "ピアノロール編集", bpm: 120, beatsPerBar: 4, bars: 2, tracks: [
  { id: "vo", kind: "vocal", singer: "ritsu", notes: [{bar:1,beat:1,len:"8",pitch:"E4",lyric:"さ"},{bar:2,beat:3,len:"4",pitch:"A4",lyric:"ら"}] },
  { id: "pf", kind: "inst", instrument: "Acoustic Grand Piano", mml: "o4 l4 'ceg' r 'ceg' r 'dgb' r 'dgb' r" },
  { id: "ba", kind: "inst", instrument: 33, mml: "o2 l4 c c g c g g d g" },
  { id: "dr", kind: "drums", pattern: "8beat" }
] };
const doc = () => page.evaluate(() => structuredClone(window.app.getDoc()));
const notes = async () => (await doc()).tracks[0].notes;
const point = async (tick, midi) => {
  const l = await page.evaluate(() => window.app.rollLayout()); const b = await page.$eval("#roll", e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,cw:e.width,ch:e.height}; });
  return {x:b.x+(l.left+tick/l.totalTicks*l.width)*b.w/b.cw,y:b.y+(l.top+(l.hi-midi+.5)*l.rowHeight)*b.h/b.ch};
};
const drag = async (a,b) => {await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();};
try {
  check("曲の読み込み", (await page.evaluate(d => window.app.loadDoc(d), song)).problems.length === 0);
  results.before = await page.evaluate(() => window.app.exportAudio({name:"pianoroll-before",toServer:true,stems:true}));
  // 座標は表示から計算し、編集はすべて実際のマウス/キーボードで行う。
  const add=await point(480,60);await page.mouse.click(add.x,add.y);
  let n=(await notes())[2];check("クリック追加・snap1/8",n?.bar===1&&n.beat===2&&n.len==="8"&&n.pitch==="C4",{note:n});
  const moveA=await point(560,60),moveB=await point(1040,67);await drag(moveA,moveB);
  n=(await notes())[2];check("ドラッグ移動・時間と音高",n.beat===3&&n.pitch==="G4",{note:n});
  await page.select("#snap","16");
  const endA=await point(1193,67),endB=await point(1433,67);await drag(endA,endB);
  n=(await notes())[2];check("右端ドラッグで長さ",n.len==="4",{note:n});
  const lyric=await point(1050,67);await page.mouse.click(lyric.x,lyric.y,{count:2});await page.waitForSelector("#noteLyric");
  await page.focus("#noteLyric");await page.keyboard.down("Control");await page.keyboard.press("a");await page.keyboard.up("Control");await page.keyboard.type("きゃ");await page.keyboard.press("Enter");
  n=(await notes())[2];check("かな編集",n.lyric==="きゃ",{note:n});
  await page.keyboard.down("Control");await page.keyboard.press("z");await page.keyboard.up("Control");check("Ctrl+Z",(await notes())[2].lyric==="あ");
  await page.keyboard.down("Control");await page.keyboard.down("Shift");await page.keyboard.press("z");await page.keyboard.up("Shift");await page.keyboard.up("Control");check("Ctrl+Shift+Z",(await notes())[2].lyric==="きゃ");
  await page.mouse.click(lyric.x,lyric.y);await page.keyboard.press("Delete");check("Delete削除",(await notes()).length===2);await page.click("#undo");
  await page.mouse.click(lyric.x,lyric.y);await page.keyboard.press("Backspace");check("Backspace削除",(await notes()).length===2);await page.click("#undo");
  await page.mouse.click(lyric.x,lyric.y,{button:"right"});check("右クリック削除",(await notes()).length===2);await page.click("#undo");
  // 重なり追加は拒否し、SongDocの長さを維持する。
  const blocked=await point(1200,72);await page.mouse.click(blocked.x,blocked.y);check("重なる歌音符を拒否",(await notes()).length===3);
  await page.click("#baseSong");
  const prompt=await page.$eval("#prompt",e=>e.value);results.after=await doc();
  check("現在曲プロンプトへ反映",prompt.includes('"lyric": "きゃ"')&&prompt.includes('"pitch": "G4"'));
  await page.mouse.click(lyric.x,lyric.y);await page.keyboard.press("ArrowRight");
  results.export=await page.evaluate(()=>window.app.exportAudio({name:"pianoroll-edited",toServer:true,stems:true}));
  const [before]=readWav(out("pianoroll-before.vox.wav")),[after]=readWav(out("pianoroll-edited.vox.wav"));
  check("変更後の歌を再合成",Math.abs(corr(before,after))<.99,{correlation:corr(before,after),voice:results.export.vox});
  const [L,R]=decodeMp3(out("pianoroll-edited.mp3"));results.mp3={L:levels(L),R:levels(R)};
  check("編集後Chrome実再生・MP3・clip0",results.export.playback.maxRms>.001&&results.mp3.L.rmsDb> -40&&results.mp3.L.clipped+results.mp3.R.clipped===0&&results.export.vox.rmsDb> -40&&results.export.acc.rmsDb> -40,{mp3:results.mp3,playback:results.export.playback,soundfont:results.export.soundfont});
  mkdirSync(finalDir(),{recursive:true});
  await page.screenshot({path:`${final}/screenshot-pianoroll.png`,fullPage:true});
  copyFileSync(`${final}/screenshot-pianoroll.png`,resolve(ROOT,"docs/evidence/main-v1-m2-pianoroll.png"));
  copyFileSync(out("pianoroll-edited.mp3"),`${final}/pianoroll-edited.mp3`);
} finally {await close();writeFileSync(out("e2e-pianoroll.json"),JSON.stringify(results,null,2));}
