# ブラウザで動く「歌＋楽器」DTM 設計メモ v0（2026-11-12 JST）

実装・リポジトリ作成・公開・上流への issue/PR はまだしない。読んだのは次の2つの shallow clone。
- vocatab: wavtechyukky/vocatab @2d2a48b（2026-11-08 13:59 JST）
- dtm: onjmin/dtm @3a89f4f（2026-11-09 15:28 JST、package 2.1.38）

**[事実]** はコードと文書で確かめたこと、**[推測]** はまだ確かめていないこと。

---

## 0. 2つのリポジトリの要点（[事実]）

| | VocaTab | dtm |
|---|---|---|
| 何をするか | ブラウザで動く歌声合成エディタ（日本語3人のボイスバンク同梱） | MML を中間言語にした DAW／ピアノロールの部品（楽器・ドラム・UTAU 歌声・自動作曲） |
| 技術とビルド | TS（フレームワークなし、Canvas2D/WebGL2）。`python tools/build.py`（`npx esbuild` で `ui/dist/app.js` と `ui/dist/engine-worker.js` を作る）。静的配信で動く。Python 版は `engine/server.py`（FastAPI、PrettyPitch の clone が要る） | TS、pnpm、tsup。`pnpm build` → `dist/`（npm `@onjmin/dtm`）。`pnpm dev` で demo サーバー。テストは `pnpm test`（scripts/test/*） |
| 曲データ | `ui/src/model.ts`: `Project{bpm, beatsPerBar, tracks[]}`、`Note{onset,dur (TPQ=480), pitch=MIDI, lyric, attrs}`。トラックは `kind: "vocal"\|"audio"`、声の曲線は `params`。保存は `.svsproj`（JSON、`ui/src/projectfile.ts`、FORMAT_VERSION=2）。テンポは曲全体で1つ | **MML 文字列そのものが正本**（`getMML()`／`loadMML()`、`src/types.ts:777,802`）。内部の `Note{startStep,durationSteps,pitchUnits,velocity}`（`src/types.ts:43`）。ピッチは 1/372 oct 単位（12平均律の半音=31、A4=2139 → MIDI = units/31）。1小節 192 step（`scripts/compose/strata-compose.ts` の `BAR=192`）。宣言 `#drum=` `#t<n>font=` `#audio2=` など（README） |
| 歌詞 | 音符ごとに `lyric`（かな・ローマ字・音素列）。空・`-`・`ー`・`+` は伸ばし（`ui/src/engine-web/score.ts:238,309`） | 歌詞トラック `@@<トラックID> <モデル> <かな歌詞>`。1文字（拗音2文字）＝1音符。`ー`／`〜` 継続、`っ` 促音（音符を使う）、`_` 休符、`、` ブレス、`「…」` 語り（README、`src/voice/lyrics.ts:463 normalizeLyrics`） |
| 音の出し方 | モデルは onnxruntime-web 1.20.1（WASM、任意で WebGPU）を Web Worker で実行（`ui/src/engine-web/worker.ts`、jsDelivr から読む）。流れ: analyze（楽譜→音素長→F0）→ 画面側で最終 F0 を組み立て（`ui/src/engine.ts composeF0`）→ synthesize（LeapSinger→NHVSing→波形）。再生は WebAudio（`ui/src/audio.ts`）、書き出しは OfflineAudioContext（`ui/src/export.ts`） | WebAudio。楽器は WebAudioFont 形式の SoundFont を実行時に CDN から読む（`src/instruments/sf/SoundFont.ts:190`、`soundfont-banks.ts`）。歌声は koe（UTAU 音源、WORLD ボコーダの WASM）を Worker で実行（`src/voice/voice-worker.ts`）。先読みつきシーケンサ（`src/audio/sequencer.ts`）。WAV 書き出しは実再生を ScriptProcessor で録る（`src/ui/studio.ts:2274-2320`） |
| 外から呼べる口 | 公開 API は無い。エンジンは Worker のメッセージ（`ui/src/engine-web/protocol.ts` の `init/analyze/synthesize/breaths/breath`）と `EngineClient`（`client.ts`）。core は DOM に依存しない。Python 版は HTTP `/api/info` `/api/analyze` `/api/synthesize` `/api/breaths` `/api/breath`（`engine/server.py`、CORS 設定なし） | npm ライブラリとして豊富: `createDtmStudio`／`mountEditor`／`playMML`／`playSingingMML`／`playChords`、`DawInstance` の `loadMML/getMML/play/stop/setBpm/setDrum/exportMIDI/exportMusicXML/exportUST`（`src/types.ts:772-`）、自動作曲 `composeSong`（`src/compose/compose.ts:7184`）、伴奏の同時再生 `createBackingAudio`（`src/audio/backing-audio.ts`。同じ AudioContext の時計で頭を揃える） |
| 外部歌声の仕組み | — | 手元のエンジン（VOICEVOX・NEUTRINO・OpenUtau・Sinsy）を「楽譜→WAV→AudioBuffer→休符で区切って予定どおり鳴らす」形で差し込む仕組みがある（`src/voice/neutrino-sing.ts:557 NeutrinoRenderer.render(model, score)`、`src/voice/lyrics.ts:4580-`）。ページを localhost で開いたときだけ選べる（`src/voice/local-engines.ts`） |
| LLM との前例 | — | `scripts/compose/strata-compose.ts`: OpenAI 互換 `${STRATA_URL}/chat/completions` に `tools` を渡すエージェントループ（read_bars／write_bar／set_drum／finish など）。手順は `docs/guide/strata-compose.md`。道具は事実だけを返し、点数は返さない方針 |

---

## (a) 歌トラックと楽器トラックのつなぎ方

| 案 | 中身 | 長所 | 短所 |
|---|---|---|---|
| A. dtm を fork し、VocaTab を「歌い手モデル」として足す | `vt_ritsu` などのモデル名を足し、`NeutrinoRenderer` と同じ形（score→AudioBuffer）で VocaTab の Worker を呼ぶ | dtm の UI・歌詞トラック・休符で区切る合成・同期をそのまま使える | dtm の巨大なファイル（`ui/daw.ts` 10k 行、`voice/lyrics.ts` 5k 行）に手を入れる。fork は AGPL |
| B. 別々にレンダリングして同じ時計で混ぜる | VocaTab のエンジンを画面なしで回して歌を AudioBuffer にし、dtm の `createBackingAudio`（buffer 方式。サンプル単位で正確で、書き出し・録音にも入る）か `#audio2=` で重ねる | dtm と VocaTab の改造がほぼ要らない。歌のピッチ・声の調整など VocaTab の良さを保てる | 歌を直すたびに歌トラック全体（または句）を作り直す。テンポは曲で1つに限る |
| C. 自前の薄いホストアプリ（推奨の器） | 曲データ（共通 JSON）を持つ小さなアプリを作り、楽器は dtm をライブラリとして、歌は VocaTab の engine-web を Worker として呼ぶ。中では B の混ぜ方を使う | LLM の API を自分の形で決められる。どちらの上流も改造せずに追従できる | 編集 UI は最初は dtm のエディタか、表示だけにする |

**推奨: C（中は B）。** 理由:
- dtm は npm ライブラリとして `playMML`・`createBackingAudio`・`loadMML` を出していて、楽器側は改造なしで使える。VocaTab の engine-web（`core.ts`・`worker.ts`）は DOM に依存せず、`composeF0`／`phraseParams`（`ui/src/engine.ts`）に既定の Track/Project を渡せば、画面なしで回せる見込み（[推測]: 実際に回してはいない）。
- dtm の外部エンジンの仕組み（A）は良い手本だが、fork すると AGPL の範囲が広がり、上流の速い更新（2.1.38 が 11/03、HEAD が 11/09）にも追従しにくい。A は「歌詞トラックで直接 VocaTab の声を選びたい」となったときの第2段にする。

**同期の方法:**
1. 曲は1テンポ（MVP）。VocaTab の刻み = dtm の step × 10（4/4 で 48 step/四分 ↔ TPQ 480）。ピッチは MIDI = units/31（12 平均律だけを渡す）。
2. 歌は曲の頭（0 秒）から始まる1本の AudioBuffer（または句ごとの AudioBuffer＋開始秒）にする。VocaTab の句は `start_sec`（曲頭からの絶対秒）を持つ（`protocol.ts AnalyzedPhrase`）。
3. dtm の再生開始時刻 `atTime`（`getAudioTime()` と同じ AudioContext の時計）に合わせて buffer を `start(atTime, offset)` する。`backing-audio.ts` がこの役をすでに持っているので、それを使う。
4. 書き出しは dtm の録音経路（実時間）か、自前で OfflineAudioContext を組む（[推測]: dtm の楽器を OfflineAudioContext で鳴らせるかは未確認）。

---

## (b) 曲データの形式

| | MML 中心 | 共通 JSON → 両方へ変換 |
|---|---|---|
| LLM の書きやすさ | 短く書ける（トークンが少ない）。ただし数え間違い（音長の合計・小節ずれ）が起きやすい | 冗長だが、音符・歌詞・小節がはっきりしていて検査しやすい |
| 歌詞 | dtm の `@@` は「1文字＝1音符」で、音符との対応が数え頼み。VocaTab の伸ばし・ブレス・音素指定・声の曲線を書く場所が無い | 音符ごとに `lyric` を持てる。VocaTab の `Note` へそのまま写せる |
| 楽器 | dtm がそのまま鳴らす（`#drum=`、`#t<n>font=`、和音 `'ceg'`） | MML へ書き出せば同じ |
| 差分の編集 | 文字列の置き換えになる | `set_track_notes` などで部分を差し替えやすい |

**推奨: 共通 JSON（SongDoc）を正本にし、楽器パートの中身は MML 断片でも書けるようにする。**
- 理由1: 歌は「音符⇔音節」の対応が要で、ここは JSON の方が壊れにくく、VocaTab の `model.ts` の形へ直接写せる。
- 理由2: 楽器パートは dtm の MML パーサがすでに強く（和音・ドラム・音源バンク）、LLM も MML を短く書けるので、楽器トラックは `mml` 文字列を持ってよい。dtm へは SongDoc → MML 全体を組み立てて `loadMML`。
- 歌詞の扱い: `set_lyrics` は「かな文字列」を受け、アプリが音節に割って音符へ配る（1モーラ＝1音符を既定にし、拗音は1、`ー` は伸ばし、`っ`・`ん` は1モーラ）。数が合わないときは割り当て結果と過不足を返し、LLM に直させる。VocaTab へは音符ごとの `lyric` として、伸ばしは `ー` で渡す。dtm の規則（`normalizeLyrics`）と VocaTab の規則（`score.ts`）は細部が違う（例: dtm の `っ` は音符を1つ使う。VocaTab で `っ` 単独の音符をどう扱うかは [推測]、要確認）ので、変換は自前の1か所にまとめてテストする。

SongDoc のスケッチ:
```json
{
  "version": 1,
  "title": "仮",
  "bpm": 120, "beatsPerBar": 4, "key": "C", "bars": 16,
  "chords": "| C | G | Am | F |",
  "tracks": [
    {"id": "vo", "kind": "vocal", "engine": "vocatab", "singer": "ritsu",
     "notes": [{"bar": 1, "beat": 1, "len": "8", "pitch": "G4", "lyric": "さ"}]},
    {"id": "pf", "kind": "inst", "program": "acoustic_grand_piano", "font": "FluidR3", "mml": "o4 l4 'ceg' 'ceg' ..."},
    {"id": "dr", "kind": "drums", "pattern": "8beat"}
  ]
}
```
（位置は「小節・拍・音価」で LLM に書かせ、内部は tick に直す。[推測]: この方が絶対 tick より間違いが少ない。）

---

## (c) LLM から操作する API

道具（関数）の案。どれも SongDoc に対する純粋な操作で、ブラウザでも Node でも同じコードで動かす。

| 道具 | 引数（要点） | 返すもの |
|---|---|---|
| `get_song` | `{part?: "summary"\|"full", bars?: [from,to]}` | 曲の要約か、指定小節の音符・歌詞・和音 |
| `new_song` | `{bpm, beatsPerBar, key, bars, title?}` | 空の SongDoc |
| `set_chords` | `{progression: "\| C \| G \| Am \| F \|", fromBar?}` | 小節ごとの和音の表 |
| `set_track_mml` | `{trackId, mml, program?, font?}` | パース結果（音符数、小節ごとの長さの過不足、エラー位置） |
| `set_track_notes` | `{trackId, fromBar, toBar, notes:[{bar,beat,len,pitch,lyric?}]}` | 置いた音符数、はみ出し |
| `set_lyrics` | `{trackId, text, fromBar?}` | 音符ごとの割り当て、余った／足りない音節 |
| `set_drums` | `{pattern, fromBar?, toBar?}` | 使ったパターン |
| `auto_accompany` | `{style?, parts?: ["bass","chord","arp"], seed?}` | dtm の `composeSong`／伴奏生成で作ったトラック（[推測]: 和音を指定して呼べる口があるかは要確認） |
| `set_mix` | `{trackId, volume?, pan?, reverb?}` | 現在の値 |
| `render` | `{what: "vocal"\|"all", bars?}` | 状態（合成した句の数、所要秒、失敗した句） |
| `play` / `stop` | `{fromBar?}` | 再生状態（ブラウザだけ） |
| `export` | `{format: "wav"\|"mml"\|"svsproj"\|"midi"}` | ファイル名 |
| `finish` | `{notes}` | 完了と自己評価の記録 |

JSON スキーマの例（OpenAI 互換の `tools` 形式）:
```json
{"type": "function", "function": {
  "name": "set_lyrics",
  "description": "歌トラックにかなの歌詞を流し込む。1モーラ=1音符。ーは伸ばし。",
  "parameters": {"type": "object", "required": ["trackId", "text"],
    "properties": {
      "trackId": {"type": "string"},
      "text": {"type": "string", "description": "ひらがな。句は空白か改行で区切る"},
      "fromBar": {"type": "integer", "minimum": 1}}}}}
```
道具は事実（過不足・こすれ・音域）だけを返し、点数は返さない（dtm の `docs/design/handover-compose.md` §2 の方針を踏襲）。

LLM 側との接続の選択肢:
1. **ブラウザから OpenAI 互換 API を直接呼ぶ**（llama.cpp server・Ollama・Strata はどれも `/v1/chat/completions`）。手軽だが、API キーがページに出る・CORS の設定が要る。
2. **手元の Node 中継（推奨）**: エージェントループ（呼ぶ→道具を実行→結果を返す）は Node で回し、キーは環境変数に置く（dtm の `strata-compose.ts` と同じ形）。ブラウザとは WebSocket でつなぎ、SongDoc の変更を流して画面で鳴らす。接続先は `LLM_BASE_URL`／`LLM_MODEL`／`LLM_API_KEY` だけで切り替える。
3. **MCP サーバー**: 同じ道具を MCP で出し、Claude／Codex（jev 経由）から曲を作らせる。2 の道具定義をそのまま包めるので、第2段で足す。

---

## (d) ライセンス上の注意

1. **dtm は 2.1.38 から AGPL-3.0-or-later**（`package.json`、README の「ライセンス」）。改変した dtm を Web で使わせるなら、改変後のソースを利用者に出す義務がある。dtm をライブラリとして結合したアプリを公開すると、アプリ全体を AGPL で出す前提になる（[推測]: 一般的な解釈。弁護士確認ではない）。手元だけで使うなら、実際上の義務は生じない。
   - **2.1.37 までは MIT**（README。npm でも `@onjmin/dtm@2.1.37` の license=MIT、公開は 2026-10-25 15:49 JST）。公開を考えるなら「2.1.37（MIT）に固定する」が選べる。ただし以後の機能（そのときの git のどのコミットが 2.1.37 かは shallow clone では未確認）は使えない。
2. **VocaTab のコードは MIT**（`LICENSE`）で、AGPL と組み合わせても問題ない。
3. **VocaTab の歌声モデル（`voicebanks/`）とボコーダ（`vocoders/`）は「個人・非商用、再配布禁止（単体でも、別の製品に入れても）」**（`README.md` ライセンス節、`THIRD_PARTY_NOTICES.md` §1・§2）。
   - 自分のリポジトリやサイトに**同梱・再ホストしない**。手元では VocaTab の clone から読む（Worker の `init(base)` で置き場所を指せる）。
   - VocaTab の GitHub Pages（`access-control-allow-origin: *` を確認）から実行時に読む形は技術的にはできるが、規約上の「再配布」に当たるかは不明。公開するなら作者への確認が必要（issue は承認後）。
   - 出力の音を公開するときは歌い手のクレジットが必須。夏目悠李は「歌声DB制作: アマノケイ／音声提供者: 霧野蒼太」と `夏目悠李_利用規約.txt` に従う（商用・法人での発表は別契約）。波音リツは「波音リツ」と「カノン」の両方を表示する（`voicebanks/leapsinger_ja_3singer/README.md`）。
   - NHVSing の重みは非商用（PrettyPitch の README でも「商用利用できません」）。**商用には使えない**前提で考える。
4. **SoundFont**: dtm は同梱せず、実行時に `surikov.github.io/webaudiofontdata` から読む。そのリポジトリは MIT 表示で、FluidR3 と GeneralUser GS はそれぞれのライセンスへリンクしている。Aspirin・SoundBlaster・JCLive・Chaos・SBLive の出どころと条件は未確認なので、最初は **FluidR3（既定）と GeneralUser GS だけ**を使う。`Inc`・`Niji`・`Otenkiame`（onjmin/inc-sf2、AGPL。音MADの声素材由来）は使わない。
5. **dtm 内蔵の UTAU 音源（koe）** は R2 から読む（`src/voice/lyrics.ts:1495`）。歌い手ごとに規約がある（`lyrics.ts:1670-` の規約 URL 表）。今回は歌を VocaTab に任せるので、使わない前提にする。koe 本体（`@onjmin/koe`）は MIT。
6. onnxruntime-web（MIT）は jsDelivr から実行時に読む。同梱するなら MIT の表示を付ける。

---

## (e) 最小版までの作業ステップ（目標: 歌詞とイメージを渡すと、歌＋数パートの伴奏がブラウザで鳴る）

1. **手元で両方を動かす**: VocaTab を `tools/build.py` で作って静的配信して鳴らす。dtm を `pnpm dev` で動かす。（受け入れ: 両方のデモで音が出る）
2. **VocaTab を画面なしで歌わせる**: engine-web の Worker に、手書きの音符＋歌詞（8小節）を `analyze` → `composeF0`（既定の Track）→ `synthesize` で渡し、句を曲の時間軸に並べて WAV にする。（受け入れ: VocaTab の画面で同じ楽譜を鳴らした音と聞き比べて同じ）
3. **SongDoc と変換**: SongDoc の型と検査。SongDoc→VocaTab の音符、SongDoc→dtm の MML、歌詞の割り当て（`set_lyrics`）。単体テストを付ける。
4. **同時に鳴らす**: dtm の `playMML` で楽器（ピアノ・ベース・ドラム）、2 の歌を `createBackingAudio` で同じ時計に乗せる。（受け入れ: 8小節で歌と伴奏のずれが耳で分からない。開始時刻の差を数値でも記録する）
5. **道具とループ**: (c) の道具を実装し、Node 中継で OpenAI 互換の LLM につなぐ。依頼文「歌詞＋イメージ（テンポ・雰囲気）」→ LLM が `new_song`→`set_chords`→歌メロ（`set_track_notes`）→`set_lyrics`→伴奏（`set_track_mml` か `auto_accompany`）→`render`。
6. **書き出し**: ミックスの WAV とプロジェクト（SongDoc JSON）を保存。
7. **1曲作って聴く**: Kiyoshiさんのイメージで1曲作り、聴いてもらって直す点を集める。

---

## (f) Kiyoshiさんに確認したいこと

1. **LLM の呼び方**: llama.cpp server／Ollama／Strata（OpenAI 互換 `/v1`）／商用 API（どれ）／jev 経由（jev-route にこの用途の口を作るか）のどれを使うか。エンドポイントの形（URL、キーの有無、ツール呼び出しに対応したモデルか）。dtm の Strata の手順書では「日本語の細かい処理が弱い」と書かれているので、作詞・歌メロは強いモデルにする方がよいかも。
2. **公開するか**: 手元だけで使うか、Web に出すか。出すなら、dtm を 2.1.37（MIT）に固定するか、AGPL で全体を出すか。VocaTab のモデルは公開サイトに置けない（読み込み方は作者への確認が要る）。
3. **用途は個人・非商用か**: VocaTab の声とボコーダは非商用だけ。法人（お仕事のサイトなど）で発表する可能性があるなら、夏目悠李は別の契約が要る。
4. **最初の曲のイメージ**: 歌詞（またはテーマ）、テンポ・雰囲気・長さ（8〜16小節で始める案）、伴奏の楽器、歌い手（くるみ／悠李／リツ）。
5. **動かす場所**: box の Chrome、desktop の Chrome のどちらで聴くか（VocaTab は CPU 1スレッドで 1句 7.8 秒に約 3.3 秒。WebGPU は Chrome だけの試験的な機能）。
6. **既存プロジェクトとの関係**: 「曲作成」（夜凪シオ、Suno）、MV-Studio、music-charm（採点）とつなぐ予定があるか。

---

## 補足: 確かめていないこと
- VocaTab の engine-web を画面なしで回せるか（コード上はできそう。実際には回していない）。
- dtm の `composeSong`／伴奏生成に、外から和音進行を渡して伴奏だけ作らせる口があるか（`ComposeResult.chordProgression` は出力として存在）。
- dtm の楽器音を OfflineAudioContext で書き出せるか（今の書き出しは実時間の録音）。
- 単独の `っ` の音符など、歌詞の細かい規則の VocaTab 側の扱い。
- SoundFont の Aspirin・SoundBlaster・JCLive・Chaos・SBLive のライセンス。
