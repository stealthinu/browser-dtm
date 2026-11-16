import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt, EXAMPLE_DOC, importResponse } from "../src/core/prompt";
const doc = () => structuredClone(EXAMPLE_DOC) as any;
const json = () => JSON.stringify(doc());
const good = (text: string) => { const r = importResponse(text); assert.deepEqual(r.problems, []); assert.ok(r.doc); return r; };
test("裸の JSON", () => good(json()));
test("説明文と JSON フェンス", () => good(`曲です。\n\`\`\`json\n${json()}\n\`\`\`\n以上です。`));
test("JSON 大文字フェンス", () => good(`\`\`\`JSON\n${json()}\n\`\`\``));
test("無印フェンス", () => good(`\`\`\`\n${json()}\n\`\`\``));
test("複数フェンスから最大 SongDoc を選ぶ", () => {
 const d = doc(); d.title = "長いほうの完成曲";
 assert.equal(good(`\`\`\`json\n${json()}\n\`\`\`\n\`\`\`json\n${JSON.stringify(d)}\n\`\`\``).doc!.title, d.title);
});
test("末尾カンマを修復", () => assert.ok(good(json().replace(/}$/, ',}')).repairs.length));
test("// コメントを除去、文字列内の URL は保存", () => {
 const d = doc(); d.title = "https://example.test/a,}";
 assert.equal(good(JSON.stringify(d).replace('"version":1', '"version":1 // version\n')).doc!.title,d.title);
});
test("コメント後の末尾カンマ", () => good(json().replace(/}$/, ', // fin\n}')));
test("スマートクォートと和音の apostrophe", () => assert.ok(good(json().replace(/"/g, '“')).repairs.length));
test("スマートシングルクォート", () => good(json().replace(/"/g,'‘')));
test("全角英数字・記号", () => {
 const s = json().replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0)+0xfee0));
 assert.ok(good(s).repairs.some(x => x.includes("全角")));
});
test("bar/beat 文字列、len 数値、カタカナ、音名の正規化", () => {
 const d = doc(); Object.assign(d.tracks[0].notes[0],{bar:"1",beat:"1",len:4,pitch:"g♯4",lyric:"サ"});
 const n = (good(JSON.stringify(d)).doc!.tracks[0] as any).notes[0];
 assert.deepEqual(n,{bar:1,beat:1,len:"4",pitch:"G#4",lyric:"さ"});
});
test("フラット、小文字、G#", () => { for(const p of ["Ab3","g4","G#4","C♭4"]) {const d=doc();d.tracks[0].notes[0].pitch=p;good(JSON.stringify(d));} });
test("空 optional・未知 effect・amount のクランプ", () => {
 const d=doc(); d.tracks[0].singer=""; d.tracks[0].effects=[{type:"alien",amount:1},{type:"vocoder",amount:2},{type:"kero",amount:-1}];
 const r=good(JSON.stringify(d)); assert.equal((r.doc!.tracks[0] as any).effects[0].amount,1);assert.ok(r.repairs.length>=4);
});
test("別 MML フェンスを #t1 / 名 / 順番で割当", () => {
 for(const mode of ["number","name","order"]) {
 const d=doc(); for(const t of d.tracks) if(t.kind==="inst") delete t.mml;
 const a= mode==="number" ? "#t0 o4 c1\n#t1 o2 g1" : mode==="name" ? "pf: o4 c1\nba: o2 g1" : "o4 c1";
 const extra = mode==="order" ? "\n```mml\no2 g1\n```" : "";
 const r=good(`\`\`\`json\n${JSON.stringify(d)}\n\`\`\`\n\`\`\`mml\n${a}\n\`\`\`${extra}`);
 assert.equal((r.doc!.tracks[2] as any).mml,"o2 g1");
 }
});
test("不正音名の場所と修正依頼", () => {
 const d=doc();d.tracks[0].notes[0].pitch="H4";
 const r=importResponse(JSON.stringify(d));assert.match(r.fixRequest!,/歌 1小節目 1拍目.*H4/);assert.match(r.problems[0].path,/notes\[0\].pitch/);
});
test("null 音符・track・effects にも例外を投げない", () => {
 for(const field of ["note","track","effects"]) {const d=doc(); if(field==="note") d.tracks[0].notes=[null];if(field==="track") d.tracks.push(null);if(field==="effects") d.tracks[0].effects={};assert.ok(importResponse(JSON.stringify(d)).problems.length);}
});
test("プロンプトは要望・仕様・現在曲を含む", () => {
 const p=buildPrompt("さくら","BPM100 の静かな曲",doc()); for(const s of ["さくら","BPM100","今の曲を土台","vocaloid","MML も JSON"]) assert.ok(p.includes(s));
});
