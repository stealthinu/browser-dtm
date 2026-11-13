import { describe, expect, it } from "vitest";
import { convertAndCheck, songDocToDtmMml, songDocVocalToVocaTab, applyLyricsToTrack } from "../src/songdoc/convert";
import { assignLyrics, splitMoras } from "../src/songdoc/lyrics";
import { barBeatToTick, lenToBeats, pitchToMidi } from "../src/songdoc/timing";
import { emptySongDoc, type SongDoc } from "../src/songdoc/types";
import { extractSongDocFromText, parseSongDocJson } from "../src/songdoc/validate";
import sample from "../fixtures/sample-songdoc.json";

describe("timing", () => {
  it("lenToBeats", () => {
    expect(lenToBeats("4")).toBe(1);
    expect(lenToBeats("8")).toBe(0.5);
    expect(lenToBeats("8.")).toBe(0.75);
    expect(lenToBeats("4t")).toBeCloseTo(2 / 3);
  });
  it("pitchToMidi", () => {
    expect(pitchToMidi("C4")).toBe(60);
    expect(pitchToMidi("A4")).toBe(69);
    expect(pitchToMidi("G4")).toBe(67);
    expect(pitchToMidi("C#5")).toBe(73);
  });
  it("barBeatToTick 1始まり", () => {
    expect(barBeatToTick(1, 1, 4)).toBe(0);
    expect(barBeatToTick(1, 2, 4)).toBe(480);
    expect(barBeatToTick(2, 1, 4)).toBe(1920);
  });
});

describe("lyrics", () => {
  it("拗音は1モーラ", () => {
    expect(splitMoras("きゃりー").map((m) => m.text)).toEqual(["きゃ", "り", "ー"]);
  });
  it("っ・んは1モーラ、ーは伸ばし", () => {
    const m = splitMoras("がっこうんー");
    expect(m.map((x) => x.text)).toEqual(["が", "っ", "こ", "う", "ん", "ー"]);
    expect(m[1].kind).toBe("mora");
    expect(m[5].kind).toBe("prolong");
  });
  it("過不足を返す", () => {
    const ok = assignLyrics(4, "あいうえ");
    expect(ok.ok).toBe(true);
    expect(ok.assigned).toEqual(["あ", "い", "う", "え"]);
    const extra = assignLyrics(2, "あいう");
    expect(extra.extraMoras).toBe(1);
    expect(extra.leftover).toEqual(["う"]);
    const miss = assignLyrics(3, "あい");
    expect(miss.missingMoras).toBe(1);
  });
});

describe("convert", () => {
  const doc = sample as SongDoc;

  it("SongDoc → VocaTab notes", () => {
    const notes = songDocVocalToVocaTab(doc);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].onset).toBe(0);
    expect(notes[0].pitch).toBe(pitchToMidi(doc.tracks.find((t) => t.kind === "vocal")!.notes[0].pitch));
    expect(notes.every((n) => n.lyric.length > 0)).toBe(true);
  });

  it("SongDoc → dtm MML（2パート以上＋ドラム）", () => {
    const mml = songDocToDtmMml(doc);
    expect(mml).toMatch(/@0 /);
    expect(mml).toMatch(/@1 /);
    expect(mml).toMatch(/#drum=/);
    expect(mml).toMatch(/t120|t\d+/);
  });

  it("convertAndCheck", () => {
    const c = convertAndCheck(doc);
    expect(c.errors).toEqual([]);
    expect(c.instTracks).toBeGreaterThanOrEqual(2);
    expect(c.vocalNotes).toBeGreaterThan(0);
  });

  it("set_lyrics 割り当て", () => {
    const base = emptySongDoc({ bpm: 120, bars: 4 });
    base.tracks = [
      {
        id: "vo",
        kind: "vocal",
        engine: "vocatab",
        notes: [
          { bar: 1, beat: 1, len: "4", pitch: "C4", lyric: "" },
          { bar: 1, beat: 2, len: "4", pitch: "D4", lyric: "" },
          { bar: 1, beat: 3, len: "4", pitch: "E4", lyric: "" },
          { bar: 1, beat: 4, len: "4", pitch: "F4", lyric: "" },
        ],
      },
    ];
    // ゆうやけ = ゆ,う,や,け = 4
    const { doc: next, assign } = applyLyricsToTrack(base, "vo", "ゆうやけ");
    expect(assign.ok).toBe(true);
    expect(assign.missingMoras).toBe(0);
    expect(assign.extraMoras).toBe(0);
    expect((next.tracks[0] as { notes: { lyric: string }[] }).notes.map((n) => n.lyric).join("")).toBe("ゆうやけ");
  });
});

describe("validate / extract", () => {
  it("fixture JSON", () => {
    const v = parseSongDocJson(sample);
    expect(v.ok).toBe(true);
  });
  it("コードフェンスから抽出", () => {
    const text = "はい。\n```json\n" + JSON.stringify(sample) + "\n```\n";
    const { json, error } = extractSongDocFromText(text);
    expect(error).toBeUndefined();
    expect(parseSongDocJson(json).ok).toBe(true);
  });
});
