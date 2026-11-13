# browser-dtm（非公開）

ブラウザで「歌＋楽器」の曲を作る DTM アプリの最小版。歌は VocaTab の歌声合成エンジン、楽器は onjmin/dtm を使い、曲や歌詞は LLM から操作できるようにする。

- 指示書: [SPEC.md](SPEC.md)（3手法共通） / 設計メモ: [docs/design-memo.md](docs/design-memo.md)
- ライセンス方針: [LICENSE-POLICY.md](LICENSE-POLICY.md) / 著作権表示: [NOTICE.md](NOTICE.md)
- 3手法の比較: ブランチ `impl/claude-code`（Claude Code, jev）、`impl/codex`（Codex, jev）、`impl/cursor`（Cursor クラウドエージェント）。品質は Kiyoshiさんが評価する。
- 使用量ログ: `logs/usage-<手法>.md`（集計は `tools/collect-usage.py`）

**このリポジトリは公開しない。** 歌声モデル・ボコーダ・SoundFont は commit しない（SPEC §4）。
