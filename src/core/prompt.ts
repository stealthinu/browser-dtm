// プロンプトコピペ方式（SPEC §2-3）: LLM に貼るプロンプトを作り、LLM の返答から SongDoc を取り出して検査する。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { EFFECT_TYPES, type Problem, type SongDoc, splitMorae, toHiragana, validateSong, vocalTrack } from "./songdoc";

export const EXAMPLE_DOC: SongDoc = {
  version: 1, title: "例", bpm: 120, beatsPerBar: 4, key: "C", bars: 2, chords: "| C | G |",
  tracks: [
    { id: "vo", kind: "vocal", engine: "vocatab", singer: "ritsu", effects: [],
      notes: [
        { bar: 1, beat: 1, len: "4", pitch: "E4", lyric: "さ" },
        { bar: 1, beat: 2, len: "4", pitch: "G4", lyric: "く" },
        { bar: 1, beat: 3, len: "2", pitch: "A4", lyric: "ら" },
        { bar: 2, beat: 1, len: "2.", pitch: "G4", lyric: "ー" },
      ] },
    { id: "pf", kind: "inst", program: "acoustic_grand_piano", mml: "o4 l4 'ceg' 'ceg' 'ceg' 'ceg' 'dgb' 'dgb' 'dgb' 'dgb'" },
    { id: "ba", kind: "inst", program: "electric_bass_finger", mml: "o2 l4 c c g c g g d g" },
    { id: "dr", kind: "drums", pattern: "8beat" },
  ],
};

export function buildPrompt(lyrics: string, image: string, base?: SongDoc | null): string {
  const { morae } = splitMorae(lyrics);
  return `あなたは作曲家です。次の歌詞とイメージで、歌のメロディと伴奏を作ってください。

## 歌詞
${lyrics}
（モーラ数: ${morae.length}。1モーラ = 1音符。拗音「きゃ」は1、「ー」は前の母音を伸ばす1音符、「っ」「ん」も1音符）

## イメージ
${image}

## 返答の形式
次の SongDoc 形式の JSON を 1 つだけ、\`\`\`json ... \`\`\` で囲んで返してください。返答は \`\`\`json フェンス1つに SongDoc 全体だけを返す。MML も JSON の文字列フィールド mml に入れる。外部ツールやファイル操作は不要、返答テキストだけを生成する。

- bpm, beatsPerBar(4), key, bars（小節数）, chords（"| C | G | Am | F |" の形、任意）
- 歌トラック: {"id":"vo","kind":"vocal","singer":"ritsu","effects":[],"notes":[...]}
  - 音符: {"bar":小節(1始まり),"beat":拍(1始まり、小数可。1.5 = 1拍目の裏),"len":音価,"pitch":音名,"lyric":かな1モーラ}
  - 音価: "1"=全 "2"=2分 "4"=4分 "8"=8分 "16"=16分。付点は "4." 、3連は "8t"、タイは "2+8"
  - 音名: "C4"=ド（中央）〜。歌の音域は C3〜C6（女声なら A3〜E5 が歌いやすい）。音符は重ねない（単音）
  - 歌詞はひらがな。音符の数 = モーラの数にする
  - effects: [{"type": ${EFFECT_TYPES.map((t) => `"${t}"`).join("|")}, "amount": 0〜1}]（任意）
- 伴奏パート（2つ以上）: {"id":"pf","kind":"inst","program":GM楽器名,"mml":"このパートの MML"}
  - MML は dtm（onjmin/dtm）の記法: o<n> オクターブ（o4 の c = 中央のド）、l<n> 既定の音価、c d e f g a b、
    # / + でシャープ、- でフラット、数字で音価（c8 c4. c2）、r 休符、> < でオクターブ上下、'ceg' で和音（和音の中で > < は使わない）
  - ; @ # は書かない（パートの区切りと宣言はアプリが付ける）。各パートの長さを bars 小節ぴったりにする
  - program の例: acoustic_grand_piano, electric_piano_1, electric_bass_finger, acoustic_guitar_nylon, string_ensemble_1
- ドラム（任意）: {"id":"dr","kind":"drums","pattern":"8beat"}（4beat, 8beat, 16beat, shuffle, dance, bossa, disco など）

${base ? `## 今の曲を土台にする\n${JSON.stringify(base, null, 1)}\n` : ""}

## 例（2小節）
\`\`\`json
${JSON.stringify(EXAMPLE_DOC, null, 1)}
\`\`\`
`;
}

export interface ImportResult {
  doc: SongDoc | null;
  problems: Problem[];
  repairs: string[];
  fixRequest: string | null;
}

// JSON 文字列の中（URL や MML の和音）を壊さずに軽微な崩れだけを修復する。
function repairJson(source: string): { text: string; repairs: string[] } {
  const repairs = new Set<string>();
  let s = source.replace(/[！-～]/g, (c) => {
    repairs.add("全角英数字・記号を半角へ変換");
    return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
  }).replace(/\u3000/g, " ");
  let out = "", quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") { out += c + (s[++i] ?? ""); continue; }
      if (c === quote || (quote === "”" && c === "“") || (quote === "’" && c === "‘")) {
        out += '"'; quote = "";
      } else out += c === '"' ? '\\"' : c;
    } else if (c === '"' || c === "“" || c === "”" || c === "‘" || c === "’") {
      quote = c === '"' ? '"' : /[“”]/.test(c) ? "”" : "’";
      if (c !== '"') repairs.add("スマートクォートを JSON の引用符へ変換");
      out += '"';
    } else if (c === "/" && s[i + 1] === "/") {
      repairs.add("// コメントを除去");
      while (i < s.length && s[i] !== "\n") i++;
      out += "\n";
    } else if (c === "," && /^\s*[}\]]/.test(s.slice(i + 1))) {
      repairs.add("末尾カンマを除去");
    } else out += c;
  }
  // コメントを取り除いた後に残る末尾カンマも、文字列の外だけで再処理。
  if (out !== s && /,\s*[}\]]/.test(out)) {
    const again = stripTrailing(out);
    if (again !== out) repairs.add("末尾カンマを除去");
    out = again;
  }
  return { text: out, repairs: [...repairs] };
}
function stripTrailing(s: string): string {
  let q = false, out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q && c === "\\") { out += c + s[++i]; continue; }
    if (c === '"') q = !q;
    if (!q && c === "," && /^\s*[}\]]/.test(s.slice(i + 1))) continue;
    out += c;
  }
  return out;
}

function jsonCandidates(text: string): string[] {
  const cands: string[] = [text.trim()];
  for (const m of text.matchAll(/```([^\n`]*)\n?([\s\S]*?)```/g)) {
    if (/^(json)?\s*$/i.test(m[1])) cands.push(m[2]);
  }
  // 前後の説明に { } があっても、独立した各オブジェクトを候補にする。
  const normalized = repairJson(text).text;
  let depth = 0, start = 0, q = false;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (q && c === "\\") { i++; continue; }
    if (c === '"' && depth) q = !q;
    if (q) continue;
    if (c === "{") { if (!depth) start = i; depth++; }
    if (c === "}" && depth && --depth === 0) cands.push(normalized.slice(start, i + 1));
  }
  // 裸の JSON の修復履歴を保つ。
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) cands.unshift(text.slice(a, b + 1));
  return cands;
}
function extract(text: string): { doc: any; repairs: string[] } {
  let best: { doc: any; repairs: string[]; size: number } | null = null;
  let lastErr = "SongDoc がありません";
  for (const c of jsonCandidates(text)) {
    const r = repairJson(c);
    try {
      const doc = JSON.parse(r.text);
      if (!doc || !Array.isArray(doc.tracks)) continue;
      const size = JSON.stringify(doc).length;
      if (!best || size > best.size) best = { doc, repairs: r.repairs, size };
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
  }
  if (!best) throw new Error(`JSON が読めません: ${lastErr}`);
  return best;
}
export function extractJson(text: string): unknown { return extract(text).doc; }

function normalize(doc: any, text: string, repairs: string[]) {
  const fix = (o: any, key: string, value: any, label: string) => {
    if (o[key] !== value) { o[key] = value; repairs.push(label); }
  };
  if (doc.version === undefined) fix(doc, "version", 1, "version: 1 を補完");
  for (const k of ["bpm", "beatsPerBar", "bars"]) {
    if (typeof doc[k] === "string" && doc[k].trim() && Number.isFinite(Number(doc[k]))) fix(doc, k, Number(doc[k]), `${k} を数値へ変換`);
  }
  for (const t of doc.tracks) {
    if (!t || typeof t !== "object") continue;
    for (const k of ["effects", "singer", "engine", "program", "volume"]) {
      if (t[k] === "" || t[k] === null) { delete t[k]; repairs.push(`${t.id}.${k}: 空の任意フィールドを省略`); }
    }
    if (t.kind !== "vocal") continue;
    if (Array.isArray(t.notes)) for (const [i, n] of t.notes.entries()) {
      if (!n || typeof n !== "object") continue;
      const loc = `${t.id}.notes[${i}]`;
      for (const k of ["bar", "beat"]) if (typeof n[k] === "string" && n[k].trim() && Number.isFinite(Number(n[k]))) fix(n, k, Number(n[k]), `${loc}.${k} を数値へ変換`);
      if (typeof n.len === "number") fix(n, "len", String(n.len), `${loc}.len を文字列へ変換`);
      if (typeof n.pitch === "string") {
        const p = n.pitch.trim().replace(/^([a-g])/, (c: string) => c.toUpperCase()).replace(/♯/g, "#").replace(/♭/g, "b");
        fix(n, "pitch", p, `${loc}.pitch の音名表記を正規化`);
      }
      if (typeof n.lyric === "string") fix(n, "lyric", toHiragana(n.lyric), `${loc}.lyric をひらがなへ変換`);
    }
    if (Array.isArray(t.effects)) t.effects = t.effects.filter((e: any) => {
      if (!e || !EFFECT_TYPES.includes(e.type)) { repairs.push(`${t.id}: 未知の effect '${e?.type}' を無視`); return false; }
      const a = Number(e.amount);
      if (Number.isFinite(a)) fix(e, "amount", Math.max(0, Math.min(1, a)), `${t.id}.${e.type}.amount を 0〜1 の数へ補正`);
      return true;
    });
  }
  const inst = doc.tracks.filter((t: any) => t?.kind === "inst");
  let next = 0;
  for (const m of text.matchAll(/```mml([^\n`]*)\n([\s\S]*?)```/gi)) {
    const body = m[2].trim();
    // #t1 / パート名 / フェンス順。#tN の番号は dtm と同じ 0 始まり。
    const chunks = body.split(/(?=^\s*#t\d+\b|^\s*@\d+\b|^\s*[\w-]+\s*:)/m).filter((x) => x.trim());
    for (let chunk of chunks) {
      const tag = /^(?:\s*(?:#t|@)(\d+)\b|\s*([\w-]+)\s*:)/.exec(chunk);
      const label = m[1].trim() || tag?.[2];
      const target = (label ? inst.find((t: any) => t.id === label || t.name === label) : undefined)
        ?? (tag?.[1] ? inst[Number(tag[1])] : undefined) ?? inst[next++];
      chunk = chunk.replace(/^\s*(?:#t\d+|@\d+|[\w-]+\s*:)\s*/, "").replace(/;\s*$/, "").trim();
      if (target && !target.mml?.trim() && chunk) { target.mml = chunk; repairs.push(`${target.id}: 別の MML フェンスから伴奏を補完`); }
    }
  }
}

export function importResponse(text: string, lyrics?: string): ImportResult {
  let doc: SongDoc;
  let repairs: string[] = [];
  try {
    const r = extract(text); doc = r.doc; repairs = r.repairs;
    normalize(doc, text, repairs);
  } catch (e) {
    const problems = [{ path: "", message: e instanceof Error ? e.message : String(e) }];
    return { doc: null, repairs, problems, fixRequest: fixRequestText(problems) };
  }
  const problems = validateSong(doc);
  const v = vocalTrack(doc);
  if (lyrics && v && Array.isArray(v.notes)) {
    const want = splitMorae(lyrics).morae.join("");
    const got = v.notes.map((n) => n?.lyric ?? "").join("");
    if (want !== got) problems.push({ path: "tracks.vo.notes[].lyric", message: `歌詞が依頼と違います（依頼: ${want} / 返答: ${got}）` });
  }
  if (doc.tracks.filter((t) => t?.kind === "inst" || t?.kind === "drums").length < 2) problems.push({ path: "tracks", message: "伴奏パート（inst / drums）を2つ以上にしてください" });
  // 構造の path は機械向けに残し、メッセージには人が読める小節・拍を添える。
  for (const p of problems) {
    const m = /^tracks\[(\d+)\]\.notes\[(\d+)\]/.exec(p.path);
    const n = m && (doc.tracks[Number(m[1])] as any)?.notes?.[Number(m[2])];
    if (n) p.message = `歌 ${n.bar}小節目 ${n.beat}拍目: ${p.message}`;
  }
  return { doc, repairs: [...new Set(repairs)], problems, fixRequest: problems.length ? fixRequestText(problems) : null };
}
export function fixRequestText(problems: Problem[]): string {
  return `さきほどの SongDoc に次の問題がありました。MML も含む、直した SongDoc の JSON 全体を \`\`\`json フェンス1つで返してください。\n\n${problems.map((p) => `- ${p.path || "(全体)"}: ${p.message}`).join("\n")}\n`;
}
