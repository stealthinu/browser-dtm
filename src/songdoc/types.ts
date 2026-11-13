/** SongDoc: 曲データの正本（SPEC §2.1） */

export type NoteLen =
  | "1"
  | "2"
  | "4"
  | "8"
  | "16"
  | "32"
  | "1."
  | "2."
  | "4."
  | "8."
  | "16."
  | "32."
  | "4t"
  | "8t"
  | "16t"
  | string;

/** 歌ノート: 小節(bar,1始まり)・拍(beat,1始まり小数可)・音価(len)・音名(pitch)・かな(lyric) */
export interface VocalNote {
  bar: number;
  beat: number;
  len: NoteLen;
  pitch: string;
  lyric: string;
}

export interface VocalEffects {
  /** ケロケロボイス（ピッチを平らにする） 0〜1 */
  kerokero?: number;
  /** ボコーダー 0〜1 */
  vocoder?: number;
  /** ビットクラッシャー 0〜1 */
  bitcrusher?: number;
  /** ダブリング 0〜1 */
  doubling?: number;
}

export interface VocalTrack {
  id: string;
  kind: "vocal";
  engine: "vocatab";
  /** leapsinger singer id: 0=くるみ, 1=悠李, 2=リツ */
  singer?: number;
  singerName?: string;
  voicebank?: string;
  notes: VocalNote[];
  effects?: VocalEffects;
  volume?: number;
  pan?: number;
}

export interface InstTrack {
  id: string;
  kind: "inst";
  /** GM 楽器名（dtm #tNinst=） */
  program?: string;
  font?: "FluidR3" | "GeneralUserGS";
  mml: string;
  volume?: number;
}

export interface DrumTrack {
  id: string;
  kind: "drums";
  pattern: string;
  volume?: number;
}

export type SongTrack = VocalTrack | InstTrack | DrumTrack;

export interface SongDoc {
  version: 1;
  title: string;
  bpm: number;
  beatsPerBar: number;
  key: string;
  bars: number;
  chords?: string;
  tracks: SongTrack[];
}

export function isVocalTrack(t: SongTrack): t is VocalTrack {
  return t.kind === "vocal";
}

export function isInstTrack(t: SongTrack): t is InstTrack {
  return t.kind === "inst";
}

export function isDrumTrack(t: SongTrack): t is DrumTrack {
  return t.kind === "drums";
}

export function emptySongDoc(partial: Partial<SongDoc> & Pick<SongDoc, "bpm" | "bars">): SongDoc {
  return {
    version: 1,
    title: partial.title ?? "untitled",
    bpm: partial.bpm,
    beatsPerBar: partial.beatsPerBar ?? 4,
    key: partial.key ?? "C",
    bars: partial.bars,
    chords: partial.chords,
    tracks: partial.tracks ?? [],
  };
}
