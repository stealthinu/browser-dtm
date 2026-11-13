/**
 * かな歌詞のモーラ分割と音符への割り当て。
 * 規則（SPEC）: 1モーラ=1音符、拗音は1、`ー` 伸ばし、`っ`・`ん` は1モーラ。過不足を返す。
 */

export interface Mora {
  text: string;
  kind: "mora" | "prolong" | "space";
}

const YOON_SECONDS = new Set([
  "ゃ",
  "ゅ",
  "ょ",
  "ャ",
  "ュ",
  "ョ",
  "ぁ",
  "ぃ",
  "ぅ",
  "ぇ",
  "ぉ",
  "ァ",
  "ィ",
  "ゥ",
  "ェ",
  "ォ",
]);

/** 空白・改行で区切ったかなをモーラ列にする（空白は区切りとして捨てる） */
export function splitMoras(text: string): Mora[] {
  const out: Mora[] = [];
  const cleaned = text.replace(/\s+/g, "");
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "ー" || ch === "〜" || ch === "ｰ" || ch === "-") {
      out.push({ text: "ー", kind: "prolong" });
      continue;
    }
    const next = cleaned[i + 1];
    if (next && YOON_SECONDS.has(next)) {
      out.push({ text: ch + next, kind: "mora" });
      i++;
      continue;
    }
    out.push({ text: ch, kind: "mora" });
  }
  return out;
}

export interface LyricAssignResult {
  /** 音符 index → 割り当てた lyric（伸ばしは ー） */
  assigned: string[];
  /** 余ったモーラ */
  leftover: string[];
  /** 音符が足りない（歌詞が多い） */
  extraMoras: number;
  /** 歌詞が足りない（音符が多い）ときの空き音符数 */
  missingMoras: number;
  ok: boolean;
  summary: string;
}

/**
 * かな文字列を音符列へ割り当てる。
 * prolong（ー）は音符を1つ消費し lyric="ー"。
 * 音符数とモーラ数が一致しないときは過不足を返す（割り当ては可能な範囲まで行う）。
 */
export function assignLyrics(noteCount: number, text: string): LyricAssignResult {
  const moras = splitMoras(text);
  const assigned: string[] = Array.from({ length: noteCount }, () => "");
  const n = Math.min(noteCount, moras.length);
  for (let i = 0; i < n; i++) {
    assigned[i] = moras[i].text;
  }
  const leftover = moras.slice(noteCount).map((m) => m.text);
  const extraMoras = Math.max(0, moras.length - noteCount);
  const missingMoras = Math.max(0, noteCount - moras.length);
  const ok = extraMoras === 0 && missingMoras === 0;
  const parts: string[] = [];
  if (ok) parts.push(`割り当て完了: ${noteCount} 音符`);
  if (extraMoras) parts.push(`余ったモーラ ${extraMoras}: ${leftover.join("")}`);
  if (missingMoras) parts.push(`足りないモーラ ${missingMoras}（空き音符 ${missingMoras}）`);
  return {
    assigned,
    leftover,
    extraMoras,
    missingMoras,
    ok,
    summary: parts.join("; "),
  };
}
