// プロンプトコピペ方式（SPEC §2-3）: LLM に貼るプロンプトを作り、LLM の返答から SongDoc を取り出して検査する。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { EFFECT_TYPES, type Problem, type SongDoc, splitMorae, validateSong, vocalTrack } from "./songdoc";

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

export function buildPrompt(lyrics: string, image: string): string {
  const { morae } = splitMorae(lyrics);
  return `あなたは作曲家です。次の歌詞とイメージで、歌のメロディと伴奏を作ってください。

## 歌詞
${lyrics}
（モーラ数: ${morae.length}。1モーラ = 1音符。拗音「きゃ」は1、「ー」は前の母音を伸ばす1音符、「っ」「ん」も1音符）

## イメージ
${image}

## 返答の形式
次の SongDoc 形式の JSON を 1 つだけ、\`\`\`json ... \`\`\` で囲んで返してください。説明は JSON の外に短く。

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

## 例（2小節）
\`\`\`json
${JSON.stringify(EXAMPLE_DOC, null, 1)}
\`\`\`
`;
}

/** LLM の返答（説明つきのテキストでもよい）から JSON を取り出す。 */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/g;
  const cands: string[] = [];
  for (let m; (m = fence.exec(text));) cands.push(m[1]);
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a >= 0 && b > a) cands.push(text.slice(a, b + 1));
  let lastErr: unknown = null;
  for (const c of cands) {
    try {
      const j = JSON.parse(c);
      if (j && typeof j === "object" && "tracks" in j) return j;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(cands.length ? `JSON が読めません: ${lastErr instanceof Error ? lastErr.message : lastErr}`
                               : "返答に JSON（{ ... }）が見つかりません");
}

export interface ImportResult {
  doc: SongDoc | null;
  problems: Problem[];
  /** 問題があるとき、LLM へ返す修正依頼文 */
  fixRequest: string | null;
}

export function importResponse(text: string, lyrics?: string): ImportResult {
  let doc: SongDoc;
  try {
    doc = extractJson(text) as SongDoc;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { doc: null, problems: [{ path: "", message: msg }], fixRequest: fixRequestText([{ path: "", message: msg }]) };
  }
  if (doc.version === undefined) doc.version = 1;
  const problems = validateSong(doc);
  const v = vocalTrack(doc);
  if (lyrics && v) {
    const want = splitMorae(lyrics).morae.join("");
    const got = v.notes.map((n) => n.lyric ?? "").join("");
    if (want !== got) problems.push({ path: "tracks.vo.notes[].lyric", message: `歌詞が依頼と違います（依頼: ${want} / 返答: ${got}）` });
  }
  if (doc.tracks?.filter((t) => t.kind === "inst" || t.kind === "drums").length < 2) {
    problems.push({ path: "tracks", message: "伴奏パート（inst / drums）を2つ以上にしてください" });
  }
  return { doc, problems, fixRequest: problems.length ? fixRequestText(problems) : null };
}

export function fixRequestText(problems: Problem[]): string {
  return `さきほどの SongDoc に次の問題がありました。直した SongDoc の JSON 全体を \`\`\`json で囲んで返してください。\n\n${
    problems.map((p) => `- ${p.path || "(全体)"}: ${p.message}`).join("\n")}\n`;
}
