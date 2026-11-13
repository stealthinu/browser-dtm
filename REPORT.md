# REPORT: browser-dtm（手法 cursor）

- 手法: cursor
- ブランチ: `impl/cursor`
- モデル: Auto
- 開始: 2026-11-13 20:42 JST

## GOAL

SPEC.md の最小版を実装する。プロンプトコピペ方式で、VocaTab の歌声と dtm の伴奏（2パート以上）がブラウザで鳴り、エフェクト4種（強度つき）、ピアノロール、MCPサーバー、既定のMP3書き出しまで揃える。LLM の返答は自作の見本返答（フィクスチャ）でよい。

## ACCEPTANCE TESTS

再現前に依存を取得する（`vendor/`・`node_modules/`・`out/`・モデルは commit しない）:

```bash
# VocaTab（未取得なら）
git clone --depth 1 https://github.com/wavtechyukky/vocatab vendor/vocatab
# または VOCATAB_DIR=/path/to/vocatab
npm ci
npm run build:vocatab   # engine-worker をビルド
npm run build
npm test                # A5: SongDoc 変換・歌詞割り当て
```

| ID | 内容 | 確認コマンド / 手順 |
|----|------|---------------------|
| A1 | プロンプトコピペで見本返答を貼ると歌＋2パート以上の伴奏が鳴る | `npm run accept:a1`（フィクスチャ読込→再生経路）または UI で `fixtures/llm-response-sample.txt` を貼る |
| A2 | headless Chrome で鳴らし MP3 書き出し。無音でないことを RMS/ピーク等で確認 | `npm run accept:render` → `out/mix.mp3` と `out/metrics.json` |
| A3 | 歌と伴奏の頭のずれを数値記録（目標 &lt; 30ms） | `out/metrics.json` の `vocalOnsetMs` / `backingOnsetMs` / `offsetMs` |
| A4 | エフェクト4種×強度0/1で書き出し、音が変わることを数値確認 | `npm run accept:fx` → `out/fx-*.mp3` と差分メトリクス |
| A5 | SongDoc 変換・歌詞割り当ての単体テスト | `npm test` |
| A6 | MCP: tools/list → new_song→set_track_notes→set_lyrics→set_track_mml→export | `npm run accept:mcp` |
| A7 | README の手順どおり再現できる | README を読んで上記を実行 |

ポート: cursor は 5300〜5399（例: 開発サーバー `http://127.0.0.1:5300`）。

## RESULTS

（実装後に記入）

## COMMITS

（実装後に記入）

## UNRESOLVED / NEXT STEPS

（実装後に記入）

## BLOCKED APPROVALS

なし
