# NOTICE（第三者の著作権表示）

- **VocaTab** — https://github.com/wavtechyukky/vocatab — MIT License, Copyright (c) 2026 wavtechyukky.
  歌声モデル・ボコーダは別条件（個人・非商用・再配布禁止）。本リポジトリには含めない。上流の `LICENSE`、`THIRD_PARTY_NOTICES.md`、`voicebanks/leapsinger_ja_3singer/README.md` を参照。
- **dtm** — https://github.com/onjmin/dtm — AGPL-3.0-or-later（2.1.38〜）, (c) onjmin.
- onnxruntime-web — MIT（実行時に CDN から読む場合も表示を残す）。
- SoundFont（FluidR3, GeneralUser GS）— 各ライセンスに従う。同梱しない。

この実装の保存済みの表示:
- [VocaTab MIT 全文](docs/licenses/VocaTab-MIT.txt) / [上流 THIRD_PARTY_NOTICES 全文](docs/licenses/VocaTab-THIRD_PARTY_NOTICES.md)
- 上流の growl 実装に関する [Apache-2.0 全文](docs/licenses/Apache-2.0.txt)。上流ソースのコメントは変更せず、ビルド時に import する。
- [アプリの AGPL-3.0 全文](LICENSE)（AGPL-3.0-or-later）。
- onnxruntime-web 1.20.1: MIT, Copyright (c) Microsoft Corporation. npm パッケージからローカル配信する。元ソースの MIT ライセンスに従う。
- 見本の歌声: **波音リツ / カノン**。歌声モデル・ボコーダは個人・非商用・再配布禁止。音声の外部公開はしない。
- dtm 内蔵の軽量シンセ（ピアノ風の減衰三角波、ベース正弦波、パッド鋸歯状波）を使う。SoundFont / UTAU 音源を取得・配信しない。

各実装は、取り込んだ上流コードのヘッダと表示を消さないこと。
