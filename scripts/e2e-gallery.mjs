import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openApp } from "./browser.mjs";
import { ROOT, finalDir } from "./paths.mjs";
import { levels } from "./analyze.mjs";
const final=finalDir();
mkdirSync(final,{recursive:true});
const results={checks:{}};
function check(name,ok,detail={}) {results.checks[name]={ok,...detail};console.log(`${ok?"PASS":"FAIL"} ${name} ${JSON.stringify(detail)}`);}
const app=await openApp({port:5505,log:console.log});
try {
 const {page,browser}=app;
 await browser.defaultBrowserContext().overridePermissions("http://127.0.0.1:5505",["clipboard-read","clipboard-write","clipboard-sanitized-write"]);
 await page.goto("http://127.0.0.1:5505/gallery.html",{waitUntil:"load"});
 await page.waitForFunction(()=>window.gallery);
 check("cards",await page.$$eval(".card",els=>els.length)===8);
 for (const [category,count] of [["曲",4],["伴奏",2],["エフェクト",2]]) {
  await page.click(`[data-filter="${category}"]`);
  check(`filter-${category}`,await page.$$eval(".card",els=>els.filter(e=>!e.hidden).length)===count);
 }
 await page.click('[data-filter="すべて"]');
 for(const target of ["claude","chatgpt"]) {
  await page.click(`#hidamari-skip [data-target="${target}"]`);
  await page.waitForFunction(async target=>(await navigator.clipboard.readText()).includes(target==="claude"?"Claude へ":"ChatGPT へ"),{},target);
  const text=await page.evaluate(()=>navigator.clipboard.readText());
  const doc=await page.evaluate(()=>window.gallery.getDoc("hidamari-skip"));
  check(`copy-${target}`,text.includes("## 返答の形式")&&text.includes(JSON.stringify(doc,null,1))&&text.includes("このサンプルを土台に"),{chars:text.length});
  check(`copy-feedback-${target}`,await page.$eval("#hidamari-skip .message",el=>el.textContent)==="コピーしました");
 }
 // UIの▶ボタンを押し、同じ再生ホストが返す録音も検査。
 await page.click("#eight-beat .play");
 await page.waitForFunction(()=>document.getElementById("status").textContent.includes("試聴しました"),{timeout:180000});
 const recorded=await page.evaluate(async()=>{
   const app=await window.gallery.previewHost();
   const rec=await app.play(true);
   return {mix:Array.from(rec.mix[0]),vox:Array.from(rec.vox),acc:Array.from(rec.acc),playback:rec.playback,soundfont:rec.soundfont};
 });
 const metrics={mix:levels(recorded.mix),vox:levels(recorded.vox),acc:levels(recorded.acc),playback:recorded.playback,soundfont:recorded.soundfont};
 results.audio=metrics;
 check("preview-recorded-nonsilent",metrics.mix.rmsDb>-40&&metrics.vox.rmsDb>-40&&metrics.acc.rmsDb>-40&&metrics.mix.clipped===0,metrics);
 check("preview-actual-playback",recorded.playback.maxRms>0.001,recorded.playback);
 check("preview-soundfont",recorded.soundfont?.mode==="soundfont",recorded.soundfont);
 await page.screenshot({path:resolve(final,"screenshot-gallery.png"),fullPage:true});
 await page.click("#hidamari-skip .open");
 await page.waitForFunction(()=>window.app?.getDoc()?.title==="ひだまりスキップ",{timeout:60000});
 check("open-in-app",await page.evaluate(()=>window.app.getDoc().bpm)===140);
} finally {
 await app.close();
 writeFileSync(resolve(ROOT,"out/e2e-gallery.json"),JSON.stringify(results,null,2));
}
process.exit(Object.values(results.checks).every(c=>c.ok)?0:1);
