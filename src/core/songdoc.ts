// SongDoc（曲データの正本）と、VocaTab の Note・dtm の MML への変換、歌詞の割り当て。
// SPEC §2-1: 変換と歌詞割り当てはここ1か所にまとめる（ブラウザ・MCP サーバー・テストで共有）。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later（LICENSE-POLICY.md）。

export const TPQ = 480; // VocaTab の刻み（4分音符 = 480）
export const DTM_STEPS_PER_BAR = 192; // dtm の 1 小節（4/4）= 192 step → 1 拍 48 step = TPQ/10

export type EffectType = "kero" | "vocoder" | "bitcrusher" | "doubling" | "vocaloid";
export const EFFECT_TYPES: EffectType[] = ["kero", "vocoder", "bitcrusher", "doubling", "vocaloid"];
export const EFFECT_LABELS: Record<EffectType, string> = {
  kero: "ケロケロボイス（ピッチを平らに）",
  vocoder: "ボコーダー",
  bitcrusher: "ビットクラッシャー",
  doubling: "ダブリング",
  vocaloid: "ボカロ風 v2",
};

export interface Effect {
  type: EffectType;
  /** 強度 0〜1 */
  amount: number;
}

export interface VocalNote {
  bar: number; // 1 始まり
  beat: number; // 1 始まり、小数可（1.5 = 1 拍目の裏）
  len: string; // 音価: "4"=4分, "8."=付点8分, "8t"=3連8分, "2+8"=タイ
  pitch: string; // "G4", "C#5", "Bb3"
  lyric?: string; // かな 1 モーラ（"ー" は伸ばし）
}

export interface VocalTrack {
  id: string;
  kind: "vocal";
  engine?: "vocatab";
  singer?: string; // "ritsu" | "natsume" | "oniku"
  notes: VocalNote[];
  effects?: Effect[];
  volume?: number; // 0〜1（既定 0.9）
}

export interface InstTrack {
  id: string;
  kind: "inst";
  instrument?: string | number; // GM名、または0始まりのGM番号（0〜127）
  program?: string; // GM 楽器名（dtm の #t<n>inst=）例 "acoustic_grand_piano"
  mml: string; // dtm の MML（このパートだけ。; や @n は書かない）
  volume?: number;
}

export interface DrumTrack {
  id: string;
  kind: "drums";
  pattern: string; // dtm の #drum= パターン名（"8beat" など）
}

export type Track = VocalTrack | InstTrack | DrumTrack;

export interface SongDoc {
  version: 1;
  title?: string;
  bpm: number;
  beatsPerBar: number;
  key?: string;
  bars: number;
  chords?: string;
  tracks: Track[];
}

export interface Problem {
  path: string; // 例 "tracks[0].notes[3].pitch"
  message: string;
}

// ---------------------------------------------------------------- 音価・音名

/** 音価の文字列 → 刻み（TPQ=480）。読めなければ null。 */
export function lenToTicks(len: string): number | null {
  const parts = String(len).trim().split("+");
  let total = 0;
  for (const p of parts) {
    const m = /^(1|2|4|8|16|32|64)(t?)(\.*)$/.exec(p.trim());
    if (!m) return null;
    let t = (TPQ * 4) / Number(m[1]);
    if (m[2]) t = (t * 2) / 3;
    let add = t / 2;
    for (let i = 0; i < m[3].length; i++) {
      t += add;
      add /= 2;
    }
    total += t;
  }
  return Math.round(total);
}

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "G4" → 67（C4 = 60）。読めなければ null。 */
export function pitchToMidi(p: string): number | null {
  const m = /^([A-Ga-g])([#♯b♭]*)(-?\d)$/.exec(String(p).trim());
  if (!m) return null;
  let v = PC[m[1].toUpperCase()];
  for (const c of m[2]) v += c === "#" || c === "♯" ? 1 : -1;
  return (Number(m[3]) + 1) * 12 + v;
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const midiToName = (n: number): string => NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

export function noteOnsetTicks(n: { bar: number; beat: number }, beatsPerBar: number): number {
  return Math.round(((n.bar - 1) * beatsPerBar + (n.beat - 1)) * TPQ);
}

// ---------------------------------------------------------------- 歌詞（モーラ）

const SMALL = new Set("ゃゅょぁぃぅぇぉゎゕゖ".split(""));
const LONG = new Set(["ー", "〜", "~", "-"]);
const SEPARATORS = /[\s、。，．,.!！?？・「」『』()（）]/;

/** カタカナ → ひらがな（VocaTab ではカタカナは無声化の母音を表すので、歌詞はひらがなに揃える）。ー はそのまま。 */
export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * かな文字列 → モーラの列。1モーラ=1音符。拗音（きゃ）は1、ー（〜）は伸ばし1、っ・ん は1モーラ。
 * 空白・句読点は区切りとして捨てる。かな以外の文字は unknown に入れる。
 */
export function splitMorae(text: string): { morae: string[]; unknown: string[] } {
  const s = toHiragana(text);
  const morae: string[] = [];
  const unknown: string[] = [];
  for (const ch of Array.from(s)) {
    if (SEPARATORS.test(ch)) continue;
    if (LONG.has(ch)) {
      morae.push("ー");
    } else if (SMALL.has(ch) && morae.length && /[ぁ-ゖ]$/.test(morae[morae.length - 1]) &&
               morae[morae.length - 1].length === 1) {
      morae[morae.length - 1] += ch;
    } else if (/[ぁ-ゖ]/.test(ch)) {
      morae.push(ch);
    } else {
      unknown.push(ch);
    }
  }
  return { morae, unknown };
}

export interface LyricAssignResult {
  /** 音符ごとの割り当て（音符の並び = 時刻順） */
  assigned: Array<{ index: number; bar: number; beat: number; pitch: string; lyric: string }>;
  morae: number;
  notes: number;
  /** 余ったモーラ（音符が足りない） */
  surplus: string[];
  /** 歌詞が割り当たらなかった音符の数（モーラが足りない） */
  missing: number;
  unknown: string[];
}

/** 歌トラックの音符へ歌詞を1モーラずつ時刻順に配る（音符を書き換える）。過不足は事実として返す。 */
export function assignLyrics(track: VocalTrack, text: string, beatsPerBar: number, fromBar = 1): LyricAssignResult {
  const { morae, unknown } = splitMorae(text);
  const order = track.notes
    .map((n, i) => ({ n, i, t: noteOnsetTicks(n, beatsPerBar) }))
    .filter((x) => x.n.bar >= fromBar)
    .sort((a, b) => a.t - b.t || a.i - b.i);
  const assigned: LyricAssignResult["assigned"] = [];
  order.forEach((x, k) => {
    if (k < morae.length) {
      x.n.lyric = morae[k];
      assigned.push({ index: x.i, bar: x.n.bar, beat: x.n.beat, pitch: x.n.pitch, lyric: morae[k] });
    } else {
      delete x.n.lyric;
    }
  });
  return {
    assigned,
    morae: morae.length,
    notes: order.length,
    surplus: morae.slice(order.length),
    missing: Math.max(0, order.length - morae.length),
    unknown,
  };
}

// ---------------------------------------------------------------- 検査

const VOCAL_RANGE: [number, number] = [pitchToMidi("C3")!, pitchToMidi("C6")!];

export function validateSong(doc: unknown): Problem[] {
  const ps: Problem[] = [];
  const d = doc as SongDoc;
  if (!d || typeof d !== "object") return [{ path: "", message: "SongDoc がオブジェクトではありません" }];
  if (!(typeof d.bpm === "number" && d.bpm >= 30 && d.bpm <= 300)) ps.push({ path: "bpm", message: "bpm は 30〜300 の数" });
  if (!(Number.isInteger(d.beatsPerBar) && d.beatsPerBar >= 1 && d.beatsPerBar <= 12)) {
    ps.push({ path: "beatsPerBar", message: "beatsPerBar は 1〜12 の整数" });
  }
  if (!(Number.isInteger(d.bars) && d.bars >= 1 && d.bars <= 256)) ps.push({ path: "bars", message: "bars は 1〜256 の整数" });
  if (!Array.isArray(d.tracks)) {
    ps.push({ path: "tracks", message: "tracks が配列ではありません" });
    return ps;
  }
  const ids = new Set<string>();
  d.tracks.forEach((t, ti) => {
    const P = `tracks[${ti}]`;
    if (!t || typeof t.id !== "string" || !t.id) ps.push({ path: `${P}.id`, message: "id（文字列）が要ります" });
    else if (ids.has(t.id)) ps.push({ path: `${P}.id`, message: `id "${t.id}" が重複` });
    else ids.add(t.id);
    if (!t || typeof t !== "object") return;
    if (t.kind === "vocal") {
      if (!Array.isArray(t.notes)) {
        ps.push({ path: `${P}.notes`, message: "notes が配列ではありません" });
        return;
      }
      const spans: Array<[number, number, number]> = [];
      t.notes.forEach((n, ni) => {
        const Q = `${P}.notes[${ni}]`;
        if (!n || typeof n !== "object") { ps.push({ path: Q, message: "音符がオブジェクトではありません" }); return; }
        if (!(Number.isInteger(n.bar) && n.bar >= 1 && n.bar <= (d.bars ?? 256))) {
          ps.push({ path: `${Q}.bar`, message: `bar=${n.bar} は 1〜${d.bars} の整数` });
        }
        if (!(typeof n.beat === "number" && n.beat >= 1 && n.beat < (d.beatsPerBar ?? 4) + 1)) {
          ps.push({ path: `${Q}.beat`, message: `beat=${n.beat} は 1 以上 ${(d.beatsPerBar ?? 4) + 1} 未満` });
        }
        const len = lenToTicks(n.len);
        if (len === null) ps.push({ path: `${Q}.len`, message: `len="${n.len}" が読めません（例 "4" "8." "8t" "2+8"）` });
        const midi = pitchToMidi(n.pitch);
        if (midi === null) ps.push({ path: `${Q}.pitch`, message: `pitch="${n.pitch}" が読めません（例 "G4" "C#5"）` });
        else if (midi < VOCAL_RANGE[0] || midi > VOCAL_RANGE[1]) {
          ps.push({ path: `${Q}.pitch`, message: `pitch=${n.pitch} は歌の音域（C3〜C6）の外` });
        }
        if (n.lyric !== undefined) {
          const { morae, unknown } = splitMorae(typeof n.lyric === "string" ? n.lyric : "");
          if (morae.length !== 1 || unknown.length) {
            ps.push({ path: `${Q}.lyric`, message: `lyric="${n.lyric}" は かな1モーラ（または ー）にしてください` });
          }
        } else {
          ps.push({ path: `${Q}.lyric`, message: "lyric がありません（set_lyrics で配るか、かな1モーラを書く）" });
        }
        if (len !== null && Number.isInteger(n.bar) && typeof n.beat === "number") {
          const on = noteOnsetTicks(n, d.beatsPerBar);
          spans.push([on, on + len, ni]);
          if (on + len > d.bars * d.beatsPerBar * TPQ) {
            ps.push({ path: Q, message: `曲の長さ（${d.bars} 小節）からはみ出しています` });
          }
        }
      });
      spans.sort((a, b) => a[0] - b[0]);
      for (let k = 1; k < spans.length; k++) {
        if (spans[k][0] < spans[k - 1][1]) {
          ps.push({ path: `${P}.notes[${spans[k][2]}]`, message: `notes[${spans[k - 1][2]}] と重なっています（歌は単音）` });
        }
      }
      if (t.effects !== undefined && !Array.isArray(t.effects)) ps.push({ path: `${P}.effects`, message: "effects は配列" });
      for (const [ei, e] of (Array.isArray(t.effects) ? t.effects : []).entries()) {
        if (!e || typeof e !== "object") { ps.push({ path: `${P}.effects[${ei}]`, message: "effect がオブジェクトではありません" }); continue; }
        if (!EFFECT_TYPES.includes(e.type)) ps.push({ path: `${P}.effects[${ei}].type`, message: `type は ${EFFECT_TYPES.join("/")}` });
        if (!(typeof e.amount === "number" && e.amount >= 0 && e.amount <= 1)) {
          ps.push({ path: `${P}.effects[${ei}].amount`, message: "amount は 0〜1" });
        }
      }
    } else if (t.kind === "inst") {
      if (t.instrument !== undefined && !(typeof t.instrument === "number" ? Number.isInteger(t.instrument) && t.instrument >= 0 && t.instrument <= 127 : typeof t.instrument === "string" && /^[A-Za-z0-9 _()-]+$/.test(t.instrument))) ps.push({ path: `${P}.instrument`, message: "instrument はGM名または0〜127の番号" });
      if (typeof t.mml !== "string" || !t.mml.trim()) ps.push({ path: `${P}.mml`, message: "mml（文字列）が要ります" });
      else if (/[;@]|(?<![a-gA-G])#/.test(t.mml)) ps.push({ path: `${P}.mml`, message: "mml にはこのパートの音符だけを書く（; @ # は使わない）" });
    } else if (t.kind === "drums") {
      if (typeof t.pattern !== "string" || !t.pattern) ps.push({ path: `${P}.pattern`, message: "pattern（dtm のドラムパターン名）が要ります" });
    } else {
      ps.push({ path: `${P}.kind`, message: `kind は "vocal" "inst" "drums" のどれか（"${(t as Track)?.kind}"）` });
    }
  });
  if (!d.tracks.some((t) => t?.kind === "vocal")) ps.push({ path: "tracks", message: "歌トラック（kind: vocal）がありません" });
  return ps;
}

// ---------------------------------------------------------------- 変換

export interface VtNote {
  id: number;
  onset: number;
  dur: number;
  pitch: number;
  lyric: string;
}

/** SongDoc の歌トラック → VocaTab の Note（TPQ=480、MIDI、かな）。 */
export function toVocaTabNotes(doc: SongDoc, track: VocalTrack): VtNote[] {
  const out: VtNote[] = [];
  track.notes.forEach((n, i) => {
    const len = lenToTicks(n.len);
    const pitch = pitchToMidi(n.pitch);
    if (len === null || pitch === null) return;
    const ly = splitMorae(n.lyric ?? "").morae[0] ?? "ー";
    out.push({ id: i + 1, onset: noteOnsetTicks(n, doc.beatsPerBar), dur: len, pitch, lyric: ly });
  });
  return out.sort((a, b) => a.onset - b.onset);
}

/** dtm のトラック番号（0:melody 1:submelody 2:bass 3:chord 4..）を楽器パートへ割り当てる。 */
export function dtmTrackIndex(doc: SongDoc): Map<string, number> {
  const m = new Map<string, number>();
  let i = 0;
  for (const t of doc.tracks) if (t.kind === "inst") m.set(t.id, i++);
  return m;
}

/** SongDoc → dtm の MML 全体（伴奏パートだけ。歌は VocaTab で別に鳴らす）。 */
export function toDtmMML(doc: SongDoc): string {
  const idx = dtmTrackIndex(doc);
  const decl: string[] = [];
  const drums = doc.tracks.find((t): t is DrumTrack => t.kind === "drums");
  decl.push(`#drum=${drums ? drums.pattern : "none"}`);
  const bodies: string[] = [];
  for (const t of doc.tracks) {
    if (t.kind !== "inst") continue;
    const n = idx.get(t.id)!;
    const instrument = t.instrument ?? t.program;
    if (instrument !== undefined) decl.push(`#t${n}inst=${String(instrument).trim().toLowerCase().replace(/[ -]+/g, "_")}`);
    decl.push(`#t${n}font=FluidR3`);
    const vol = t.volume === undefined ? "" : ` v${Math.round(Math.max(0, Math.min(1, t.volume)) * 127)}`;
    bodies.push(`@${n}${n === 0 ? ` t${doc.bpm}` : ""}${vol} ${t.mml.trim().replace(/\s+/g, " ")}`);
  }
  if (!bodies.length) bodies.push(`@0 t${doc.bpm} r1`);
  return `${decl.join(" ")};\n${bodies.join(";\n")};`;
}

/** 歌トラックの最後の音符の終わり（秒）。 */
export function songSeconds(doc: SongDoc): number {
  return (doc.bars * doc.beatsPerBar * 60) / doc.bpm;
}

export function vocalTrack(doc: SongDoc): VocalTrack | undefined {
  return doc.tracks.find((t): t is VocalTrack => t?.kind === "vocal");
}

export function effectAmount(t: VocalTrack, type: EffectType): number {
  return t.effects?.find((e) => e.type === type)?.amount ?? 0;
}

export function newSong(o: { bpm?: number; beatsPerBar?: number; key?: string; bars?: number; title?: string } = {}): SongDoc {
  return {
    version: 1,
    title: o.title ?? "無題",
    bpm: o.bpm ?? 120,
    beatsPerBar: o.beatsPerBar ?? 4,
    key: o.key ?? "C",
    bars: o.bars ?? 8,
    tracks: [{ id: "vo", kind: "vocal", engine: "vocatab", singer: "ritsu", notes: [], effects: [] }],
  };
}
