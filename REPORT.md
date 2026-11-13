# REPORT — impl/claude-code

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
