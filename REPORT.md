# vocaloid フィルター作業記録

## GOAL
VocaTab の生成歌声を、F0 を変更せず音色とダイナミクスでボカロ風にする独立エフェクト `vocaloid` を作る。強度は 0〜1、0 は完全な素通し。ブラウザと CLI は同一 DSP を使う。既存アプリへは埋め込まない。

## ACCEPTANCE TESTS（実行予定コマンドと判定条件）
1. `node --test tests/vocaloid.test.js` — amount=0、クランプ、長さ、無音、非有限値の扱い、ピッチを変えない合成波テストが全件 PASS。
2. `node tests/render-cli.js` — 提供 WAV を強度 0 / 0.5 / 1 で `/workspace/vocaloid-filter-demo/vocaloid-{amount}.mp3` に書き出す。全件成功。
3. `node tests/browser.js` — `/usr/bin/google-chrome` を headless で使い、ローカル WAV を実際に Web Audio で再生し、同じ3強度をブラウザで MP3 化して `out/browser-vocaloid-{amount}.mp3` に保存。エラーなし、非無音、クリップなし。
4. `python3 tests/analyze.py` — 原音・両版の3強度について RMS、重心、短窓 RMS の95–5百分位差、F0 中央値と原音からの cent 差を表にする。amount=0 の DSP 出力は入力と一致。非ゼロ強度で音が変化、CLI/ブラウザの RMS・重心差は各5%未満、F0 中央値差は20 cent未満、全出力が非無音で連続クリップなし。
5. `git diff --check` — 空白エラーなし。`git status --short` と `git ls-files` で音声・モデル・秘密が追跡されていないことを確認。

## 制約・進行
- 開始: 2026-11-13 21:58 JST。締切: 23:20 JST（全体90分以内）。
- ブランチ: feat/vocaloid-filter のみ。各節目に自分のファイルだけ commit / `git push origin HEAD`。
- 受け入れテスト失敗後の修復は最大2回、プロバイダ切替は最大1回（有料 API は使わない）。
- 開発サーバーは5400〜5499。終了時に自分のサーバーを停止。
- 接続障害は復旧しない。指示の JEV_NEEDS_MUGI 行を出力し記録する。

## 事前確認
- 現在ブランチと clean な作業ツリーを確認。
- 指定 WAV と SOURCE.txt が存在。VocaTab の受入テスト生成、44.1kHz mono 約8.60秒。音声は追跡しない。
- ffmpeg / node / Chrome が存在。Python は `python3` を使用する（`python` コマンドは存在しない）。

## 実装・処理チェーン・調査
作業中。

## テスト結果
未実施。

## commits
初期計画 commit は git 履歴に記録。以降も節目ごとに記録する。

## sample source
`/workspace/vocaloid-filter-demo/source/SOURCE.txt`。原音: `/workspace/vocaloid-filter-demo/source/vocatab-codex-vocal.wav`。モデル・原音・処理後音声は commit しない。

## NEXT STEPS
根拠調査、共通 DSP / CLI / ブラウザデモ実装、受け入れ試験、最終記録。

## BLOCKED APPROVALS
なし。公開・PR・外部メッセージ・有料APIの利用は実施しない。
