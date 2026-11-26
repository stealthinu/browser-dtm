// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { buildPrompt } from "./prompt";
import type { SongDoc } from "./songdoc";
export const GALLERY = [
  {
    "id": "hidamari-skip",
    "title": "ひだまりスキップ",
    "category": "曲",
    "bpm": 140,
    "bars": 76,
    "description": "約2分10秒・76小節。ピアノ・ベース・ギター・ブラス・ストリングスの16ビート。"
  },
  {
    "id": "yukidoke-no-tegami",
    "title": "雪解けの手紙",
    "category": "曲",
    "bpm": 72,
    "bars": 52,
    "description": "約2分53秒・52小節。ピアノとストリングスのバラード。"
  },
  {
    "id": "kaze-wo-kire",
    "title": "風を切れ",
    "category": "曲",
    "bpm": 168,
    "bars": 96,
    "description": "約2分17秒・96小節。ギター・ベースの8ビートのロック。"
  },
  {
    "id": "mayonaka-loop-line",
    "title": "真夜中ループライン",
    "category": "曲",
    "bpm": 104,
    "bars": 72,
    "description": "約2分46秒・72小節。エレピ・ベース・ギター・シンセのディスコビート。"
  },
  {
    "id": "eight-beat",
    "title": "まっすぐ8ビート",
    "category": "伴奏",
    "bpm": 112,
    "bars": 4,
    "description": "ピアノとベースの8ビート。歌は音合わせの短いガイド。"
  },
  {
    "id": "soft-ballad",
    "title": "やわらかいバラード伴奏",
    "category": "伴奏",
    "bpm": 68,
    "bars": 4,
    "description": "ギターと低音のバラード。歌は音合わせの短いガイド。"
  },
  {
    "id": "vocaloid",
    "title": "ボカロ風 0.8",
    "category": "エフェクト",
    "bpm": 124,
    "bars": 4,
    "description": "歌のボカロ風エフェクトを0.8で試す。"
  },
  {
    "id": "kero",
    "title": "ケロケロの階段",
    "category": "エフェクト",
    "bpm": 128,
    "bars": 4,
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
