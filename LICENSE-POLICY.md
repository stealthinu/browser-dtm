# ライセンス方針（2026-11-13）

- 本リポジトリは onjmin/dtm（2.1.38 以降 **AGPL-3.0-or-later**）をライブラリとして結合する。**AGPL を継承する前提**で扱い、現時点では**非公開**（Kiyoshiさんの確認なしに公開しない）。
- 公開・配布・Web で他人に使わせる場合は、その時点でアプリ全体を AGPL-3.0-or-later で出す（ソース提供義務）か、dtm を 2.1.37（MIT）に固定するかを Kiyoshiさんが決める。
- VocaTab のコードは MIT（Copyright (c) 2026 wavtechyukky）。AGPL と組み合わせ可。表示を残す。
- VocaTab の**歌声モデル（voicebanks/）とボコーダ（vocoders/）は個人・非商用・再配布禁止**。リポジトリに入れない、再ホストしない。出力音を公開するときは歌い手のクレジット（設計メモ (d)3）が必須。NHVSing は非商用。
- SoundFont は同梱しない。最初は FluidR3 / GeneralUser GS のみ（実行時に CDN から）。Inc・Niji・Otenkiame は使わない。
- 詳細: docs/design-memo.md (d)。法的な確認（弁護士）はしていない。

## main-v1 M1

ボカロ風 v2 DSP は本リポジトリ内ブランチ `feat/vocaloid-filter` のコードを移植する。外部の歌声モデル・ボコーダ・音声素材を追加しない。dtm / VocaTab は import とラッパーのみで、上流ソースは変更しない。購読 LLM の返答は SongDoc / MML のテキストのみを保存する。

## main-v1 M2

使用する音源はMITのFluidR3 GMのみ。WebAudioFont dataの配信リポジトリもMIT（詳細・一次資料はNOTICE）。音源データの同梱・再ホスト・commitは行わず、実行時に必要な楽器/ドラムのJSを元URLから読む。GeneralUser GSは未採用。dtmの内部SoundFontクラスは同版の上流cloneから読取専用importし、AGPLと元のMITクレジットを保持する。

## main-v1 M3

ギャラリーのサンプルはオリジナルのSongDoc/MMLデータだけを置く。試聴も既存のVocaTab/dtmラッパーを共用し、モデル・ボコーダ・音声・SoundFontをコピー/同梱しない。実LLM往復は購読CLIのみ（従量APIへのfallback無し）、返答は未編集のテキストと出所ハッシュを保存する。ギャラリーを含む本アプリは非公開を継続する。今回、公開・配布・上流への変更依頼は行わない。
