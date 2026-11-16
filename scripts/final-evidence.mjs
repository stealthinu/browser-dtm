// 最終フォルダの全MP3をffmpegでデコードし、両ch全サンプルを計測する。
import { readdirSync, readFileSync, writeFileSync, statSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeMp3, SR } from "./analyze.mjs";
const final="/workspace/browser-dtm-final";
const sha=path=>createHash("sha256").update(readFileSync(path)).digest("hex");
const verification=JSON.parse(readFileSync("out/final-verification.json","utf8"));
if (verification.length !== 11 || verification.some(r => r.code !== 0)) throw new Error("最終検証11コマンドの成功を先に確認してください");
const testStart=Date.parse(verification[0].start);
const audio=[];
for(const file of readdirSync(final).filter(f=>f.endsWith(".mp3")).sort()) {
 const path=`${final}/${file}`;
 const channels=decodeMp3(path);
 let sum=0,peak=0,clipped=0,samples=0;
 for(const channel of channels) for(const sample of channel) {sum+=sample*sample;peak=Math.max(peak,Math.abs(sample));if(Math.abs(sample)>=.999) clipped++;samples++;}
 const db=x=>x>0?+(20*Math.log10(x)).toFixed(2):-999;
 audio.push({file,seconds:+(channels[0].length/SR).toFixed(3),rmsDb:db(Math.sqrt(sum/samples)),peakDb:db(peak),clipped,samples,bytes:statSync(path).size,sha256:sha(path),mtime:statSync(path).mtime.toISOString()});
}
const screenshots=["main","pianoroll","gallery"].map(name=>{
 const path=`${final}/screenshot-${name}.png`;
 copyFileSync(path,`docs/evidence/main-v1-m3-${name}.png`);
 return {path,bytes:statSync(path).size,mtime:statSync(path).mtime.toISOString(),fresh:statSync(path).mtimeMs>=testStart,sha256:sha(path)};
});
const json=file=>JSON.parse(readFileSync(`out/${file}`,"utf8"));
const results={verification,audio,screenshots,base:json("e2e.json"),fx:json("e2e-fx.json"),llm:json("e2e-llm.json"),soundfont:json("e2e-soundfont.json"),pianoroll:json("e2e-pianoroll.json"),gallery:json("e2e-gallery.json"),real:json("e2e-real.json"),mcp:json("mcp-smoke-result.json")};
writeFileSync("docs/evidence/main-v1-m3.json",JSON.stringify(results,null,2)+"\n");
const table=["| MP3 | 秒 | RMS dBFS | peak dBFS | clip数（両ch） |","|---|---:|---:|---:|---:|",...audio.map(a=>`| ${a.file} | ${a.seconds} | ${a.rmsDb} | ${a.peakDb} | ${a.clipped} |`)];
writeFileSync("out/final-audio-table.md",table.join("\n")+"\n");
console.log(table.join("\n"));
console.log("screenshots",JSON.stringify(screenshots));
process.exit(audio.length>0&&audio.every(a=>a.rmsDb>-40&&a.clipped===0)&&screenshots.every(s=>s.fresh)?0:1);
