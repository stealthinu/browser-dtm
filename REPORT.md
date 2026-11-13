# 実装レポート: codex

開始: 2026-11-13 20:35 JST / branch: impl/codex
終了期限: 2026-11-14 00:15 JST（最大4時間）

## GOAL
SPEC.md を正本として、SongDoc とプロンプト貼り戻しから VocaTab の歌声と dtm の2パート以上の伴奏をブラウザで再生する非公開ローカルアプリを実装する。4種の歌声エフェクト、ピアノロール、stdio MCP、既定 MP3 出力を含める。上流を変更せず、CPU のみで動かし、モデル・音源・生成音声を commit しない。

## ACCEPTANCE TESTS
- A1/A2: `npm run test:browser` — Chrome で見本返答を貼り戻して実際に再生し、歌・伴奏・ミックスを out/ に保存。`npm run verify:audio` で MP3 の RMS/ピークと区間を確認する。
- A3: `npm run verify:audio` — 歌と伴奏の予定時刻および先頭有音サンプルを記録し、頭の差 <30ms を評価する。
- A4: `npm run test:browser` / `npm run verify:audio` — 各エフェクト強度0/1を出力し、差分 RMS とピークを記録する。
- A5: `npm test` — SongDoc→VocaTab、dtm MML、音価・拍・音域、モーラと過不足の単体テスト。
- A6: `npm run test:mcp` — stdio tools/list、new_song→set_track_notes→set_lyrics→set_track_mml→export を実行し音声出力を確認する。
- A7: `npm run build` と README の起動・テスト手順を実行し、再現方法と依存・モデルの扱いを照合する。

## 状況: 未完了（修復上限2回で終了）
SPEC.md 全文、設計メモ、ライセンス方針を読了。共通 API、検査/変換、プロンプト貼り戻し、歌声 CPU Worker、dtm 軽量シンセ2パート、ピアノロール、4種のエフェクト、MP3/WAV/JSON、stdio MCP を実装した。初回のブラウザ/音声/MCP検証は成功したが、修復後の最終ブラウザ検証がタイムアウトした。**最新の状態が全受け入れ基準を満たすとは判定しない。**

上流 npm の Node 直接 import は MIDI Worker の即時生成で `Worker is not defined` となることを実測したため、MCP は共通 API から Chrome 内の同じ描画ホストを呼ぶ。上流は未変更。

## テスト結果

| 基準 | 最終判定 | 根拠 |
|---|---|---|
| A1 歌＋2パート、貼り戻し | FAIL（最終再検証） | 初回は見本返答から歌/Piano/Bassを実再生。最終回は合成開始後の Chrome 呼び出しがタイムアウト |
| A2 実ブラウザと MP3 の数値 | FAIL（最終再検証） | 初回の音声と測定値は下記。修復後の新しい音声を得られず |
| A3 頭のずれ | 初回 PASS / 最終未確認 | 初回の有音開始差6.32653ms、同じバッファ内の予定開始差0ms |
| A4 4種×強度0/1 | FAIL（最終再検証） | 初回の8MP3はすべて生成・差分あり。単独ボコーダーステムのクリップを見つけレベル補正したが、再検証未完了 |
| A5 変換・歌詞 | PASS | 最新 `npm test`: 7件成功、失敗0 |
| A6 MCP | 初回 PASS / 最終未確認 | tools/list → new_song → set_track_notes → set_lyrics → set_track_mml×2 → exportで実MP3。修復後は再実行せず |
| A7 README 再現 | PARTIAL | `npm ci --no-audit --no-fund`, `npm run build`, `npm test`成功。READMEの全ブラウザ検証手順は最終回失敗 |

最終コマンド: `npm ci --no-audit --no-fund && npm run build && npm test && npm run test:browser`。依存取得・ビルド・7単体テストは成功、ブラウザテストは exit 1。

エラー（修復1回目後・2回目後とも同じ表面症状）:
```
ProtocolError: Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.
at puppeteer-core/.../CallbackRegistry.js:99
```
Chrome DevTools の Runtime 呼び出しの時間切れであり、ssh/tailscale障害は観測していない。ネットワーク復旧操作は実施していない。時間切れの根本原因は未確定で、単純な待ち時間延長はしていない。

### 初回成功時の測定（修復前、20:45 JST）

8.6秒 / 44,100Hz / mono。各トラックの4小節すべてに有音あり。

| 出力 | RMS | peak | clip samples |
|---|---:|---:|---:|
| 歌 WAV | 0.0630809 | 0.309723 | 0 |
| Piano WAV | 0.0309918 | 0.302612 | 0 |
| Bass WAV | 0.0568704 | 0.0852356 | 0 |
| 伴奏 WAV | 0.0420545 | 0.249634 | 0 |
| mix WAV | 0.0588741 | 0.316010 | 0 |
| 既定 MP3 | 0.0571079 | 0.306494 | 0 |

歌の小節別 RMS: 0.05955 / 0.06202 / 0.06822 / 0.07116。伴奏: 0.04246 / 0.04393 / 0.04398 / 0.04401。

頭の測定は `max(0.001, stem peakの1%)` を初めて超えるサンプル。歌0sample、伴奏279sample=6.32653ms。VocaTabの句開始は-0.305秒で、負時刻の音声は曲頭で切っている。これは音素の中心時刻の一致を測る検査ではなく、先頭有音サンプルの比較。

| エフェクト | 強度0↔1の歌ステム差分 RMS | 強度0とdryの差分 RMS |
|---|---:|---:|
| kerokero | 0.0950677 | 0 |
| vocoder | 0.4380744 | 0 |
| bitcrusher | 0.0293724 | 0 |
| doubling | 0.0419369 | 0 |

初回ボコーダー強度1のMP3はpeak0.81645/clip0だが、単独ステムのPCM16出力に5858クリップサンプルがある。修復でRMSとピークを補正した。**上記は補正前の数値であり、補正後の検証値として扱わない。**

音声は `out/baseline.mp3`, `out/{vocal,pf,bs,backing,mix}.wav`, `out/{kerokero,vocoder,bitcrusher,doubling}-{0,1}.mp3`, `out/mcp-song.mp3`。すべてgitignore対象。初回の全数値は `docs/evidence/audio-metrics.json`。修復後の画面は `docs/evidence/piano-roll.png`。

## 修復履歴（2回、上限到達）
1. 初回の追加観察を受け、ボコーダー湿音のRMS/ピーク補正、hidden欄のCSS、歌い手指定の反映を修復。エフェクトステムのクリップ検査、MML整合検査も追加。ビルド・単体成功、Chrome再検証は時間切れ。
2. 短い切り分け実行では合成自体が完了し、MML整合検査が `dtm MML conversion differs: pf` を返した。JSON文字列のプロパティ順比較を値比較へ修復。実コードで確かめたdtmの初期音価と付点（1つごとに×1.5して整数丸め）に共通検査を合わせ、初期`o4 l4 v100`を明示。依存再取得・ビルド・単体成功、最終Chrome再検証は再度時間切れ。以後の追加修復・再試行はしていない。

## 実装と利用条件
- `src/song.mjs` / `src/api.mjs`: SongDoc、音価・拍・MIDI変換、モーラ割り当て、原子的な更新、事実だけを返す共通道具定義。
- `src/vocal-worker.ts`: 読み取り専用 VocaTab core/composeF0 を import。ONNX Runtime1.20.1、CPU/WASM1スレッド。モデルはローカルcloneからのみ読む。
- `src/audio.mjs`: dtm parseMML/createSynth→OfflineAudioContext、歌と同じ時間軸でミックス、実AudioContext再生、ffmpeg/libmp3lameによるMP3。
- 画面: プロンプト作成/コピー、見本返答と貼り戻し、検査エラーと修正依頼、歌と伴奏のピアノロール、再生/停止、4種の強度、MP3/WAV/JSON。
- MCP: 公式SDKのstdio transport。同じSongApi、必要時だけ専用Chrome/5201サーバーを起動し同じ描画経路でexport。
- READMEに取得・起動・書き出し・MCP・検証手順。NOTICEに著作権と波音リツ/カノン表示。VocaTab MIT/THIRD_PARTY_NOTICES/Apache、アプリAGPL全文を保持。
- SoundFont/UTAU/有料API/外部LLM送信/公開/投稿/上流連絡は実施せず。モデル、node_modules、out、vendorをcommitしない。共有上流cloneの`git status --short`は空。
- 検証環境: Node24.22.1、npm11.21.1、Chrome156.0.8078.47、ffmpeg7.1.5、VocaTab2d2a48b、dtm2.1.38。

## Commits
最終更新時に記録する。

## NEXT STEPS
このセッションの実装・修復は終了。次の別作業で、Chromeの状態を合成前後・dtm描画前後・export前後に分けて観測し、Runtime timeoutの発生箇所を特定する。先に問題を再現し、原因を決め打ちしない。解消後にREADME記載の5コマンドを通し、ボコーダー補正後の数値を取り直す。現時点の最新状態を合格品として扱わない。

表示だけのピアノロール、4/4・固定テンポ、歌1トラック、日本語ひらがな、MMLの厳格な部分集合が最小版の制限。ドラム、SoundFont、直接LLM API接続は未実装（2パート伴奏はPiano/Bassで充足）。

## BLOCKED APPROVALS
なし。公開・投稿・有料API・上流への連絡は行わない。
