import { test } from "node:test";
import assert from "node:assert/strict";
import { editNotes, NoteHistory, noteFromTicks, overlaps, snapTicks, ticksToLen, ticksToPosition } from "../src/core/pianoroll";
import { newSong, lenToTicks, noteOnsetTicks, vocalTrack, validateSong } from "../src/core/songdoc";
test("tickと小節/拍/音価の往復（拍子・付点・3連・タイ）", () => {
  for (const beats of [3,4,7]) for (const tick of [0,120,480,1920,3480]) assert.equal(noteOnsetTicks(ticksToPosition(tick,beats),beats),tick);
  for (const len of ["4","8","16","4.","4..","8t","2+8","1+4+16"]) { const t=lenToTicks(len)!; assert.equal(lenToTicks(ticksToLen(t)),t); }
});
test("1/4・1/8・1/16のsnap", () => { assert.equal(snapTicks(310,4),480); assert.equal(snapTicks(310,8),240); assert.equal(snapTicks(310,16),360); });
test("編集操作→SongDoc、重なりを拒否し、隣接を許可", () => {
  const d=newSong({bars:2}); const v=vocalTrack(d)!;
  v.notes=editNotes(d,{type:"add",tick:0,midi:60},8);
  v.notes=editNotes(d,{type:"move",index:0,tick:530,midi:64},8);
  assert.deepEqual(v.notes[0],{bar:1,beat:2,len:"8",pitch:"E4",lyric:"あ"});
  v.notes=editNotes(d,{type:"resize",index:0,duration:720},8); assert.equal(v.notes[0].len,"4.");
  assert.throws(()=>editNotes(d,{type:"add",tick:720,midi:72},8),/重ね/);
  assert.equal(overlaps(v.notes,noteFromTicks(1200,240,60,"か",4),4),false);
  v.notes=editNotes(d,{type:"lyric",index:0,lyric:"キャ"},8); assert.equal(v.notes[0].lyric,"きゃ");
  assert.throws(()=>editNotes(d,{type:"lyric",index:0,lyric:"かな"},8),/1モーラ/);
  assert.equal(validateSong(d).length,0);
  v.notes=editNotes(d,{type:"delete",index:0},8); assert.equal(v.notes.length,0);
});
test("曲境界・音域・history undo redo・編集でredo消去",()=>{
 const d=newSong({bars:1}),v=vocalTrack(d)!; const h=new NoteHistory();
 h.push(v.notes);v.notes=editNotes(d,{type:"add",tick:9999,midi:120},16);
 assert.equal(v.notes[0].beat,4.75);assert.equal(v.notes[0].pitch,"C6");assert.equal(validateSong(d).length,0);
 v.notes=h.undo(v.notes)!;assert.equal(v.notes.length,0);v.notes=h.redo(v.notes)!;assert.equal(v.notes.length,1);
 h.push(v.notes);v.notes=editNotes(d,{type:"delete",index:0},16);assert.equal(h.canRedo,false);
});
test("GM名/番号と旧programはMMLへ、範囲外番号は検査", async()=>{
 const {toDtmMML}=await import("../src/core/songdoc");const d=newSong();d.tracks.push({id:"pf",kind:"inst",instrument:"Acoustic Grand Piano",mml:"c1"},{id:"ba",kind:"inst",instrument:33,mml:"c1"});
 assert.match(toDtmMML(d),/#t0inst=acoustic_grand_piano/);assert.match(toDtmMML(d),/#t1inst=33/);assert.equal(validateSong(d).length,0);
 (d.tracks[1] as any).instrument=128;assert(validateSong(d).some(p=>p.path.endsWith("instrument")));
});
