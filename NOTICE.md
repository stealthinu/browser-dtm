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
