# NOTICE（第三者の著作権表示）

- **VocaTab** — https://github.com/wavtechyukky/vocatab — MIT License, Copyright (c) 2026 wavtechyukky.
  歌声モデル・ボコーダは別条件（個人・非商用・再配布禁止）。本リポジトリには含めない。上流の `LICENSE`、`THIRD_PARTY_NOTICES.md`、`voicebanks/leapsinger_ja_3singer/README.md` を参照。
- **dtm** — https://github.com/onjmin/dtm — AGPL-3.0-or-later（2.1.38〜）, (c) onjmin.
- onnxruntime-web — MIT（実行時に CDN から読む場合も表示を残す）。
- SoundFont（FluidR3, GeneralUser GS）— 各ライセンスに従う。同梱しない。

各実装は、取り込んだ上流コードのヘッダと表示を消さないこと。

## impl/claude-code が使う npm パッケージ（dist/ に束ねる。dist/ は commit しない）
- `@onjmin/dtm` 2.1.38 — AGPL-3.0-or-later, (c) onjmin。
- `@breezystack/lamejs` — LGPL-3.0（MP3 エンコーダ。LAME の JS 移植）。配布するときは LGPL の条件（差し替え可能な形・ソースの提供）に従う。
- 開発用: `esbuild`（MIT）、`puppeteer-core`（Apache-2.0）、`@modelcontextprotocol/sdk`（MIT）、`tsx`（MIT）。
- VocaTab の `ui/src/engine-web/*`・`engine.ts`・`model.ts`・`params.ts` などを esbuild で import して束ねる（上流のファイルは書き換えない。束ねた dist/ にも上流の MIT 表示が必要: 配布するときは上流の LICENSE を添える）。

## main-v1 M1 のボカロ風 DSP
- `src/core/vocaloid-v2.js` は本リポジトリの `feat/vocaloid-filter`、commit `ae8a772` の `effects/vocaloid/dsp.js` を移植。既存のヘッダを保存し、解析用 pitchFrames の export のみ追加。
- `src/core/vocaloid.ts` は有声 RMS 補正と無声子音の原音クロスフェード。VocaTab / dtm の上流コードは変更しない。歌声モデル・ボコーダは含まない。

## main-v1 M2: 実行時 SoundFont

- **Fluid (R3) General MIDI SoundFont / FluidR3_GM.sf2** — MIT License。Copyright (c) 2000–2002, 2008 Frank Wen。
  配信元: https://surikov.github.io/webaudiofontdata/sound/ （旋律 `0000_FluidR3_GM_sf2_file.js` 等、ドラム `12836_0_FluidR3_GM_sf2_file.js` 等）。
  一次資料: [配信元READMEのライセンス参照](https://github.com/surikov/webaudiofontdata/blob/master/README.md)、[MuseScoreが保存する元FluidR3 README/COPYING](https://github.com/musescore/MuseScore/blob/v3.6.2/share/sound/FluidR3Mono_License.md)。後者には元作者のMITでの公開宣言と元のCOPYINGが保存されている。Mono版やMS_Generalのデータは使わない。
  原作者の謝辞: Suren M. Seron, Scott Hanan, Steve Aupperle, Chris Gillman, Alex Taubr, Chris Prola, Andrew Klenk, Winfried Hubbe, Dylan, Tim, Gort, Uros Katic, Ethan Winer。
- **WebAudioFont data** — MIT License。Copyright (c) 2017 Srgy Surkv。
  配信リポジトリ: https://github.com/surikov/webaudiofontdata 。[LICENSE](https://github.com/surikov/webaudiofontdata/blob/master/LICENSE) を確認。
- 音源のJS（サンプルデータ）・sf2・sf3はリポジトリに同梱せず、ブラウザが必要な音色だけ実行時に外部URLから読む。GeneralUser GSなど他のバンクは今回は選択肢に追加しない。
- 読み込み・発音は dtm の `src/instruments/sf/SoundFont.ts` を上流ソースから改変せずimportする（内部API。理由・版・制限はREPORT M2）。同ファイルのrpgen3由来MITクレジットを保持する。https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont.mjs 。上流ソース自体や音源データを本repoへコピーしない。

## main-v1 M3: サンプルと実LLM往復

- `fixtures/gallery/*.json` は本アプリ用に作成したオリジナルの短い音符データ（browser-dtm authors、アプリと同じAGPL-3.0-or-later）。録音素材・既存楽曲・モデル・SoundFontバイナリは含まない。
- `fixtures/llm-real/{gallery-answer-1,long-answer-1}.txt` は購読CLIの実返答を未編集で保存したSongDoc/MMLテキスト。出所・SHA-256は `m3-provenance.json`。
- ギャラリーの導線は [DesignBookmark Motion](https://designbookmark.com/motion) のカード・分類・用途別コピーを参考にした。コード・画像・アニメーション素材は取り込まない。試聴の第三者エンジンと実行時音源はM1/M2と同じ、表示条件も維持する。
