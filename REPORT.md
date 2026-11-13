# REPORT: browser-dtm（手法 cursor）

- 手法: cursor
- ブランチ: `impl/cursor`
- モデル: Auto
- 開始: 2026-11-13 20:42 JST
- 終了: 2026-11-13 21:05 JST 頃

## GOAL

SPEC.md の最小版を実装する。プロンプトコピペ方式で、VocaTab の歌声と dtm の伴奏（2パート以上）がブラウザで鳴り、エフェクト4種（強度つき）、ピアノロール、MCPサーバー、既定のMP3書き出しまで揃える。LLM の返答は自作の見本返答（フィクスチャ）でよい。

## ACCEPTANCE TESTS

再現前に依存を取得する（`vendor/`・`node_modules/`・`out/`・モデルは commit しない）:

```bash
git clone --depth 1 https://github.com/wavtechyukky/vocatab vendor/vocatab
# または VOCATAB_DIR=/path/to/vocatab
npm ci
npm run build:vocatab
npm run build   # 型チェック + vite build（任意）
npm test
```

| ID | 内容 | 確認コマンド / 手順 |
|----|------|---------------------|
| A1 | プロンプトコピペで見本返答を貼ると歌＋2パート以上の伴奏が鳴る | `npm run accept:a1` |
| A2 | headless Chrome で鳴らし MP3 書き出し。無音でないことを RMS/ピーク等で確認 | `npm run accept:render` → `out/mix.mp3` `out/metrics.json` |
| A3 | 歌と伴奏の頭のずれを数値記録（目標 &lt; 30ms） | `out/metrics.json` の `offsetMs`（スケジュール差） |
| A4 | エフェクト4種×強度0/1で書き出し、音が変わることを数値確認 | `npm run accept:fx` → `out/fx-metrics.json` |
| A5 | SongDoc 変換・歌詞割り当ての単体テスト | `npm test` |
| A6 | MCP: tools/list → new_song→set_track_notes→set_lyrics→set_track_mml→export | `npm run accept:mcp` |
| A7 | README の手順どおり再現できる | README 参照 |

ポート: cursor は 5300〜5399（開発サーバー `http://127.0.0.1:5300`）。

## RESULTS

| ID | 結果 | 数値・メモ |
|----|------|------------|
| A1 | **pass** | 見本貼り戻しで vocal=1, inst=2。再生開始。スクショ `docs/evidence/a1-pianoroll.png` |
| A2 | **pass** | `out/mix.mp3` 200932 bytes。mix RMS=0.3607 peak=0.9776。ffmpeg mean=-8.9 dB max=0 dB。vocal RMS=0.1024 peak=0.4766 / backing RMS=0.3776 peak=0.9767。phrases=1, vocalSeconds≈8.56, mix duration≈17.6s |
| A3 | **pass** | `offsetMs=0`（`onResumeAudio` 内で歌と伴奏を同一 `currentTime+SEQUENCER_START_DELAY(0.1s)` に予約）。`audibleOnsetDeltaMs≈136` は VocaTab leading pau（`vocalStartSec≈-0.305`）による有音開始差で、スケジュールずれではない |
| A4 | **pass** | 4種×0/1 すべて `changed=true`（`out/fx-metrics.json`）。例: vocoder@1 rmsDelta=+0.093, bitcrusher@1 +0.006 |
| A5 | **pass** | vitest 12 tests |
| A6 | **pass** | tools/list 12 道具。道具列成功。音声実体は Chrome 経路（MCP は SongDoc/MML を `out/` に書き出し） |
| A7 | **pass** | README に依存取得・build:vocatab・test・dev・accept・MCP を記載 |

自動修正（受入テスト失敗時）: 2 回まで使用（Worker URL 絶対化、assembleParts の offset、プロセス終了待ち、伴奏小節不足に伴う書き出し待ち）。

## やったこと

- 薄いホストアプリ（Vite）: SongDoc 正本、プロンプトコピペ、ピアノロール、Play/Stop/Export MP3、エフェクト4種
- VocaTab `engine-worker` を vendor から画面なし呼び出し（上流非改造）
- `@onjmin/dtm` 2.1.38 で伴奏（SoundFont + ドラム）を同じ AudioContext 時計で再生・録音
- MCP stdio（`npm run mcp`）で同一道具 API
- headless Chrome（puppeteer-core + google-chrome）で受入

## 再現コマンド

```bash
npm ci
git clone --depth 1 https://github.com/wavtechyukky/vocatab vendor/vocatab
npm run build:vocatab
npm test
npm run accept:mcp
npm run accept:a1
npm run accept:render
npm run accept:fx
```

## COMMITS

（`git log --oneline` 参照。主なもの）

- REPORT: GOAL and ACCEPTANCE TESTS
- feat: minimal browser-dtm host …
- 本レポート更新コミット

## UNRESOLVED / NEXT STEPS

- MCP の `export` は SongDoc/MML まで。音声 MP3 は `accept:render`（ブラウザ録音）に依存
- 有料 LLM 中継（OpenAI 互換）は未実装（プロンプトコピペが最小版必須）
- ピアノロール編集は表示のみ

## BLOCKED APPROVALS

なし
