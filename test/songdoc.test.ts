import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { importResponse } from "../src/core/prompt";
import {
  assignLyrics, lenToTicks, pitchToMidi, splitMorae, toDtmMML, toVocaTabNotes, validateSong, type VocalTrack,
} from "../src/core/songdoc";
import { SongSession } from "../src/core/tools";

(globalThis as any).Worker ??= class { postMessage() {} terminate() {} addEventListener() {} };
const { parseMML } = await import("@onjmin/dtm");

test("音価 → 刻み（TPQ=480）", () => {
  assert.equal(lenToTicks("4"), 480);
  assert.equal(lenToTicks("8"), 240);
  assert.equal(lenToTicks("8."), 360);
  assert.equal(lenToTicks("2."), 1440);
  assert.equal(lenToTicks("4.."), 840);
  assert.equal(lenToTicks("8t"), 160);
  assert.equal(lenToTicks("2+8"), 1200);
  assert.equal(lenToTicks("1"), 1920);
  assert.equal(lenToTicks("3"), null);
  assert.equal(lenToTicks("x"), null);
});

test("音名 → MIDI", () => {
  assert.equal(pitchToMidi("C4"), 60);
  assert.equal(pitchToMidi("A4"), 69);
  assert.equal(pitchToMidi("C#5"), 73);
  assert.equal(pitchToMidi("Bb3"), 58);
  assert.equal(pitchToMidi("H4"), null);
});

test("モーラ分割: 1モーラ=1、拗音は1、ーは伸ばし、っ・ん は1", () => {
  assert.deepEqual(splitMorae("ゆうやけ そらに").morae, ["ゆ", "う", "や", "け", "そ", "ら", "に"]);
  assert.deepEqual(splitMorae("きゃっと").morae, ["きゃ", "っ", "と"]);
  assert.deepEqual(splitMorae("らーめん").morae, ["ら", "ー", "め", "ん"]);
  assert.deepEqual(splitMorae("シャボン").morae, ["しゃ", "ぼ", "ん"]); // カタカナはひらがなに揃える
  assert.deepEqual(splitMorae("ちょっ〜と、ね。").morae, ["ちょ", "っ", "ー", "と", "ね"]);
  assert.deepEqual(splitMorae("あAい").unknown, ["A"]);
});

const track = (n: number): VocalTrack => ({
  id: "vo", kind: "vocal",
  notes: Array.from({ length: n }, (_, i) => ({ bar: 1 + Math.floor(i / 4), beat: 1 + (i % 4), len: "4", pitch: "C4" })),
});

test("歌詞の割り当て: ちょうど", () => {
  const t = track(4);
  const r = assignLyrics(t, "きゃっとー", 4);
  assert.deepEqual(t.notes.map((n) => n.lyric), ["きゃ", "っ", "と", "ー"]);
  assert.equal(r.surplus.length, 0);
  assert.equal(r.missing, 0);
});

test("歌詞の割り当て: 余り（音符が足りない）と不足（モーラが足りない）を返す", () => {
  const t1 = track(3);
  const r1 = assignLyrics(t1, "ゆうやけ", 4);
  assert.deepEqual(r1.surplus, ["け"]);
  assert.equal(r1.missing, 0);
  const t2 = track(5);
  const r2 = assignLyrics(t2, "そらに", 4);
  assert.deepEqual(r2.surplus, []);
  assert.equal(r2.missing, 2);
  assert.equal(t2.notes[4].lyric, undefined);
});

test("歌詞の割り当ては時刻順（音符の並びが前後していても）", () => {
  const t: VocalTrack = { id: "vo", kind: "vocal", notes: [
    { bar: 2, beat: 1, len: "4", pitch: "C4" }, { bar: 1, beat: 1, len: "4", pitch: "C4" } ] };
  assignLyrics(t, "あい", 4);
  assert.equal(t.notes[1].lyric, "あ");
  assert.equal(t.notes[0].lyric, "い");
});

const sample = readFileSync(new URL("../fixtures/sample-response.txt", import.meta.url), "utf8");
const req = JSON.parse(readFileSync(new URL("../fixtures/request.json", import.meta.url), "utf8"));

test("見本返答を取り込める（問題なし）", () => {
  const r = importResponse(sample, req.lyrics);
  assert.deepEqual(r.problems, []);
  assert.equal(r.fixRequest, null);
  assert.ok(r.doc);
});

test("SongDoc → VocaTab Note（TPQ=480、MIDI、かな）", () => {
  const doc = importResponse(sample).doc!;
  const vt = toVocaTabNotes(doc, doc.tracks[0] as VocalTrack);
  assert.equal(vt.length, 12);
  assert.deepEqual(vt[0], { id: 1, onset: 0, dur: 480, pitch: 64, lyric: "ゆ" });
  assert.deepEqual(vt[4], { id: 5, onset: 1920, dur: 480, pitch: 72, lyric: "そ" });
  assert.deepEqual(vt[11], { id: 12, onset: 5760, dur: 1440, pitch: 60, lyric: "く" });
});

test("SongDoc → dtm MML（伴奏2パート＋ドラム、dtm でパースでき、長さが小節数に合う）", () => {
  const doc = importResponse(sample).doc!;
  const mml = toDtmMML(doc);
  assert.match(mml, /#drum=8beat/);
  assert.match(mml, /#t0inst=acoustic_grand_piano/);
  assert.match(mml, /#t1inst=electric_bass_finger/);
  const r = parseMML(mml);
  assert.equal(r.bpm, 120);
  assert.deepEqual([...new Set(r.placements.map((p: any) => p.trackIndex))].sort(), [0, 1]);
  for (const ti of [0, 1]) {
    const end = Math.max(...r.placements.filter((p: any) => p.trackIndex === ti).map((p: any) => p.startStep + p.durationSteps));
    assert.equal(end, 4 * 192, `track ${ti} の長さ`);
  }
});

test("検査: 音域外・読めない音価・重なり・歌詞の過不足を場所つきで返す", () => {
  const doc = importResponse(sample).doc!;
  const v = doc.tracks[0] as VocalTrack;
  v.notes[0].pitch = "C7";
  v.notes[1].len = "3";
  v.notes[2].beat = 1.5; // notes[0] と重なる
  v.notes[3].lyric = "けい";
  const ps = validateSong(doc);
  const paths = ps.map((p) => p.path);
  assert.ok(paths.includes("tracks[0].notes[0].pitch"));
  assert.ok(paths.includes("tracks[0].notes[1].len"));
  assert.ok(paths.includes("tracks[0].notes[2]"));
  assert.ok(paths.includes("tracks[0].notes[3].lyric"));
  const r = importResponse(JSON.stringify(doc), req.lyrics);
  assert.ok(r.fixRequest && r.fixRequest.includes("tracks[0].notes[0].pitch"));
});

test("返答に JSON が無い・壊れているときは修正依頼文を返す", () => {
  assert.ok(importResponse("すみません、作れませんでした").fixRequest);
  assert.ok(importResponse("```json\n{\"tracks\": [ }\n```").fixRequest);
});

test("道具: new_song → set_track_notes → set_lyrics → set_track_mml → check", () => {
  const s = new SongSession(undefined, parseMML);
  s.call("new_song", { bpm: 100, bars: 2 });
  const r1: any = s.call("set_track_notes", { notes: [
    { bar: 1, beat: 1, len: "2", pitch: "G4" }, { bar: 1, beat: 3, len: "2", pitch: "A4" },
    { bar: 2, beat: 1, len: "1", pitch: "G4" } ] });
  assert.equal(r1.placed, 3);
  const r2: any = s.call("set_lyrics", { text: "そらー" });
  assert.equal(r2.missing, 0);
  assert.deepEqual(r2.surplus, []);
  const r3: any = s.call("set_track_mml", { trackId: "pf", mml: "o4 l2 'ceg' 'ceg' 'dgb' 'dgb'", program: "acoustic_grand_piano" });
  assert.equal(r3.notes, 12);
  assert.equal(r3.lengthBars, 2);
  assert.equal(r3.overBars, 0);
  const r4: any = s.call("set_track_mml", { trackId: "ba", mml: "o2 l1 c g c" });
  assert.equal(r4.overBars, 1); // 3小節ぶん → 1小節はみ出し
  s.call("set_drums", { pattern: "8beat" });
  assert.deepEqual((s.call("check") as any).problems, []);
});
