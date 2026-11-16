// 歌の編集は SongDoc の小節・拍・音価へ戻し、単音の重なりを防ぐ。
import { TPQ, lenToTicks, midiToName, noteOnsetTicks, pitchToMidi, splitMorae, toHiragana, type SongDoc, type VocalNote, vocalTrack } from "./songdoc";
export type Snap = 4 | 8 | 16;
export const snapTicks = (tick: number, snap: Snap) => Math.round(tick / (TPQ * 4 / snap)) * (TPQ * 4 / snap);
export function ticksToPosition(tick: number, beatsPerBar: number) {
  return { bar: Math.floor(tick / (beatsPerBar * TPQ)) + 1, beat: (tick % (beatsPerBar * TPQ)) / TPQ + 1 };
}
export function ticksToLen(ticks: number): string {
  if (!Number.isInteger(ticks) || ticks <= 0) throw new Error("音符の長さは正の整数tickです");
  const choices = ["1", "2", "4", "8", "16", "32", "64"].flatMap(n => [n, n + ".", n + "..", n + "t"]);
  const exact = choices.find(n => lenToTicks(n) === ticks);
  if (exact) return exact;
  // 編集グリッド（120tickの倍数）は通常の音価とタイで表せる。
  const parts: string[] = [];
  let rest = ticks;
  for (const n of ["1", "2", "4", "8", "16", "32", "64"]) {
    const t = lenToTicks(n)!;
    while (rest >= t) { parts.push(n); rest -= t; }
  }
  if (rest) throw new Error("この長さは音価で表せません");
  return parts.join("+");
}
export function noteFromTicks(start: number, duration: number, midi: number, lyric: string, beatsPerBar: number): VocalNote {
  return { ...ticksToPosition(start, beatsPerBar), len: ticksToLen(duration), pitch: midiToName(midi), lyric };
}
export function overlaps(notes: VocalNote[], note: VocalNote, beatsPerBar: number, except = -1) {
  const a = noteOnsetTicks(note, beatsPerBar), b = a + lenToTicks(note.len)!;
  return notes.some((n, i) => i !== except && a < noteOnsetTicks(n, beatsPerBar) + lenToTicks(n.len)! && noteOnsetTicks(n, beatsPerBar) < b);
}
export type NoteEdit = { type: "add"; tick: number; midi: number } | { type: "move"; index: number; tick: number; midi: number } |
  { type: "resize"; index: number; duration: number } | { type: "delete"; index: number } | { type: "lyric"; index: number; lyric: string };
export function editNotes(doc: SongDoc, edit: NoteEdit, snap: Snap): VocalNote[] {
  const notes = structuredClone(vocalTrack(doc)!.notes);
  const max = doc.bars * doc.beatsPerBar * TPQ, grid = TPQ * 4 / snap;
  if (edit.type === "delete") { if (!notes[edit.index]) throw new Error("音符を選択してください"); notes.splice(edit.index, 1); return notes; }
  let candidate: VocalNote, index: number;
  if (edit.type === "add") {
    index = notes.length;
    const start = Math.max(0, Math.min(max - grid, snapTicks(edit.tick, snap)));
    candidate = noteFromTicks(start, grid, Math.max(48, Math.min(84, Math.round(edit.midi))), "あ", doc.beatsPerBar);
  } else {
    index = edit.index;
    if (!notes[index]) throw new Error("音符を選択してください");
    candidate = { ...notes[index] };
    if (edit.type === "move") {
      const start = Math.max(0, Math.min(max - lenToTicks(candidate.len)!, snapTicks(edit.tick, snap)));
      candidate = { ...candidate, ...ticksToPosition(start, doc.beatsPerBar), pitch: midiToName(Math.max(48, Math.min(84, Math.round(edit.midi)))) };
    } else if (edit.type === "resize") {
      const available = max - noteOnsetTicks(candidate, doc.beatsPerBar);
      candidate.len = ticksToLen(Math.min(available, Math.max(grid, snapTicks(edit.duration, snap))));
    } else {
      const lyric = toHiragana(edit.lyric.trim());
      const m = splitMorae(lyric);
      if (m.morae.length !== 1 || m.unknown.length) throw new Error("歌詞はかな1モーラ（きゃ・ーも可）です");
      candidate.lyric = m.morae[0];
    }
  }
  if (overlaps(notes, candidate, doc.beatsPerBar, index)) throw new Error("歌の音符は重ねられません");
  notes[index] = candidate;
  return notes;
}
export class NoteHistory {
  private past: VocalNote[][] = [];
  private future: VocalNote[][] = [];
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  reset() { this.past = []; this.future = []; }
  push(previous: VocalNote[]) { this.past.push(structuredClone(previous)); if (this.past.length > 100) this.past.shift(); this.future = []; }
  undo(current: VocalNote[]) { const n = this.past.pop(); if (!n) return null; this.future.push(structuredClone(current)); return n; }
  redo(current: VocalNote[]) { const n = this.future.pop(); if (!n) return null; this.past.push(structuredClone(current)); return n; }
}
