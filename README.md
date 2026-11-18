# browser-dtm

ブラウザで「歌＋楽器」の曲を作る DTM アプリの最小版。歌は VocaTab の歌声合成エンジン、楽器は onjmin/dtm を使い、曲や歌詞は LLM から操作できるようにする。

- 指示書: [SPEC.md](SPEC.md)（3手法共通） / 設計メモ: [docs/design-memo.md](docs/design-memo.md)
- ライセンス方針: [LICENSE-POLICY.md](LICENSE-POLICY.md) / 著作権表示: [NOTICE.md](NOTICE.md)
- デモ: https://stealthinu.github.io/browser-dtm/ （サンプル集: https://stealthinu.github.io/browser-dtm/gallery.html ）
- 正本は `main`。開発履歴は `main-v1` と REPORT に残す。
- 使用量ログ: `logs/usage-<手法>.md`（集計は `tools/collect-usage.py`）
- 結果メモ: [REPORT.md](REPORT.md)

**歌声モデルは同梱しません。** ブラウザが [VocaTab 公式配布](https://wavtechyukky.github.io/vocatab/) から直接読み込みます（個人・非商用、再配布禁止）。SoundFont も同梱せず、実行時に配信元から読みます（SPEC §4）。

---

## 仕組み（main-v1）

SPEC の推奨どおり「C（自前の薄いホストアプリ）、中は B（別々に描画して同じ時計で混ぜる）」。上流は改造しない。

```
LLM の返答 → src/core/prompt.ts（候補選択・軽い修復・検査）→ SongDoc
歌: VocaTab Worker → 合成済み PCM → 歌エフェクト
伴奏: FluidR3 GMを実行時ロード → dtm playMMLの発音フック → 全イベントを先に予約
歌＋伴奏: OfflineAudioContext でミックスと stem を描画
  → 同じ PCM を AudioContext で実再生 / lamejs で MP3 化 / WAV
```

- 歌は `$VOCATAB_DIR/ui/src/engine-web/worker.ts` を import してビルドする。公開サイトではモデル・ボコーダを VocaTab 公式 GitHub Pages から読む。手元の `npm run serve` では既定で `/vocatab/`（ローカルの上流 clone）を読む。`?model_base=` で上書きできる。onnxruntime-web は上流どおり jsDelivr から読む。CPU / WASM のみ。GitHub Pages は Cross-Origin Isolation 用ヘッダを付けられないため、公開サイトでは WASM は単スレッドになる（再生はできるが初回の合成は遅め）。
- dtm は npm の `@onjmin/dtm` を import/wrap する。楽器・ドラムはFluidR3 GM SoundFont（失敗時は警告して内蔵シンセ）。内部のSoundFontローダーだけは同版の上流cloneからimportする。上流は変更しない。オフライン予約中の時計・タイマー・乱数は同期区間だけ差し替え、`finally` で戻す。
- 書き出し用 PCM は実時間録音に依存しない。再生と書き出しは同じ処理を通り、繰り返し書き出しの歌・ミックス・MP3 の相関を検査する。ブラウザ内部の演算微差で MP3 のバイト列が完全一致しない場合がある。MP3 の符号化遅延は約25 ms。

## SongDoc（曲データの正本）

```json
{
  "version": 1, "title": "ゆうやけ", "bpm": 120, "beatsPerBar": 4, "key": "C", "bars": 4,
  "chords": "| C | F | Am G | C |",
  "tracks": [
    { "id": "vo", "kind": "vocal", "singer": "ritsu",
      "effects": [ { "type": "kero", "amount": 0.8 } ],
      "notes": [ { "bar": 1, "beat": 1, "len": "4", "pitch": "E4", "lyric": "ゆ" } ] },
    { "id": "pf", "kind": "inst", "instrument": "Acoustic Grand Piano", "mml": "o4 l4 'ceg' 'ceg' 'ceg' 'ceg'" },
    { "id": "ba", "kind": "inst", "program": "electric_bass_finger", "mml": "o2 l8 c c c c c c c c" },
    { "id": "dr", "kind": "drums", "pattern": "8beat" }
  ]
}
```

- 歌の音符: `bar`（1始まり）・`beat`（1始まり、小数可。`1.5` は1拍目の裏）・`len`・`pitch`・`lyric`（かな1モーラ）。音符は重ねない（単音）。音域 C3〜C6。
- **音価 `len` の表記**: `"1"` 全、`"2"` 2分、`"4"` 4分、`"8"` 8分、`"16"` 16分、`"32"`、`"64"`。付点は後ろに `.`（`"4."`、`"4.."` 複付点）、3連は `t`（`"8t"` = 3連8分）、タイは `+`（`"2+8"`）。4分 = 480 刻み（VocaTab の TPQ）。
- **音名 `pitch`**: `C4` = 中央のド = MIDI 60。`#`（`♯`）・`b`（`♭`）。
- **歌詞**: 1モーラ = 1音符。拗音（`きゃ`）は1、`ー`（`〜`）は伸ばし（前の母音を続ける）、`っ`・`ん` も1モーラ。カタカナはひらがなに揃える（VocaTab ではカタカナの母音は無声化を表すため）。`set_lyrics` は時刻順に配り、余ったモーラ（`surplus`）と歌詞の無い音符の数（`missing`）を返す。
- **伴奏 `mml`**: dtm の MML 記法（パートの中身だけ。`;` `@` や `#t0inst=...` の宣言は書かない（音符の `c#` は可）。アプリが `#t<n>inst=`・`#drum=`・`@<n>`・`t<bpm>` を付けて1本の MML に組み立てる）。
- **エフェクト `effects`**（歌トラック、複数可、`amount` 0〜1）: `kero`（ケロケロボイス: 最後の F0 を音符の音高の階段へ寄せて合成し直す）、`vocoder`（20 帯域のチャンネルボコーダー。キャリアは音符の音高のノコギリ波）、`bitcrusher`（16→3 bit、間引き 1→10）、`doubling`（揺らした遅延の写し2本を左右へ、ステレオになる）。`vocaloid`（ボカロ風 v2: F0 に基づく倍音マスク・フォルマント移動・高域調整。有声 RMS を入力へ合わせ、無声子音は原音へクロスフェード）。再生と書き出しの両方に掛かる。

## SoundFont の楽器・ドラム

伴奏は既定で **FluidR3 GM**。必要な音色だけ https://surikov.github.io/webaudiofontdata/sound/ から実行時に読みます。データは同梱しません。ドラムも同じSoundFontの標準キットです。再生・MP3・WAVは同じ音源を通ります。「伴奏: FluidR3 GM SoundFont」のチェックを外すと内蔵シンセと聴き比べられます。読み込み失敗や15秒の時間切れでは警告を表示して内蔵シンセで鳴らします。歌のエンジン初回読み込みには別途ネット接続が必要です。

伴奏トラックは `instrument` にGM名または **0始まりのGM番号（0〜127）** を指定できます。旧 `program` も使えます（両方あると `instrument` 優先）。MML本体の中に宣言を書かず、アプリが `#t<n>inst=` と `#t<n>font=FluidR3` を付けます。

| 番号 | instrument の例 |
|---:|---|
| 0 | Acoustic Grand Piano |
| 4 | Electric Piano 1 |
| 24 | Acoustic Guitar (nylon) |
| 33 | Electric Bass (finger) |
| 48 | String Ensemble 1 |
| 73 | Flute |

`{"id":"ba","kind":"inst","instrument":33,"mml":"o2 l4 c c g c"}` のように指定します。`program: "electric_bass_finger"` も互換です。FluidR3と配信リポジトリのMITライセンス・一次資料・著作権は[NOTICE.md](NOTICE.md)に記載しています。GeneralUser GSは今回の選択肢に含めません。

## ピアノロールで歌を編集

- 空白をクリックすると「あ」の音符を追加。スナップは1/4・1/8・1/16から選べます。
- 歌の音符をドラッグすると時刻と音高を移動。右端の印をドラッグすると長さが変わります。
- 音符を選んでDelete / Backspace、または音符を右クリックすると削除。
- ダブルクリックで小さなかな入力欄。1モーラを入力してEnterまたは欄外クリックで確定、Escapeで取消。カタカナはひらがなに揃えます。
- ピアノロールにフォーカスがある状態でCtrl+Z（Macは⌘Z）で元に戻す、Ctrl+Shift+Zでやり直す。ボタンでも操作できます（直近100操作）。

歌は単音なので、他の歌音符に重なる追加・移動・長さ変更は拒否して状態欄に理由を表示します。曲の範囲とC3〜C6を保ちます。伴奏は表示のみです。歌の編集を確定するとSongDocの `bar/beat/len/pitch/lyric` と「今の曲を土台にする」プロンプトに即反映し、再生中なら停止します。次の再生・書き出しで編集後の歌を合成します。曲を読み直すと編集履歴はリセットします。

## 準備

```bash
# 1) 依存（lockfile あり）
npm ci

# 2) 上流 VocaTab のソース（MIT。ビルドでエンジンを束ねるだけ。歌声モデルは commit しない）
git clone https://github.com/wavtechyukky/vocatab vendor/vocatab
export VOCATAB_DIR="$PWD/vendor/vocatab"
# または既にある clone を VOCATAB_DIR で指す（未設定なら vendor/vocatab を探す）

# 3) dtm は npm の @onjmin/dtm（2.1.38, AGPL-3.0-or-later）を使う（手順 1 で入る）

# 4) 同版の dtm 上流ソース（SoundFont クラスだけを読取専用 import）
git clone https://github.com/onjmin/dtm vendor/dtm
git -C vendor/dtm checkout 3a89f4f1bc12a6c4e9562bcc551b6abf5132892a
export DTM_DIR="$PWD/vendor/dtm"
# npm の dtm と DTM_DIR の package.json の version が一致しないと build は停止する。

# 5) ビルド（dist/ は .gitignore）
# 公開サイト向けはモデル根を公式に固定する:
#   MODEL_BASE=https://wavtechyukky.github.io/vocatab/ npm run build && npm run package:pages
npm run build
```

確認した版: VocaTab `2d2a48b`（2026-11-08）、`@onjmin/dtm@2.1.38`、Node 24、Chrome（`/usr/bin/google-chrome`）。
ネットワーク: onnxruntime-web 1.20.1 を jsDelivr、FluidR3 GMの楽器・ドラムをsurikovのGitHub Pagesから実行時に読む。内部SoundFont APIを使う理由・制限はREPORT M2を参照。

## 使う

```bash
npm run serve            # http://127.0.0.1:5500/ （PORT=5500〜5599）
```

### プロンプト往復の使い方

1. 「歌詞」にかなの歌詞、「イメージ」に雰囲気・テンポ・小節数・楽器などを書く。既存曲を変えるときは「今の曲を土台にする」を選ぶ。
2. 「プロンプトをコピー」を押して、契約している ChatGPT / Claude などへ貼る。役割、SongDoc 仕様、短い完全例、要望、任意の現在曲が含まれる。API キーは不要。
3. 返答を全文そのまま「LLM の返答を貼る」欄へ貼り、「読み込んで鳴らす」。歌の合成後に伴奏と自動再生する。正規の返答は **json フェンス1つの SongDoc 全体**で、伴奏 MML も JSON の `mml` 文字列に入れる。
4. 軽い崩れは自動修復して「自動修正した点」に表示する。JSON / 無印フェンス、説明文、裸 JSON、複数候補（最大の SongDoc）、末尾カンマ、コメント、スマートクォート、全角、数値の文字列、カタカナ歌詞、音名の表記ゆれに対応する。未知 effect は警告して省略し、amount は 0〜1 に補正する。
5. 別の mml フェンスでも、トラック名・`#t0` / `#t1`（dtm と同じ0始まり）・フェンス順で空の伴奏へ割り当てる。既に JSON にある MML は優先する。
6. 修復不能なら「歌 3小節目 2拍目」などの場所つきエラーを確認し、「修正依頼文をコピー」で LLM に返す。返答全体を貼り直す。
7. エフェクトを選び、強度を調整して再生。「MP3 書き出し」/「WAV」/「SongDoc JSON」で保存する。MP3・WAV はオフライン描画した音をブラウザで実再生してから保存する（実時間の再生時間はかかるが、録音の取りこぼしには依存しない）。

見本返答は `fixtures/sample-response.txt`。本物の購読 LLM の未編集返答2件は `fixtures/llm-real/`、生成元と SHA-256 は同ディレクトリの `provenance.json` に保存。

## サンプル集から作る

`http://127.0.0.1:5500/gallery.html`（上部の「サンプル集」リンク）に、曲3枚・伴奏2枚・歌の効果2枚を用意しました。「曲／伴奏／エフェクト」で絞り込めます。

- 「▶ 試聴」はページ内で歌声合成とFluidR3 GMの伴奏を実再生します。「■ 試聴を停止」で止められます。初回は読み込みに時間がかかります。
- 「アプリで開く」は作曲画面へSongDoc全体を読み込みます。再生・ピアノロール編集・MP3/WAV/JSON書き出しができます。
- 「Claude 用にコピー」「ChatGPT 用にコピー」は、サンプルのSongDoc全体・M1共通の書式仕様・変更のお願いをまとめてコピーし、「コピーしました」と表示します。ClaudeにはArtifactを付けない、ChatGPTにはリンクやコードではなくJSON本文を返すよう依頼します。
- コピー文の「イメージ」を好みに変えてLLMへ渡し、返答を作曲画面の「LLM の返答を貼る」へそのまま貼ります。サンプルの歌詞を使う場合は「アプリで開く」で歌詞欄も揃います。

サンプルは `fixtures/gallery/*.json` にある音符データです。音声素材や第三者の曲は使っていません。伴奏カードにも音合わせ用の短い歌を含め、エフェクトカードは歌＋伴奏で変化を試せます。

## テスト

```bash
npm test             # A5: SongDoc 変換・歌詞割り当て・検査・道具の単体テスト（node:test + tsx）
npm run e2e          # A1〜A3: headless Chrome で見本返答を貼り戻し→鳴らし→MP3 を out/song.mp3 に。数値は out/e2e.json
npm run e2e:fx       # A4: 4種の効果、対照相関、vocaloid 0/0.5/1 の有声RMS・子音・音色を比べる。数値は out/e2e-fx.json
npm run e2e:llm      # 購読 LLM の未編集返答2件を UI に貼付→自動再生→MP3 ボタン、数値は out/e2e-llm.json
npm run e2e:soundfont # 内蔵/SFの実再生・MP3・stemスペクトル比較、遮断時の警告とfallback
npm run e2e:pianoroll # マウス/キーボード編集→SongDoc/現在曲プロンプト→再合成・実再生・MP3・画面
npm run e2e:gallery  # 7カード・分類・両コピー・ページ内歌/SoundFont試聴・アプリで開く・画面
npm run e2e:real     # M3実返答2件: gallery/16小節をUI貼付→実再生→MP3、句別時間・同期
npm run mcp:smoke    # A6: 14道具、instrument/vocaloid・JSON往復・prompt・MP3
# 最終検証は npm ci → npm run build → npm test の後、上記すべてを実行
```

e2e はポート 5500、LLM e2e は 5502、MCP の書き出しは 5501、SoundFont は 5503、ピアノロールは 5504、ギャラリーは5505、M3実返答は5506を使い、終わったらサーバーと Chrome を閉じる。音声ファイルは `out/`（commit しない）。受け渡し用 MP3 と画面は `FINAL_DIR`（未設定なら `out/final/`）に保存する。

## MCP サーバー

```bash
npx tsx mcp/server.ts    # stdio
```

Claude Code / Claude Desktop などの設定例（パスは手元に合わせる）:

```json
{ "mcpServers": { "browser-dtm": { "command": "npx", "args": ["tsx", "mcp/server.ts"],
  "cwd": "/path/to/browser-dtm", "env": { "VOCATAB_DIR": "/path/to/vocatab" } } } }
```

道具: `load_song_json` `get_prompt` `get_song` `new_song` `set_chords` `set_track_notes` `set_lyrics` `set_track_mml` `set_drums` `set_effects` `set_mix` `check` `export`（mp3 既定 / wav / json / mml）`finish`。道具は事実（過不足・音域・はみ出し・エラーの場所）だけを返し、点数は返さない。`export` の mp3/wav は headless Chrome でアプリを開いて鳴らし、`out/<name>.mp3` に書き出す。`set_effects` は `{ "effects": [{ "type": "vocaloid", "amount": 0.5 }] }` に対応する。定義はブラウザと共有（`src/core/tools.ts`）。

`get_song` は既定と `part: "full"` で貼付用JSONと同じSongDoc全体、`part: "summary"` で要約を返します。`set_track_mml` の `instrument` はGM名または0始まり番号、旧 `program` も引き続き使えます。`load_song_json: {"text":"返答全文またはJSON"}` は画面と同じ取り出し・修復・検査を通し、失敗時は現在曲を保って `problems` / `fixRequest` を返します。`get_prompt: {"image":"サビを高くする"}` は現在曲・仕様・歌詞・要望を含むコピー文を返します（`lyrics` の上書きも可）。

## ファイル

| 場所 | 中身 |
|---|---|
| `src/core/songdoc.ts` | SongDoc の型・検査・変換（VocaTab Note / dtm MML）・歌詞の割り当て |
| `src/core/tools.ts` | LLM 向けの道具（ブラウザ・MCP 共通） |
| `src/core/gallery.ts`, `src/web/gallery.ts`, `web/gallery.html` | サンプル一覧・用途別コピー・作曲画面を共用する試聴 |
| `src/core/prompt.ts` | プロンプト・返答の取り出し・修正依頼文 |
| `src/core/fx.ts` / `encode.ts` | エフェクト（ボコーダー・ビットクラッシャー・ダブリング）/ MP3・WAV・数値 |
| `src/web/vocal.ts` | VocaTab engine-web を画面なしで呼ぶ（＋ケロケロの F0） |
| `src/core/pianoroll.ts` / `src/web/pianoroll.ts` | 音符編集・スナップ・履歴とcanvas操作 |
| `src/web/soundfont.ts` | FluidR3 GMの先読み・発音（dtm内部SoundFontクラスの薄いラッパー） |
| `src/web/player.ts` | dtm と歌をオフラインで描画し、同じ PCM を再生 |
| `src/web/main.ts`, `web/index.html` | 画面 |
| `mcp/server.ts` | MCP サーバー |
| `scripts/` | ビルド・e2e・数値・MCP のスモーク |
| `fixtures/` | 依頼と「LLM が返しそうな見本返答」 |

## 著作権表示

- VocaTab — MIT License, Copyright (c) 2026 wavtechyukky（https://github.com/wavtechyukky/vocatab）。歌声モデル・ボコーダは個人・非商用・再配布禁止。歌い手のクレジット: 波音リツ（「波音リツ」「カノン」）、夏目悠李（歌声DB制作: アマノケイ／音声提供者: 霧野蒼太）、御丹宮くるみ。
- dtm — AGPL-3.0-or-later, (c) onjmin（https://github.com/onjmin/dtm）。本アプリも AGPL-3.0-or-later（[LICENSE](LICENSE)、方針は LICENSE-POLICY.md）。
- 詳細は [NOTICE.md](NOTICE.md)。


## 本物の LLM 返答の再取得（購読 CLI のみ）

```bash
node scripts/make-prompt.mjs  # out/llm/prompt-{1,2}.txt。画面と同じ buildPrompt
JEV_AUTH_FALLBACK=0 JEV_AUTH_NOTIFY=0 JEV_NO_PREAMBLE=1 jev-route run creative-sonnet - < out/llm/prompt-1.txt --caller ブラウザDTM --title "browser-dtm LLM answer 1" --no-quota
JEV_AUTH_FALLBACK=0 JEV_AUTH_NOTIFY=0 JEV_NO_PREAMBLE=1 jev-route run exec-sol - < out/llm/prompt-2.txt --caller ブラウザDTM --title "browser-dtm LLM answer 2" --no-quota
```

`~/jev-starter/status/<id>.json` の `result_text` を未編集でテキスト保存する。従量 API への fallback は無効にする。通常の e2e は commit 済みの返答を再利用し、LLM を再呼び出ししない。SoundFont・ピアノロール編集はM2で実装済み。M3ではサンプル集・MCP整合・SPEC更新・16小節の実LLM往復も実装・検証済み。

### M3 の実返答を再取得する場合

```bash
node scripts/make-m3-prompts.mjs
JEV_AUTH_FALLBACK=0 JEV_AUTH_NOTIFY=0 JEV_NO_PREAMBLE=1 jev-route run creative-sonnet - < out/llm/gallery-prompt.txt --caller ブラウザDTM --no-quota --title "browser-dtm gallery LLM answer"
JEV_AUTH_FALLBACK=0 JEV_AUTH_NOTIFY=0 JEV_NO_PREAMBLE=1 jev-route run exec-sol - < out/llm/long-prompt.txt --caller ブラウザDTM --no-quota --title "browser-dtm long song LLM answer"
```

今回のジョブIDとハッシュは `fixtures/llm-real/m3-provenance.json`、未編集返答は `gallery-answer-1.txt` / `long-answer-1.txt`。`scripts/capture-m3-answer.mjs` は今回のジョブ専用です。新規取得時は新しいstatusを参照し、既存返答を上書きせず保存してください。通常のテストは保存済み返答を使い、LLMを呼びません。

dtmのnpm配布物は `dist/index.mjs` に内部SoundFontを含みますが、そのクラスをexportせず元ソース/source mapも含みません。上流改変や抽出コピーはせず、DTM_DIRは上の固定commit（package version 2.1.38）を引き続き使います。DTM_DIR の指定は必須です。VocaTab ソースも別途必要です。

最終チェックを同じ順序でまとめて再実行する場合は `node scripts/final-verify.mjs`。`npm ci` から全e2eとMCPまでを順番に実行し、失敗時は停止して `docs/evidence/main-v1-m3-*.log` と `out/final-verification.json` に結果を残します。その後の `node scripts/final-evidence.mjs` は最終フォルダ内の全MP3をffmpegで測り、スクリーンショットの更新時刻と集約JSONを保存します。
