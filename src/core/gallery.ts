// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { buildPrompt } from "./prompt";
import type { SongDoc } from "./songdoc";
export const GALLERY = [
  {
    "id": "sunset-pop",
    "title": "夕空ポップ",
    "category": "曲",
    "bpm": 120,
    "description": "明るいポップ。ピアノとベース、8ビート。"
  },
  {
    "id": "moon-ballad",
    "title": "月あかりのバラード",
    "category": "曲",
    "bpm": 76,
    "description": "ゆったりしたバラード。ギターとストリングス。"
  },
  {
    "id": "city-dance",
    "title": "街のダンス",
    "category": "曲",
    "bpm": 138,
    "description": "軽快なダンス。エレピとベース。"
  },
  {
    "id": "eight-beat",
    "title": "まっすぐ8ビート",
    "category": "伴奏",
    "bpm": 112,
    "description": "ピアノとベースの8ビート。歌は音合わせの短いガイド。"
  },
  {
    "id": "soft-ballad",
    "title": "やわらかいバラード伴奏",
    "category": "伴奏",
    "bpm": 68,
    "description": "ギターと低音のバラード。歌は音合わせの短いガイド。"
  },
  {
    "id": "vocaloid",
    "title": "ボカロ風 0.8",
    "category": "エフェクト",
    "bpm": 124,
    "description": "歌のボカロ風エフェクトを0.8で試す。"
  },
  {
    "id": "kero",
    "title": "ケロケロの階段",
    "category": "エフェクト",
    "bpm": 128,
    "description": "歌のケロケロエフェクトを1.0で試す。"
  }
] as const;
export type PromptTarget = "claude" | "chatgpt";
export function galleryPrompt(doc: SongDoc, target: PromptTarget): string {
  const lyrics = doc.tracks.filter(t => t.kind === "vocal").flatMap(t => t.notes.map(n => n.lyric ?? "")).join("");
  const guide = target === "claude"
    ? "Claude へ: 説明やArtifactは付けず、完成したJSONを本文のjsonフェンス1つで返してください。省略や差分は禁止です。"
    : "ChatGPT へ: ダウンロードリンクや実行コードではなく、コピーできる完成したJSONを本文のjsonフェンス1つで返してください。省略や差分は禁止です。";
  return buildPrompt(lyrics, "このサンプルを土台に、歌詞と小節数を保ち、メロディの後半に変化を付けてください。楽器指定とエフェクトを保ってください。", doc) + "\n" + guide + "\n";
}
