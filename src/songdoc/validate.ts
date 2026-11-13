import { convertAndCheck } from "./convert.js";
import type { SongDoc } from "./types.js";

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  check: ReturnType<typeof convertAndCheck>;
}

/** LLM 貼り付け JSON を検査して SongDoc として返す */
export function parseSongDocJson(raw: unknown): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      errors: ["JSON オブジェクトではない"],
      warnings,
      check: {
        vocalNotes: 0,
        instTracks: 0,
        drumPattern: null,
        mml: "",
        vocatabNotes: [],
        errors: ["JSON オブジェクトではない"],
      },
    };
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) errors.push("version は 1");
  if (typeof o.bpm !== "number") errors.push("bpm が必要");
  if (typeof o.bars !== "number") errors.push("bars が必要");
  if (!Array.isArray(o.tracks)) errors.push("tracks 配列が必要");

  const doc = raw as SongDoc;
  const check = errors.length ? {
    vocalNotes: 0,
    instTracks: 0,
    drumPattern: null,
    mml: "",
    vocatabNotes: [],
    errors: [...errors],
  } : convertAndCheck(doc);

  if (check.instTracks < 2 && !check.errors.some((e) => e.includes("inst"))) {
    warnings.push(`伴奏パートが ${check.instTracks}（推奨: 2以上）`);
  }
  if (check.vocalNotes === 0) warnings.push("歌ノートが無い");

  errors.push(...check.errors);
  return { ok: errors.length === 0, errors, warnings, check };
}

/** テキストから SongDoc JSON を抜き出す（コードフェンス対応） */
export function extractSongDocFromText(text: string): { json: unknown | null; error?: string } {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return { json: null, error: "JSON オブジェクトが見つからない" };
  try {
    return { json: JSON.parse(candidate.slice(start, end + 1)) };
  } catch (e) {
    return { json: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export function correctionPrompt(errors: string[], warnings: string[]): string {
  const lines = [
    "前回の SongDoc に問題があります。次を直して、SongDoc JSON だけを返してください。",
    ...errors.map((e) => `- ERROR: ${e}`),
    ...warnings.map((w) => `- WARN: ${w}`),
  ];
  return lines.join("\n");
}
