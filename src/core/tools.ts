// LLM 向けの道具（SPEC §2-2、設計メモ (c)）。SongDoc への純粋な操作で、ブラウザ・MCP サーバー・テストで共有する。
// 道具は事実（過不足・音域外・エラー位置）だけを返し、点数は返さない。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import {
  assignLyrics, DTM_STEPS_PER_BAR, type Effect, EFFECT_TYPES, type InstTrack, lenToTicks, midiToName, newSong,
  noteOnsetTicks, pitchToMidi, type SongDoc, TPQ, toDtmMML, type Track, validateSong, type VocalNote, type VocalTrack,
} from "./songdoc";

/** dtm の parseMML（注入する。ブラウザでは import、Node では Worker を仮に置いてから import） */
export type MmlParser = (mml: string) => {
  placements: Array<{ trackIndex: number; startStep: number; durationSteps: number; pitchUnits: number }>;
  bpm?: number;
};

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const num = (description: string) => ({ type: "number", description });

export const TOOL_DEFS: ToolDef[] = [
  { name: "get_song", description: "曲（SongDoc）を返す。part=summary で要約、full で全体。",
    inputSchema: { type: "object", properties: { part: { type: "string", enum: ["summary", "full"] } } } },
  { name: "new_song", description: "空の曲を作る（歌トラック vo だけ）。",
    inputSchema: { type: "object", properties: { bpm: num("テンポ"), beatsPerBar: int("拍子（既定4）"), key: str("調"),
                                                 bars: int("小節数"), title: str("題") } } },
  { name: "set_chords", description: "和音進行を記録する（例 \"| C | G | Am | F |\"）。小節ごとの表を返す。",
    inputSchema: { type: "object", required: ["progression"], properties: { progression: str("| で区切った和音") } } },
  { name: "set_track_notes", description: "歌トラックの音符を置く。fromBar〜toBar の既存の音符は消して置き換える。位置は小節・拍（1始まり、小数可）・音価（\"4\" \"8.\" \"8t\" \"2+8\"）・音名（\"G4\"）。",
    inputSchema: { type: "object", required: ["notes"], properties: {
      trackId: str("歌トラックの id（既定 vo）"), fromBar: int("置き換える最初の小節"), toBar: int("置き換える最後の小節"),
      notes: { type: "array", items: { type: "object", required: ["bar", "beat", "len", "pitch"], properties: {
        bar: int("小節"), beat: num("拍"), len: str("音価"), pitch: str("音名"), lyric: str("かな1モーラ（任意）") } } } } } },
  { name: "set_lyrics", description: "歌トラックにかなの歌詞を流し込む。1モーラ=1音符（拗音は1、ー は伸ばし、っ・ん は1モーラ）。過不足を返す。",
    inputSchema: { type: "object", required: ["text"], properties: { trackId: str("歌トラックの id（既定 vo）"),
                                                                     text: str("ひらがな。空白・改行は区切り"), fromBar: int("最初の小節") } } },
  { name: "set_track_mml", description: "伴奏パートを dtm の MML で書く（このパートの音符だけ。; @ # は使わない）。無ければ作る。パース結果（音符数、長さ、音域）を返す。",
    inputSchema: { type: "object", required: ["trackId", "mml"], properties: {
      trackId: str("パートの id（例 pf, ba）"), mml: str("MML 例: o4 l4 'ceg' 'ceg' 'dfa' 'dfa'"),
      program: str("GM 楽器名（例 acoustic_grand_piano, electric_bass_finger）") } } },
  { name: "set_drums", description: "ドラムパターンを決める（dtm の #drum= 名。例 8beat, 16beat, 4beat, shuffle, dance, bossa, disco, none）。",
    inputSchema: { type: "object", required: ["pattern"], properties: { pattern: str("パターン名") } } },
  { name: "set_effects", description: "歌のエフェクト（kero=ケロケロボイス, vocoder=ボコーダー, bitcrusher=ビットクラッシャー, doubling=ダブリング）と強度 0〜1。",
    inputSchema: { type: "object", required: ["effects"], properties: { trackId: str("歌トラックの id（既定 vo）"),
      effects: { type: "array", items: { type: "object", required: ["type", "amount"], properties: {
        type: { type: "string", enum: EFFECT_TYPES }, amount: num("0〜1") } } } } } },
  { name: "set_mix", description: "トラックの音量（0〜1）や歌い手を変える。",
    inputSchema: { type: "object", required: ["trackId"], properties: { trackId: str("トラック id"), volume: num("0〜1"),
                                                                        singer: str("歌い手 ritsu / natsume / oniku") } } },
  { name: "check", description: "曲全体を検査し、問題（場所と内容）を返す。",
    inputSchema: { type: "object", properties: {} } },
  { name: "export", description: "書き出す。format=mp3（既定）/ wav はブラウザ（headless Chrome）で鳴らして録る。json は SongDoc、mml は dtm の MML。",
    inputSchema: { type: "object", properties: { format: { type: "string", enum: ["mp3", "wav", "json", "mml"] },
                                                 name: str("ファイル名（拡張子なし）") } } },
  { name: "finish", description: "作業の終わりを記録する（メモを残す）。",
    inputSchema: { type: "object", properties: { notes: str("メモ") } } },
];

export class SongSession {
  doc: SongDoc;
  finished: string | null = null;
  constructor(doc?: SongDoc, private parseMML?: MmlParser) {
    this.doc = doc ?? newSong();
  }

  private vocal(id?: string): VocalTrack {
    const t = this.doc.tracks.find((x) => x.kind === "vocal" && (!id || x.id === id)) as VocalTrack | undefined;
    if (!t) throw new Error(`歌トラック ${id ?? ""} がありません`);
    return t;
  }

  /** 道具を名前で呼ぶ（返り値は JSON にできる事実）。 */
  call(name: string, a: any = {}): unknown {
    switch (name) {
      case "get_song": return a.part === "full" ? this.doc : this.summary();
      case "new_song": this.doc = newSong(a); return this.summary();
      case "set_chords": {
        this.doc.chords = String(a.progression);
        const bars = this.doc.chords.split("|").map((s) => s.trim()).filter(Boolean);
        return { bars: bars.map((c, i) => ({ bar: i + 1, chord: c })), count: bars.length, songBars: this.doc.bars };
      }
      case "set_track_notes": return this.setNotes(a.trackId, a.notes ?? [], a.fromBar, a.toBar);
      case "set_lyrics": {
        const t = this.vocal(a.trackId);
        return assignLyrics(t, String(a.text ?? ""), this.doc.beatsPerBar, a.fromBar ?? 1);
      }
      case "set_track_mml": return this.setMml(a.trackId, String(a.mml ?? ""), a.program);
      case "set_drums": {
        this.doc.tracks = this.doc.tracks.filter((t) => t.kind !== "drums");
        if (a.pattern && a.pattern !== "none") this.doc.tracks.push({ id: "dr", kind: "drums", pattern: String(a.pattern) });
        return { pattern: a.pattern ?? "none" };
      }
      case "set_effects": {
        const t = this.vocal(a.trackId);
        t.effects = (a.effects as Effect[]).map((e) => ({ type: e.type, amount: Math.max(0, Math.min(1, Number(e.amount))) }));
        return { effects: t.effects, problems: validateSong(this.doc).filter((p) => p.path.includes("effects")) };
      }
      case "set_mix": {
        const t = this.doc.tracks.find((x) => x.id === a.trackId);
        if (!t) throw new Error(`トラック ${a.trackId} がありません`);
        if (a.volume !== undefined && t.kind !== "drums") t.volume = Math.max(0, Math.min(1, Number(a.volume)));
        if (a.singer && t.kind === "vocal") t.singer = String(a.singer);
        return { track: t.id, volume: (t as any).volume, singer: (t as any).singer };
      }
      case "check": return { problems: validateSong(this.doc) };
      case "finish": this.finished = String(a.notes ?? ""); return { finished: true };
      default: throw new Error(`道具 ${name} はありません`);
    }
  }

  summary(): unknown {
    const d = this.doc;
    return {
      title: d.title, bpm: d.bpm, beatsPerBar: d.beatsPerBar, key: d.key, bars: d.bars, chords: d.chords,
      tracks: d.tracks.map((t) =>
        t.kind === "vocal" ? { id: t.id, kind: t.kind, singer: t.singer, notes: t.notes.length,
                               lyrics: t.notes.map((n) => n.lyric ?? "?").join(""), effects: t.effects ?? [] }
        : t.kind === "inst" ? { id: t.id, kind: t.kind, program: t.program, mmlChars: t.mml.length }
        : { id: t.id, kind: t.kind, pattern: t.pattern }),
      problems: validateSong(d).length,
    };
  }

  private setNotes(trackId: string | undefined, notes: VocalNote[], fromBar?: number, toBar?: number): unknown {
    const t = this.vocal(trackId);
    const lo = fromBar ?? Math.min(...notes.map((n) => n.bar), Infinity);
    const hi = toBar ?? Math.max(...notes.map((n) => n.bar), -Infinity);
    const kept = Number.isFinite(lo) ? t.notes.filter((n) => n.bar < lo || n.bar > hi) : t.notes;
    const removed = t.notes.length - kept.length;
    t.notes = [...kept, ...notes.map((n) => ({ bar: n.bar, beat: n.beat, len: String(n.len), pitch: String(n.pitch),
                                                ...(n.lyric ? { lyric: n.lyric } : {}) }))];
    t.notes.sort((a, b) => noteOnsetTicks(a, this.doc.beatsPerBar) - noteOnsetTicks(b, this.doc.beatsPerBar));
    const songEnd = this.doc.bars * this.doc.beatsPerBar * TPQ;
    const outside = notes.filter((n) => {
      const l = lenToTicks(n.len);
      return l !== null && noteOnsetTicks(n, this.doc.beatsPerBar) + l > songEnd;
    }).length;
    const problems = validateSong(this.doc).filter((p) => p.path.startsWith(`tracks[${this.doc.tracks.indexOf(t)}]`) &&
                                                          !p.message.startsWith("lyric がありません"));
    return { placed: notes.length, removed, total: t.notes.length, outsideSong: outside, problems };
  }

  private setMml(trackId: string, mml: string, program?: string): unknown {
    let t = this.doc.tracks.find((x) => x.id === trackId) as InstTrack | undefined;
    if (t && t.kind !== "inst") throw new Error(`${trackId} は伴奏パートではありません`);
    if (!t) {
      t = { id: trackId, kind: "inst", mml };
      this.doc.tracks.push(t);
    }
    t.mml = mml;
    if (program) t.program = program;
    return this.mmlFacts(t);
  }

  /** パートの MML のパース結果（事実だけ）。 */
  mmlFacts(t: InstTrack): unknown {
    const problems = validateSong(this.doc).filter((p) => p.path.startsWith(`tracks[${this.doc.tracks.indexOf(t)}]`));
    if (!this.parseMML || problems.length) return { track: t.id, problems };
    try {
      const r = this.parseMML(`@0 t${this.doc.bpm} ${t.mml};`);
      const ps = r.placements;
      const stepsPerBar = (DTM_STEPS_PER_BAR * this.doc.beatsPerBar) / 4;
      const end = ps.reduce((m, p) => Math.max(m, p.startStep + p.durationSteps), 0);
      const midis = ps.map((p) => p.pitchUnits / 31);
      return {
        track: t.id, notes: ps.length, lengthBars: +(end / stepsPerBar).toFixed(3), songBars: this.doc.bars,
        overBars: +Math.max(0, end / stepsPerBar - this.doc.bars).toFixed(3),
        underBars: +Math.max(0, this.doc.bars - end / stepsPerBar).toFixed(3),
        lowest: midis.length ? midiToName(Math.round(Math.min(...midis))) : null,
        highest: midis.length ? midiToName(Math.round(Math.max(...midis))) : null,
        problems: ps.length ? [] : [{ path: `${t.id}.mml`, message: "音符が1つも読めませんでした" }],
      };
    } catch (e) {
      return { track: t.id, problems: [{ path: `${t.id}.mml`, message: e instanceof Error ? e.message : String(e) }] };
    }
  }

  mml(): string {
    return toDtmMML(this.doc);
  }
}

export { pitchToMidi, type Track };
