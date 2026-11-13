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

## 節目1 — 独立モジュールと試験ハーネス
- 共通DSP、Web Audio / OfflineAudioContext adapter、CLI、ローカル専用デモ、lamejs Worker MP3エンコーダーを実装。
- 根拠・パラメーター・既知の限界を docs/vocaloid-filter.md に記録。指定SOS本文は403で未確認。現行VOCALOID公式マニュアルは取得成功。
- 単体8/8 PASS。CLI強度3種類とMP3入力 PASS。
- ブラウザ実再生の初回試験は固定2.5秒待ちでAudioContext経過2秒に達せず FAIL。診断では開始が遅れるが音声時計は進み、analyser RMS 0.025〜0.063 の実信号を確認。DSP障害ではなく初期デバイス起動待ち不足。
- 修復1/2: 音声時計が2.2秒進むまで監視、最大8秒の有界待ちに変更。閾値を下げず実再生を確認する。

## 節目2 — 受入テストの実測と修復2
- ブラウザ再試験は3強度で実再生・MP3保存 PASS。音声時計2.208〜2.261秒、再生analyser最大RMS 0.0848〜0.1269。adapterとの差0。
- 数値検証初回 FAIL: 36/47。強度0 browser の外部原音比較に最大8.64e-6差。原因を調べたところ正側のみ32768/32767倍というブラウザデコード差。デモ内の入力→強度0出力は差0だった。
- F0初回: 未前処理YINで全体中央値差 +22.85 / +23.01 cent。一方、対応窓絶対差中央値0.45 / 0.65 cent、p95 4.79 / 5.70 cent。346窓中2〜3窓の高域による推定差が、旋律の二群の間にある全体中央値を押し上げていた。
- 独立診断: 検査のみに共通4次ローパスを適用。cutoff 700/900/1200/1600/2200Hz のすべてで、両強度の全体中央値差は−0.82〜+0.25 cent、対応窓絶対差p95は6.16cent以下。実際のF0変更を示す挙動ではないと判断した。単一合成倍音源の独立周波数測定も2cent未満。
- 修復2/2: WAV PCMのブラウザ読み込みスケールをffmpegと揃え、F0検査には全入力で同じ1200Hzローパスを採用。既知200/650Hzと既知50cent差の陽性対照を追加。音のDSPは変更せず、ピッチ補正も追加していない。
- 未前処理での初回表は out/analysis-initial-failure.md / .json に保持（非追跡）。以後、追加修復は行わない。

## 修復上限後の最終判定
- 最終数値試験: **FAIL — 50/51**。歌声・出力についての47検査はすべてPASS。追加した推定器の陽性対照4件中、650Hz絶対精度（許容2cent）のみFAIL。実測651.064039Hz、誤差約+2.83cent。既知50cent差は49.834908centと検出できた。
- 契約の修復上限2回に達したので、追加修正を行わず開発を終了し、成果物と到達点を記録する。
- 最終ブラウザ: 3強度のMP3を保存、各2.208〜2.304秒の実再生を確認。最終analyser最大RMS 0.0804〜0.1202、ブラウザエラー0、adapterとの差0。
- 歌声のF0中央値差は最大0.371cent、対応窓絶対差p95は最大5.38cent（347有声窓）。ピッチ補正なし。
- PCM両版最大絶対差 ≤1.11e-16、強度0は両版とも原音との差0。MP3両版の重心相対差最大1.234%、RMS相対差最大0.00462%。
