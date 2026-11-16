# REPORT

## impl/claude-code（旧）

## GOAL
SPEC.md の最小版: プロンプトコピペ方式で LLM（実装中は見本返答フィクスチャ）から SongDoc＋MML を貼り戻すと、
VocaTab の歌声（画面なし engine-web Worker）＋ dtm の伴奏（2パート以上）がブラウザで同じ時計で鳴る。
エフェクト4種（ケロケロ/ボコーダー/ビットクラッシャー/ダブリング、強度0〜1）、ピアノロール表示、MCP サーバー（stdio）、既定 MP3 書き出し。

## ACCEPTANCE TESTS（確認コマンド）
| ID | コマンド | 合格条件 |
|---|---|---|
| A5 | `npm test` | SongDoc 変換・歌詞割り当ての単体テストが全部通る |
| A1/A2/A3 | `npm run e2e`（headless Chrome で fixtures/sample-response.txt を貼り戻し→鳴らす→MP3 書き出し） | ブラウザで歌＋伴奏が鳴り、`out/song.mp3` の RMS/ピークが無音でもクリップでもなく、歌区間・伴奏区間がそれぞれ有音、頭のずれ < 30ms |
| A4 | `npm run e2e:fx` | 4種のエフェクトを強度 0 と 1 で書き出し、差（相関・差分の大きさ）が数値で出る |
| A6 | `npm run mcp:smoke` | MCP サーバーが起動し tools/list が返り、new_song→set_track_notes→set_lyrics→set_track_mml→export で MP3 ができる |
| A7 | README の手順 | 依存取得・上流の場所・テスト・書き出しが書かれていて、そのとおりに再現できる |

---

## 結果（2026-11-13 21:17 JST、box、CPU のみ）

| ID | 結果 | 数値・根拠 |
|---|---|---|
| A1 | **PASS** | 画面の「見本返答を入れる」→「読み込む」で問題 0 件。歌（vo）＋伴奏3パート（pf ピアノ、ba ベース、dr ドラム 8beat） |
| A2 | **PASS** | `out/song.mp3`（9.535 秒、192 kbps）: L/R とも RMS −14.61 dBFS、ピーク −1.71 dBFS、クリップ 0 サンプル。歌の区間（0〜7.5 秒）: 歌 stem の RMS −19.35 dB。伴奏の区間（0〜8 秒）: 伴奏 stem の RMS −17.50 dB。曲の後（9 秒〜）: どちらも無音。スクリーンショット `docs/evidence/pianoroll.png` |
| A3 | **PASS** | 頭のずれ **12.09 ms**（< 30 ms）。内訳は下 |
| A4 | **PASS**（4種とも）／自分で足した対照チェックは **FAIL** | 下の表。対照の失敗は録音の傷のせいで、エフェクトの差はその 15 dB 以上上 |
| A5 | **PASS** | `npm test`: 12 件 pass / 0 fail |
| A6 | **PASS** | tools/list が 12 道具を返す。new_song→set_track_notes→set_lyrics（過不足 0）→set_track_mml×2（はみ出し 0）→set_drums→check（問題 0）→export(json)→export(mp3)。`out/mcp-smoke.mp3` 141,688 バイト、歌 −22.34 dB、伴奏 −18.77 dB、ミックス −15.48 dB |
| A7 | **PASS** | HEAD を `git archive` で空のディレクトリ（/tmp/repro.pzem）に出し、README どおり `npm ci` → `npm run build` → `npm test`（12 pass）→ `npm run e2e`（ALL PASS）を再現 |

### A2: 小節ごとの RMS（dBFS、`out/e2e.json`）
| 小節 | ミックス | 伴奏 stem | 歌 stem |
|---|---|---|---|
| 1 | −13.63 | −17.61 | −20.30 |
| 2 | −13.32 | −17.53 | −18.45 |
| 3 | −13.21 | −17.52 | −19.34 |
| 4 | −14.29 | −17.37 | −20.82 |
| 5（余韻） | −34.54 | −36.86 | 無音 |

### A3: 頭のずれ
- 予定（AudioContext の時計）: 伴奏の曲頭と歌の曲頭の差 **0 ms**（同じ値から決めている）。
- 録った音で測った値: 伴奏の最初の立ち上がり = 曲頭 +12.09 ms（dtm の内蔵シンセの立ち上がり）、歌の置き場所 = 合成したままの歌との相互相関で **0 ms**（サンプル単位で一致）。頭のずれ = |0 − 12.09| = **12.09 ms**。
- 揃え方: dtm のシーケンサは「`playMML` を呼んだ時の `ctx.currentTime` + `SEQUENCER_START_DELAY`」を曲頭にする。この `currentTime` を Proxy で決めた値に固定して呼び、同じ値（サンプルの境目に丸める）で歌の `AudioBufferSourceNode.start()` と録音の窓を決める。dtm は改造していない。
- MP3 自体は lamejs のエンコーダ遅延で、WAV より一律 25.06 ms 遅れて始まる（歌と伴奏は同じだけずれるので、両者のずれには影響しない）。

### A4: エフェクト（強度 0 と 1 の比較。`out/e2e-fx.json`）
「相関」は録った歌 stem どうしの相関係数（1 = 同じ）、「差分」は差の RMS を元の RMS に対する dB で表したもの。

| エフェクト | 相関（0 vs 1） | 差分 | 歌 stem RMS / ピーク（0 → 1） | 備考 |
|---|---|---|---|---|
| ケロケロ（kero） | −0.080 | +3.15 dB | −20.39 / −5.62 → −20.79 / −7.58 | F0 を音符の音高へ寄せて VocaTab で合成し直す |
| ボコーダー | 0.189 | +2.12 dB | −20.39 / −5.62 → −20.36 / −2.05 | 20 帯域、キャリア = 音符の音高のノコギリ波 |
| ビットクラッシャー | 0.612 | −0.53 dB | −20.39 / −5.62 → −19.39 / −6.02 | 3 bit・1/10 に間引き |
| ダブリング | 0.722 | −2.51 dB | −20.39 / −5.62 → −20.34 / −3.99 | MP3 の L と R の差が −5.72 dB（強度 0 では L=R） |
| 対照（エフェクト無しを 2 回） | 0.9909 | −17.39 dB | — | **FAIL**（基準を 0.999 にしていた）。原因は下の「未解決 1」 |

---

## やったこと
- **SongDoc**（`src/core/songdoc.ts`）: 型、検査（場所つきの問題一覧: 音域外・読めない音価/音名・重なり・はみ出し・歌詞）、変換（VocaTab Note: TPQ=480・MIDI・かな / dtm MML: `#drum=`・`#t<n>inst=`・`@n`・`t<bpm>`）、歌詞の割り当て（1モーラ=1音符、拗音は1、`ー` 伸ばし、`っ`・`ん` は1、カタカナはひらがなに。余り・不足を返す）。音価の表記は README に書いた。
- **道具**（`src/core/tools.ts`）: get_song / new_song / set_chords / set_track_notes / set_lyrics / set_track_mml（dtm の parseMML で音符数・長さの過不足・音域を返す）/ set_drums / set_effects / set_mix / check / export / finish。ブラウザと MCP で同じ定義を使う。点数は返さない。
- **プロンプトコピペ方式**（`src/core/prompt.ts`、画面）: プロンプト（歌詞・モーラ数・イメージ・書式・例）を作ってコピー。返答から ```json を取り出して検査し、問題があれば LLM に返す修正依頼文を出す。見本返答 `fixtures/sample-response.txt`。
- **歌**（`src/web/vocal.ts`）: VocaTab の `engine-web/worker.ts` を esbuild で包み、上流の `composeF0`・`phraseParams` を import して、画面なしで analyze → F0 → synthesize → 句を並べる。上流のファイルは書き換えていない（`/workspace/dtm-research/vocatab` の `git status` は空のまま）。4 小節（12 音符、1 句）の合成は約 5 秒（CPU、WASM 4 スレッド）。
- **伴奏と同期・録音**（`src/web/player.ts`）: 上の A3 の方法。AudioWorklet で「ミックス L/R・伴奏だけ・歌だけ」の 4 チャンネルを曲頭から録る。ミックスの最後に軽いリミッタ。
- **エフェクト**（`src/core/fx.ts` と `vocal.ts`）: SongDoc の `effects: [{type, amount}]` に保存し、再生と書き出しの両方に掛かる。
- **ピアノロール**（canvas）: 歌（歌詞つき）と伴奏の音符、小節線、再生位置。
- **書き出し**: MP3（既定、lamejs でブラウザ内エンコード）・WAV・SongDoc JSON。
- **MCP サーバー**（`mcp/server.ts`、stdio）: 同じ道具。export の mp3/wav は headless Chrome でアプリを開いて鳴らして録る。
- **e2e**（`scripts/e2e.mjs`）: 画面のボタンを押して貼り戻し → 書き出し → ffmpeg で MP3 をデコードして数値を出す。

## 未解決
1. **録音の傷**（A4 の対照が FAIL）: AudioWorklet の録音が、負荷のあるときに時々 1 レンダー単位（128 サンプル）を取りこぼし、次の単位を 1 つ前の位置へ書く（128 サンプルの無音のあとに 128 サンプル早い音、が 256 サンプル続く）。合成した歌は 2 回とも同じビット列で、置き場所のずれも 0 なので、録音の作りの問題。`out/song.mp3` では 256 サンプルの区間 16 個（9.5 秒中、約 1.2%）で起き、小さなクリックとして聞こえる可能性がある。
   - 試した直し（2 回、上限に達したので止めた）: (1) 曲頭をサンプルの境目に丸めた → 変わらず（仮説が違った）。(2) 再生中のピアノロール描画で毎フレーム MML をパースしていたのをやめた → 変わらず。
   - 次の直し案: 録音の位置を `currentFrame` で決めず、曲頭に `start()` する「フレーム番号を書いたバッファ」を 5 チャンネル目として流し、その値の位置へ書く（グラフの中身と同じ時刻で揃う。取りこぼしは穴として数えられる）。または書き出しを OfflineAudioContext で行う（dtm のシーケンサは実時間の setInterval なので、時計を Proxy で進める工夫が要る）。
2. 伴奏の音色は dtm の内蔵シンセ（`playMML` は SoundFont を使わない）。dtm の SoundFont クラスは npm の入口から export されていないため、上流を改造せずに使うなら `createDtmStudio` 経由の別の作りが要る。
3. MP3 の頭に lamejs のエンコーダ遅延（25.06 ms）が入る（LAME/Xing タグで遅延を書いていない）。
4. 実際の LLM にはつないでいない（見本返答のフィクスチャだけ）。OpenAI 互換の Node 中継（任意項目）は作っていない。
5. ピアノロールは表示だけ（編集は無し）。ドラムは凡例にパターン名を出すだけ。

## NEXT STEPS
1. 録音の傷の修正（上の「次の直し案」）と、対照チェック（同じ設定の 2 回で相関 > 0.999）を通す。
2. 実際の LLM（Claude / Codex など）に `buildPrompt` の文を渡して、返答の取り込み・修正依頼の往復を試す。MCP サーバーを Claude Code に登録して道具ループで1曲作る。
3. 伴奏を SoundFont（FluidR3 / GeneralUser GS）で鳴らす方法を決める（`createDtmStudio` を使うか、dtm に export を頼むかは要相談。上流への issue は承認が要る）。
4. 長い曲（16 小節以上・複数の句）で合成時間と同期を測る。句ごとの合成の進み具合を画面に出す。
5. Kiyoshiさんに `out/song.mp3`・`out/fx-*.mp3` を聞いてもらい、エフェクトの強度の割り当て（特にボコーダーとケロケロ）を直す。

## BLOCKED APPROVALS
- なし（有料 API・外部への送信・公開・購入はしていない）。上流（VocaTab・dtm）への issue/PR は作っていない。SoundFont の取り扱いで dtm に export を頼むなら、その時点で承認が要る。

## 再現コマンド
```bash
npm ci && export VOCATAB_DIR=/workspace/dtm-research/vocatab && npm run build
npm test && npm run e2e && npm run e2e:fx && npm run mcp:smoke
npm run serve   # http://127.0.0.1:5100/
```

## commit 一覧（impl/claude-code）
- 7db0797 REPORT: goal and acceptance tests
- 55d64e8 SongDoc core: conversion to VocaTab notes / dtm MML, lyric assignment, tools, prompt; unit tests
- 99c4364 Browser app: VocaTab headless vocal + dtm accompaniment on one clock, effects, piano roll, MP3 export, e2e
- d73b637 Quantize song start to a sample frame, cache piano-roll MML parse, e2e: no-fx control and recorder glitch count
- d5c824c MCP server (stdio) sharing the tool definitions; mcp-smoke acceptance script
- 5329f4b README: setup, SongDoc format, usage, tests, MCP; NOTICE: bundled packages
- （この REPORT と使用量ログの commit）

## 制約の確認
- 音声ファイルは `out/`（.gitignore）にだけ置き、commit していない。歌声モデル・ボコーダ・SoundFont は commit していない（モデルは開発サーバーが VOCATAB_DIR から読むだけ）。
- GPU は使っていない（onnxruntime-web は WASM、Chrome は `--disable-gpu`）。ポートは 5100（e2e）・5101（MCP の書き出し）・5102（再現の確認）だけを使い、終わったら閉じた。
- ネットワークの不調は無かった（JEV_NEEDS_MUGI は出していない）。秘密の値はどこにも書いていない。


## main-v1 M1

開始: 2026-11-16 10:38 JST。110 分で実装を切り上げ、最終記録する（期限 12:28 JST）。

### GOAL
プロンプト生成→本物の購読 LLM の未編集返答→自動修復・検査→歌＋伴奏の再生・MP3 の往復を完成する。
ボカロ風 v2 を統合し、有声 RMS の補正・無声子音の保存を検証する。
旧 A4 対照の録音傷をまず再現・測定し、同設定の書き出し相関 > 0.999 を目指す。
M2/M3、公開、上流改変、音声・モデルの commit は対象外。

### ACCEPTANCE TESTS
| ID | コマンド | PASS 条件 |
|---|---|---|
| M1-unit | `npm test` | 既存＋壊れた LLM 返答 10 種以上の単体テストが全通過、場所つきエラー・修復警告 |
| M1-base | `npm run e2e` | headless Chrome 実再生＋MP3、歌/伴奏が有音、clip 0 |
| M1-fx | `npm run e2e:fx` | 既存4効果、同設定2回の相関 > 0.999、vocaloid 0/0.5/1 の MP3・有声差 ≤1 dB・無声2–8kHz ≥−6dB・音色差・clip 0 |
| M1-llm | `npm run e2e:llm` | 購読 LLM 2要望の未編集返答を UI へ貼付→即再生→MP3、両 stem 有音・clip 0、最終配置と画面証拠 |
| M1-mcp | `npm run mcp:smoke` | 道具と vocaloid 指定・MP3 が通る |
| M1-doc | README / NOTICE / LICENSE-POLICY の確認 | 日本語の往復手順・正しいライセンス・制約 |

各失敗の修復はテストごと最大2回、購読CLI切替は最大1回。結果・数値・証拠・commit・NEXT STEPS・BLOCKED APPROVALS は終了時に追記。

### M1 中間検証（10:43 JST）
- 旧録音傷を現状コードで再現: `out/baseline-fx.json`、対照の歌相関 0.9869、差分 −15.83 dB。未確認の原因説に依存せず、失敗を実測した。
- パーサの追加18件＋既存12件、`npm test` = 30 PASS。初回は全角修復履歴・別フェンスの名前区切り2件が失敗、1回修復して全通過。
- ポートを 5500–5599 に変更。MML のシャープ # は音符の後では許可する（宣言とは区別）。
- 購読 Sonnet の実返答1を取得。従量 fallback と通知を無効化、返答は status の result_text をそのまま保存。

### M1 オフライン描画の検証（10:47 JST）
- dtm の `playMML` を同期時計アダプタで包み、全イベントを OfflineAudioContext に予約。上流の音色・ドラム・ミキサーをそのまま使い、独自のシンセ実装や上流改変はしない。乱数は同期予約区間だけ固定 seed、時計・タイマー・乱数は finally で復元。
- 歌・伴奏・ミックスを同じオフラインレンダーで得て、ミックス PCM を AudioContext で実再生。AudioWorklet の取りこぼしに依存しない。
- `npm run e2e`: PASS、MP3 RMS −14.60 dBFS / peak −1.87 dBFS / clip 0、歌 −19.34 dBFS、伴奏 −17.46 dBFS、頭 12.09 ms、参照との傷 0 ブロック。`out/offline-e2e.log`。
- `npm run e2e:fx`（既存4効果＋対照）: 全通過。対照歌相関 1.0000（変更前 0.9869）。録音問題の修復1回。`out/offline-fx.log`。
- 実 LLM の初回 UI 検証は2返答とも読み込み・自動再生・MP3・両 stem 有音・clip0。独自追加の MP3 バイト完全一致は FAIL。デコード相関は各1.0000、差分 −51.64 / −48.17 dB で微小。必須条件の相関 >0.999 に合う比較へ検査を修正（1回）。返答や音声を手編集していない。

### M1 ボカロ風 v2 統合と実 LLM（10:54 JST）
- `ae8a772:effects/vocaloid/dsp.js` を `src/core/vocaloid-v2.js` へ移植。元の applyVocaloid は維持し、解析用 pitchFrames の export だけを追加。`src/core/vocaloid.ts` でラッパー処理。UI と共通 EFFECT_TYPES / MCP set_effects へ vocaloid を追加。
- 有声確信度を窓中心間で補間し、確信度 ≥0.75 の同一サンプル集合で入力と wet の RMS を合わせる。0.2〜0.7 の間で dry→wet を滑らかに切り替え、無声は原音経路を残す。音高を新たに生成・補正しない。
- 今回の原音に対する v2 単体の有声 RMS 差は **+4.054 dB**。背景の約+8.5dBという固定値はこの入力では再現しない（元 DSP のレベリングは入力依存）。入力に依存しない固定減衰ではなく実測 RMS 比で補正した。

| 強度 | 有声 RMS 差 dB | 無声2–8kHz エネルギー差 dB | 有声重心 Hz | MP3 RMS / peak dBFS | clip |
|---|---:|---:|---:|---|---:|
| 0 | 0.0000 | 0.000 | 3044.49 | −14.60 / −1.87 | 0 |
| 0.5 | −0.00194 | +0.481 | 3805.11 | −14.53 / −2.97 | 0 |
| 1 | −0.00673 | +0.518 | 4111.28 | −14.53 / −2.52 | 0 |

測定は同じ原音基準。YIN 型有声検出で有声312,236 samples、STFT 有声602窓、非無音かつ無声14窓。STFT=2048 / hop512、Hann、重心は振幅重み。子音は確信度平均<0.25・原音窓平均パワー>1e−7の同一窓の2–8kHz積算エネルギー比。入力の有声重心3044.49→元v2 4120.67（+1076.18Hz）、統合版4111.28（+1066.79Hz）、上昇量 **99.13%** を維持。強度0の歌stemは差分0。全曲の歌・伴奏は有音。

- `npm run e2e:fx`: 25チェック PASS。歌・mix・MP3の繰り返し相関は各1.0000、すべての強度の実再生も Analyser で確認。`out/e2e-fx-verified.log`, `out/e2e-fx.json`。
- Sonnet / Codex の実返答は `fixtures/llm-real/answer-{1,2}.txt`。status の result_text を未編集保存し、SHA-256と生成元を `provenance.json` に記録。2要望で歌詞・テンポ・雰囲気が異なる。LLM呼出2回とも購読CLIで成功、従量fallback無し。
- MP3ボタンの実ダウンロードと自動操作用exportを両方確認。比較はデコード相関>0.999。再試験で過去ダウンロードを拾わないよう、実行ごとに固有の out/llm-downloads-<時刻>/ を使用（検証経路の強化。失敗後の追加修復ではない）。
- Clipboard追加検査で Chrome の write permission denied を実測。Puppeteer のローカル実装で `clipboard-sanitized-write` が別 permission と確認し、試験に明示。アプリも失敗時は選択＋コピーの fallback と日本語メッセージを追加（Clipboard検査では修復1回目、e2e:llm コマンドの失敗に対する修復は通算2回目）。

### M1 最終結果

| 受け入れ条件 | 結果 | 数値・証拠 |
|---|---|---|
| M1-unit `npm test` | **PASS** | 32件 / fail0。壊れた返答18種以上＋購読LLM2件。`docs/evidence/main-v1-unit.log` |
| M1-base `npm run e2e` | **PASS** | 8チェック。MP3 RMS −14.60 / peak −1.87 dBFS / clip0。歌 −19.34、伴奏 −17.46 dBFS。頭12.09ms、傷0ブロック。実再生9.513秒・Analyser最大RMS0.324。`docs/evidence/main-v1-e2e.log` |
| M1-fx `npm run e2e:fx` | **PASS** | 25チェック。既存4効果・対照・vocaloid強度3種。対照相関: 歌1.0000 / mix1.0000 / MP3 1.0000（>0.999）。有声差最大0.00674dB、子音差最小0dB、重心上昇99.13%維持、clip0。`docs/evidence/main-v1-fx.log` |
| M1-llm `npm run e2e:llm` | **PASS** | 17チェック。未編集2返答→UI貼付→自動再生→実MP3ダウンロード。プロンプトコピー・現在曲同梱・場所つきエラー・修正依頼コピーも通過。`docs/evidence/main-v1-llm.log` |
| M1-mcp `npm run mcp:smoke` | **PASS** | 12道具。set_effects(vocaloid,0.5)→check→MP3。141,688bytes、mix −15.44 / peak −3.03 dBFS、歌 −22.32、伴奏 −18.73、clip0。`docs/evidence/main-v1-mcp.log` |
| M1-doc | **PASS** | 日本語READMEにプロンプト往復・修復・MML割当・再生と書き出し・購読CLI手順。NOTICE / LICENSE-POLICY更新。SPECはM3の対象として変更していない |

#### 実 LLM の音声

| 返答 | 購読LLM / 要望 | MP3 RMS / peak dBFS | 歌区間 / 伴奏区間 RMS dBFS | clip | 実再生の秒数 / 最大RMS |
|---|---|---|---|---:|---|
| 1 | Sonnet 5.5 / 春・120BPM | −14.28 / −1.87 | −18.96 / −17.48 | 0 | 9.513 / 0.372 |
| 2 | Codex exec-sol / 夜・96BPM・vocaloid0.5 | −14.45 / −2.56 | −19.24 / −17.81 | 0 | 11.510 / 0.267 |

実再生は headless `/usr/bin/google-chrome --disable-gpu` の AudioContext＋Analyser で316〜384回以上観測。歌/伴奏区間の数値は同一レンダーのstem、MP3の数値は実ダウンロードをffmpegでデコード。元返答のSHA-256は読み込み前に照合し、手修正していない。

#### 変更と証拠

- プロンプトは要望・書式・完全例・任意の現在曲を自己完結で含む。JSON内MMLを正規方式とし、別フェンスも補完可能。
- パーサは候補選択・文字列を壊さないコメント/末尾カンマ修復・スマート引用符・全角・数値/歌詞/音名の正規化・効果の警告と補正。画面で修復一覧と場所つき修正依頼を表示。
- 読み込みで歌を合成し自動再生。コピーのfallback、再生中断の反映、返答データを凡例のHTMLとして実行しない処理も追加。
- オフラインの音声グラフを実再生と書き出しに共用。負荷依存のAudioWorklet録音傷を解消した。
- v2の処理とラウドネス/子音保護の説明・測定値は上の節。元v2はそのまま保存し、ラッパーで補正。
- 集約データ: `docs/evidence/main-v1-m1.json`（ベースライン失敗、最終数値、出力SHA-256）。画面: `docs/evidence/main-v1.png`、`docs/evidence/pianoroll.png`。
- 生ログ・stem・プロンプトは `out/`。購読LLMの生成ID・未編集返答・hashは `fixtures/llm-real/`。上流ファイルやモデルのコピーはしていない。

受け渡し（音声はcommitしない）:

- `/workspace/browser-dtm-final/llm-answer-1.mp3`（228,832bytes）
- `/workspace/browser-dtm-final/llm-answer-2.mp3`（277,106bytes）
- `/workspace/browser-dtm-final/vocaloid-0.mp3`, `vocaloid-0.5.mp3`, `vocaloid-1.mp3`（各228,832bytes）
- `/workspace/browser-dtm-final/screenshot-main.png`

#### 失敗・修復回数と残る制限

- `npm test`: 初回28/30（全角修復履歴・別MMLの名前区切り）。修復1回→30/30。その後追加した実LLM・空optional/和音引用符を含め最終32/32。
- `e2e:fx`: 変更前の対照相関0.9869でFAIL。オフライン化の修復1回→相関1.0000、以降全PASS。
- `e2e:llm`: 独自のバイト完全一致検査を、実測相関に基づき指定の>0.999へ修正（修復1）。その後追加したClipboard検査のpermission不足を、Chromeのローカル実装で確認して修復（修復2）。最終17/17。過去ダウンロード混入を避ける固有ディレクトリも導入。各返答は未編集。
- 失敗に対する修復は合計4回（単体1・録音1・LLM e2e2）。各コマンドで上限2以内。購読呼出はSonnet→Codexの指定ロール切替1回、障害/枠不足によるCLI切替0回。Opus判断・従量APIは不使用。
- MP3の約25ms符号化遅延は残る。Web Audio内部の微小差のため、MP3バイト完全一致は保証しない（必須の波形相関基準は通過）。4小節2曲での往復と、この歌でのv2測定であり、任意の長さ/歌声の音質を保証するものではない。

#### commits（すべて origin/main-v1 へ通常 push）

| commit | 内容 |
|---|---|
| `44105e1` | M1のGOAL / ACCEPTANCE TESTSを先に記録 |
| `a5b5260` | パーサ・単体テスト・Sonnet実返答・ポート変更 |
| `adc8369` | dtmのオフライン予約と歌の共通描画、自動再生UI |
| `238bfd1` | vocaloid v2、音量/子音補正、実LLM2件のUI試験、README |
| この最終記録commit（`git log -1`） | 証拠・結果・手書き使用量ログ |

#### NEXT STEPS

M1の必須条件は完了。次の別ジョブは予定どおりM2（SoundFont楽器・ピアノロール編集）、M3（サンプル集・MCP整合・SPEC更新）。今回は着手していない。残る符号化遅延・長い曲の負荷/音質検証は後続で扱う。

#### BLOCKED APPROVALS

なし。公開・PR・上流issue・外部メッセージ・購入・認証情報の変更・従量API・プロジェクト外の削除はしていない。依頼された購読LLMの往復と非公開origin/main-v1へのpushのみ実施。

#### 作業終了・制約

- 開始: 2026-11-16 10:38:17 JST
- 終了記録（最終commit直前）: 2026-11-16 10:57:57 JST
- 所要: 19分40秒。110分の切上げ期限12:28 JSTより前に完了。
- 使用ポート5500 / 5501 / 5502。すべて試験のfinallyで終了し、5500–5599のlistenerがないことを確認。CPUのみ。他worktreeは操作していない。音声・モデル・SoundFont・秘密情報のcommit無し。接続障害無し。

## main-v1 M2

開始: 2026-11-16 10:59:16 JST。110分で切り上げ（12:49:16 JST）、全体120分以内。

### GOAL
M1の実装を維持し、実行時ロードのFluidR3 GMによる旋律楽器・ドラムを再生とMP3へ統合する。ロード失敗時は警告と内蔵シンセへフォールバックする。
歌のcanvasピアノロールに追加・移動・長さ・削除・かな・undo/redoを実装し、SongDocと現在曲プロンプトへ即時反映する。上流はimport/wrapのみ、音声・SoundFont・モデルはcommitしない。M3は対象外。

### ACCEPTANCE TESTS
| ID | コマンド | PASS条件 |
|---|---|---|
| M2-unit | `npm test` | M1全件＋tick/小節/拍/音価往復、snap、重なり、編集操作、GM楽器指定が通る |
| M2-sf | `npm run e2e:soundfont` | Chrome実再生・MP3、内蔵/SF伴奏stemの相関とスペクトル重心が明確に異なる、歌/伴奏有音、clip0。ロード失敗時も警告＋有音。最終soundfont-song.mp3 |
| M2-roll | `npm run e2e:pianoroll` | Chromeマウスで追加/移動/長さ/削除/かな/undo/redoを確認、SongDocとプロンプト反映、編集後実再生・MP3、歌詞可視スクリーンショット |
| M2-regression | `npm run e2e` / `npm run e2e:fx` / `npm run e2e:llm` / `npm run mcp:smoke` | M1受入検査をすべて維持 |
| M2-doc | README / NOTICE / LICENSE-POLICY | 日本語の楽器・編集操作、一次情報のSoundFont/配信元ライセンス、非同梱方針 |

失敗の修復は各テスト2回まで。各作業段階でprojectファイルのみcheckpoint commit/push。終了時に結果・証拠・commit・NEXT STEPS・BLOCKED APPROVALSと手書き使用量ログを記録する。

### M2 実装・確認（11:08 JST）
- 問題を確認: M1の`playMML`は内蔵シンセで、旧未解決2は現状でも成立。公開`createDtmStudio.play`は非同期で先読みし、内部`loadInstrument`は失敗をcatchして無音にする。公開`playNoteEvent`は既定プリセット専用で、任意のトラック楽器を指定できない。このため、ロード失敗を捕捉して確実にオフライン予約する最小の方法として、**SoundFontクラス1つだけ**を同版の上流`DTM_DIR/src/instruments/sf/SoundFont.ts`からread-only importする。npm側の公開`playMML`/GM一覧/ドラム辞書/units変換を使い、発音フックへ接続。上流のfork/patch/コピーは無し。build時にnpmとcloneのversion一致を確認する。内部APIなので上流更新時は再確認が必要。
- FluidR3の元README/COPYING（MuseScore保存版）とWebAudioFont dataのMIT LICENSEを一次情報で確認し、NOTICEとLICENSE-POLICYに配信元・原作者・非同梱方針を記録。GeneralUser GSは追加しない。
- 最初のSF試験はgetDrumPatternKeysの必須辞書引数不足でFAIL。修復1で楽器・ドラムのロード、相関−0.069、MP3 clip0を確認。遮断試験でキャッシュ済み音源を使ってしまったため、修復2で別ページ・遷移前遮断・cache無効化へ。結果は最終表に記録する。
- `npm test`は追加5件を含め37 PASS / 0 FAIL。tick往復、snap、境界、重なり、各編集、history、GM指定を検査。編集UIはSongDocへ書き戻し、再生中なら停止して歌のcacheを無効化する。

### M2 編集操作・回帰（11:13 JST）
- `e2e:soundfont`は修復2後に6/6 PASS。楽器2音色・ドラム4キーを実URLからロード。内蔵/SF伴奏相関−0.069、重心3440.13→3255.25Hz（差184.88Hz）。MP3 RMS−15.29 / peak−1.28dBFS、clip0。外部6リクエストを意図的に遮断する別ページでも警告・内蔵伴奏・実再生が成立（実際の接続障害ではない）。
- ピアノロール初回はPuppeteerの`clickCount`が`Mouse.click`内部の`count=1`で上書きされ、ダブルクリックが送られていなかった。ローカルのPuppeteer実装を確認し、`count:2`へ修復1。アプリのdblclick経路は変更せず、実マウスとUnicodeキー入力でかな編集まで検証した。
- `e2e:pianoroll`は14/14 PASS。追加・時刻/音高移動・右端長さ・かな「きゃ」・Ctrl+Z/Shift+Z・Delete/Backspace/右クリック・重なり拒否・プロンプト反映。歌stem編集前後相関0.803、編集後MP3 RMS−18.47 / peak−1.29dBFS、clip0。Chrome実再生5.5196秒、最大RMS0.2938。
- 三連音符を曲端へ移動するときも開始をグリッドに揃える境界処理と単体1件を追加（受入失敗に対する修復ではない）。単体38/38 PASS。
- `e2e` 8チェック / `e2e:llm` 17チェック / `mcp:smoke` PASS。`e2e:fx`の最終確認中。
- dtm上流読取専用clone: commit `3a89f4f1bc12a6c4e9562bcc551b6abf5132892a`、package version2.1.38。再現用にDTM_DIRの準備とこのcommitをREADMEへ記載。

### M2 最終結果

| 受入条件 | 結果 | 数値・証拠 |
|---|---|---|
| M2-unit `npm test` | **PASS** | 38/38、fail0。M1全32件＋編集/GM6件。`docs/evidence/main-v1-m2-unit.log` |
| M2-sf `npm run e2e:soundfont` | **PASS** | 6/6。旋律0000/0330＋ドラム36/42/38/39。伴奏相関−0.069、重心3440.13→3255.25Hz。MP3 RMS−15.29 / peak−1.28dBFS、clip0。歌区間−19.34 / 伴奏区間−18.11dBFS。Chrome9.5134秒・最大RMS0.3198。遮断6件→日本語警告・内蔵伴奏−18.20dBFS・実再生。`docs/evidence/main-v1-m2-soundfont.log` |
| M2-roll `npm run e2e:pianoroll` | **PASS** | 14/14。全編集操作とhistory、重なり拒否、現在曲プロンプト反映。変更前後の歌相関0.803。編集後MP3 RMS−18.47 / peak−1.29dBFS、clip0、歌−26.35 / 伴奏−20.82dBFS。`docs/evidence/main-v1-m2-pianoroll.log`、`main-v1-m2-pianoroll.png` |
| M1回帰 `npm run e2e` | **PASS** | 8/8。SoundFontが既定でも頭の差0.63ms、傷0ブロック、両stem有音、MP3 clip0。`docs/evidence/main-v1-m2-e2e.log` |
| M1回帰 `npm run e2e:fx` | **PASS** | 25/25。同設定の歌/mix/MP3相関各1.0000。有声RMS差最大0.00674dB、子音2–8kHz差最小0dB、重心上昇99.13%保持、各MP3 clip0。`docs/evidence/main-v1-m2-fx.log` |
| M1回帰 `npm run e2e:llm` | **PASS** | 17/17。既存の購読LLM未編集2返答を再利用、SoundFontでUI往復・MP3・clip0。LLMの新規呼出無し。`docs/evidence/main-v1-m2-llm.log` |
| M1回帰 `npm run mcp:smoke` | **PASS** | 12道具、vocaloid0.5→check→MP3。141688bytes、mix−15.72 / peak−1.61dBFS、歌−22.32 / 伴奏−19.30dBFS、clip0。`docs/evidence/main-v1-m2-mcp.log` |
| M2-doc / build | **PASS** | `npm run build`成功。日本語READMEにGM名/番号・編集操作・DTM_DIR同版ソースの準備、NOTICE/LICENSE-POLICYに一次資料・著作権・URL・非同梱方針 |

#### 変更と証拠

- SongDocに`instrument: string | number`（GM0〜127）を追加し、旧`program`を維持。MMLへ楽器とFluidR3宣言を付け、プロンプトへ短いGM一覧・指定例を追加。ドラムはFluidR3標準キット。
- 再生とMP3/WAVは同一のオフライン描画。必要な音色をURLから先読みし、dtm自身のSoundFont発音を公開シーケンサのフックで予約する。ロード失敗・15秒の時間切れでは警告して内蔵へ落ちる。UIで内蔵/SFを切替可能。
- canvasの歌音符をクリック追加・ドラッグ移動・右端resize・Delete/Backspace/右クリック削除・小入力欄のかな編集に対応。1/4,1/8,1/16 snap、100段階history、単音重なり拒否、C3〜C6と曲境界の保持。SongDocと現在曲プロンプトへ即反映し、次回再生で再合成。
- 視覚確認でも編集後の「さ」「きゃ」「ら」が読めることを確認。伴奏は編集対象外。UIは歌の音域C3〜C6を表示する（低いベースは凡例と音声で確認）。全曲幅を表示するため長い曲の拡大/スクロールは後続の検討。
- 集約JSON: `docs/evidence/main-v1-m2.json`（全数値・変更後SongDoc・出力hash・修復回数）。最初の失敗ログも `docs/evidence/m2-{soundfont-initial,soundfont-repair1,roll-initial}.log` に保持。
- 原音声・stemは `out/`、音源データはブラウザの実行時だけ。上流cloneはread-only、音声/モデル/SoundFontをcommitしていない。起動ポート5500〜5504はすべてfinallyで閉じ、`ss -ltnp '( sport >= :5500 and sport <= :5599 )'`でlistener無しを確認。

受け渡し（音声はcommitしない）:

- `/workspace/browser-dtm-final/soundfont-song.mp3`（228832bytes）
- `/workspace/browser-dtm-final/screenshot-pianoroll.png`（編集後の歌詞可視）
- `/workspace/browser-dtm-final/pianoroll-edited.mp3`（132911bytes）

#### commits

| commit | 内容 |
|---|---|
| `4a3895a` | 実装前にM2 GOAL / ACCEPTANCE TESTSを記録 |
| `08beff7` | 実行時FluidR3・フォールバック・GM・編集モデル/UI・ライセンス |
| `3ead900` | マウス編集e2e・曲端のsnap・日本語手順・中間結果 |
| この最終記録commit（`git log -1`） | 最終結果・集約証拠・手書き使用量ログ |

すべて`main-v1`へcommitし、`git push origin HEAD`による通常push。PR・force-push・公開は無し。

#### NEXT STEPS

M2の必須条件は完了。M3（サンプル集ページ・MCP整合・SPEC更新）は未着手として次のジョブへ残す。dtm内部ローダーを使う制限は上記のとおりで、上流更新時はDTM_DIRの同版確認とe2e:soundfontで再検証する。MP3約25msの符号化遅延はM1から継続。

#### BLOCKED APPROVALS

なし。外部メッセージ・購入・認証情報変更・プロジェクト外削除・従量API・公開・上流issue/PRは実行していない。非公開origin/main-v1へのpushは依頼どおり実施。

#### 修復回数・制約

失敗後修復は計3回（SoundFont受入2、ピアノロール受入1）、各テスト上限2以内。単体とM1回帰の修復0。CLI切替0、購読CLI/Opus呼出0、従量API使用0。GPU不使用。他worktree未操作。実際の接続障害は無し（音源遮断はテストによる意図的シミュレーション）。

開始: 2026-11-16 10:59:16 JST。終了記録（最終commit直前）: 2026-11-16 11:14:53 JST。所要15分37秒。110分切上げ期限12:49:16 JSTより前に終了。

## main-v1 M3

開始: 2026-11-16 11:16 JST。80分（12:36 JST）で切り上げ。

### GOAL
サンプル集（曲3・伴奏2・効果2以上）、Claude/ChatGPT用の自己完結コピー、実LLM往復2件、MCPのSongDoc整合、日本語ドキュメントと最終音声検証を完了する。M1/M2を維持し上流はimport/wrapのみ。

### ACCEPTANCE TESTS
| ID | コマンド | PASS条件 |
|---|---|---|
| M3-unit | `npm test` | 全既存＋gallery全JSONのM1パーサ/検査、MCP丸ごと読込・楽器・prompt一致 |
| M3-gallery | `npm run e2e:gallery` | 7枚以上、歌合成＋SoundFont実再生/録音非無音、両copy内容、アプリへ読込、最新gallery画面 |
| M3-real | `npm run e2e:real` | 未編集gallery/16小節以上LLM返答をUI貼付・実再生・MP3、両stem非無音、clip0、句別合成時間と同期 |
| M3-mcp | `npm run mcp:smoke` | 楽器指定・vocaloid、get_songと貼付JSON一致、prompt、MP3実再生、最終フォルダへ保存 |
| M3-final | `npm ci && npm run build && npm test` ＋全e2e＋mcp:smoke | 全通過、全MP3をffmpegで計測、最新main/pianoroll/galleryスクリーンショット |
| M3-doc | README/SPEC/NOTICE/LICENSE-POLICY | 日本語手順、コピー往復・サンプル集、依存版/ライセンス/ローカルURL |

失敗後の修復は各テスト最大2回、CLIの代替切替最大1回。従量API不使用。成果音声・モデルはcommitしない。

### M3 実装ステップ1
- 7枚（曲3・伴奏2・効果2）、M1共通プロンプト、用途別コピー・分類・メインへのURL読込を実装。試聴は同一オリジンの作曲画面を再生ホストにし、VocaTab/FluidR3/エフェクト/時計を共用。
- `npm test`: 47/47 PASS、既存38件を維持。新規は全7JSON・用途別コピーとMCP全体読込/楽器0/名称/状態維持。`out/m3-unit-initial.log`。
- MCP: `load_song_json` / `get_prompt`追加、`set_track_mml.instrument`対応。`get_song`既定/fullは同じSongDoc全体、旧summaryは明示指定で保持。
- npm 2.1.38同梱物を確認: distに内部SoundFontは存在するがexportされず、同梱ソース・source mapも無い。npmを改変して内部exportを足す方法は上流patch禁止に反するため採用しない。DTM_DIRの同版cloneを維持し手順を明記する。
- 参考: https://designbookmark.com/motion のカテゴリ付きカード一覧・その場で試す・用途別コピーの導線を参照。外部のUIコードや素材は取り込まない。

### M3 実装ステップ2
- 購読CLI実返答: gallery `20261116-112030-creative-sonnet-1a3b`（Claude、11.3秒）とlong `20261116-112056-exec-sol-2a27`（Codex、54.9秒）。status.result_textを未編集で保存。SHA-256・依頼はfixtures/llm-real/m3-*。CLI障害/切替0、従量APIへのfallback無し。
- 単体48/48 PASS。gallery e2eは12/12 PASS（分類3、両コピー/表示、PCM両stem有音、SoundFont、実再生、メインへの読込）。MCPは14道具・instrument番号/名称・vocaloid・JSON往復一致・prompt・MP3実再生がPASS。
- 長尺返答は16小節・48モーラ、Aメロ8小節/サビ8小節、ピアノ0/ベース33/弦48＋8beat。全MMLをパースし各16.000小節、over/under 0。画面貼付時の自動修正0。
- README/SPECへ往復とサンプル集を追記、NOTICE/LICENSE-POLICY更新。句別合成時間をexport統計に追加（音声には変更無し）。
