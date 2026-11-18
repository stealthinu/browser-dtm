# SPEC: ブラウザDTM 最小版（3手法共通の指示書）

最終更新: 2026-11-13 JST（Kiyoshiさんの音声での決定を反映）
この文書は Claude Code（`impl/claude-code`）、Codex（`impl/codex`）、Cursor（`impl/cursor`）の3手法に**同じ内容**で渡す指示書です。
設計の詳細と根拠は `docs/design-memo.md`（v0, 2026-11-12）。**この SPEC の決定がメモより優先**します。

## 1. 作るもの
LLM に「この歌詞で、こんな曲」と頼むと、**歌＋数パートの伴奏がブラウザで鳴る**最小版の Web アプリ。

- 歌: VocaTab（https://github.com/wavtechyukky/vocatab、コードは MIT）の歌声合成エンジン（`ui/src/engine-web`、onnxruntime-web）を**画面なし**で呼び、歌を AudioBuffer にする。
- 楽器: onjmin/dtm（`@onjmin/dtm`、2.1.38〜 AGPL-3.0-or-later）をライブラリとして使い、MML から伴奏を鳴らす。
- つなぎ方: メモ (a) の推奨「C（自前の薄いホストアプリ）、中は B（別々に描画して同じ時計で混ぜる）」。**上流は改造しない**（fork・パッチをしない。必要な部分は import かラッパーで）。

## 2. 決定事項（メモより優先）
1. **曲データ**: 正本は共通 JSON（SongDoc）。
   - 歌トラック: 音符ごとに `小節(bar, 1始まり)・拍(beat, 1始まり、小数可)・音価(len, 例 "4"=4分, "8."=付点8分 など。表記は SPEC 実装側で定義し README に書く)・音名(pitch, 例 "G4")・かな(lyric)` を持つ JSON。
   - 伴奏トラック: dtm の **MML 文字列**（パートごと）。
   - アプリが SongDoc → VocaTab の Note（TPQ=480、MIDI ノート、lyric）と dtm の MML 全体へ変換する。変換と歌詞割り当ては1か所にまとめ、単体テストを付ける。
2. **LLM 向け API**: メモ (c) の道具群（`get_song`, `new_song`, `set_chords`, `set_track_mml`, `set_track_notes`, `set_lyrics`, `set_drums`, `set_mix`, `render`, `export`, `finish` など。最小版で必要なものから）。道具は事実（過不足・音域外・エラー位置）だけを返し、点数は返さない。
3. **LLM 接続は2通り**（同じ API 定義を共有する）:
   - **プロンプトコピペ方式（最小版の必須）**: アプリが「LLM に貼るプロンプト」（歌詞・イメージ・SongDoc の書式説明・例）を表示/コピーでき、LLM の返答（SongDoc JSON と伴奏 MML、またはそれを含むテキスト）を貼り戻すと、検査して読み込み、エラーがあれば LLM に返す修正依頼文を出す。
   - **MCP プラグイン配布**: 同じ道具を MCP サーバー（stdio、Node）として出す。最小版では「起動して tools/list が返り、new_song→set_track_notes→set_lyrics→set_track_mml→export が通る」まででよい。
   - （任意）OpenAI 互換 `/v1/chat/completions` を呼ぶ Node 中継。`LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` の環境変数だけで切り替え。キーはコードにもリポジトリにも書かない。
4. **エフェクト**（歌トラック）: `ケロケロボイス（ピッチを平らにする）`・`ボコーダー`・`ビットクラッシャー`・`ダブリング` から選択（複数可）＋各 0〜1 の強度パラメータ。SongDoc に保存し、書き出しにも反映する。
5. **出力**: **既定は MP3**（ブラウザ内エンコードでも、Node 側 ffmpeg でもよい）。WAV と SongDoc JSON の保存もできるとよい。
6. **画面**: ピアノロール（少なくとも歌と伴奏の音符を表示。編集は任意）、再生/停止、プロンプトコピー欄、貼り戻し欄、エフェクト選択、書き出しボタン。

## 3. 合格基準（最小版）
- **A1**: プロンプトコピペ方式で、歌詞（例: 「ゆうやけ そらに とけていく」程度、4〜8小節）とイメージ（例: BPM 120、明るいポップ）から LLM が作った SongDoc＋MML を貼り戻すと、**歌＋2パート以上の伴奏（例: ピアノ/ベース/ドラム）がブラウザで鳴る**。LLM の返答は、実装中は自分で書いた「LLM が返しそうな見本返答」でよい（フィクスチャとしてリポジトリに置く）。
- **A2**: 「動いた」の判定は、**実際にブラウザ（headless Chrome 等）で鳴らし**、その音を **MP3 に書き出して**（または同じ処理の音声ファイルを）確認できた時点。無音・クリップだけでないことを数値（RMS/ピーク、歌と伴奏それぞれの区間）で確認し、REPORT.md に書く。可能ならスクリーンショット（ピアノロール表示）も `docs/evidence/` に置く。
- **A3**: 歌と伴奏の頭のずれを数値で記録する（目標: 耳で分からない程度、例 < 30ms）。
- **A4**: 4種のエフェクトそれぞれを強度 0 と 1 で書き出し、音が変わることを数値で確認。
- **A5**: SongDoc 変換・歌詞割り当て（1モーラ=1音符、拗音は1、`ー` 伸ばし、`っ`・`ん` は1モーラ、過不足を返す）の単体テストが通る。
- **A6**: MCP サーバーが起動し、上の道具列で MP3（または WAV）を書き出せる（ヘッドレスの描画経路が無理なら、そこまでの到達点と理由を REPORT に）。
- **A7**: `README.md` に起動方法（依存の取得、上流ソース・モデルの取得手順、テスト、書き出しの手順）が書かれていて、そのとおりに再現できる。

## 4. 制約（必ず守る）
- 正本は GitHub リポジトリ `stealthinu/browser-dtm`（AGPL-3.0-or-later）。デモは GitHub Pages（https://stealthinu.github.io/browser-dtm/）。歌声モデルは同梱せず VocaTab 公式配布から読む。
- **上流（VocaTab・dtm）に issue/PR/コメントをしない**。作った曲を SNS 等に**投稿しない**。歌声モデル・ボコーダは再ホストしない。
- **著作権表示を残す**: VocaTab（MIT, Copyright (c) 2026 wavtechyukky、THIRD_PARTY_NOTICES）と dtm（AGPL-3.0-or-later, onjmin）の表示を `NOTICE.md`／README に残し、取り込んだコードのヘッダも消さない。本リポジトリは dtm の AGPL を継承する前提（`LICENSE-POLICY.md`）。
- **歌声モデル・ボコーダ・SoundFont をリポジトリに commit しない**。VocaTab の `voicebanks/`・`vocoders/` は「個人・非商用・再配布禁止」。実行時は VocaTab 公式配布（GitHub Pages）から読むか、開発時は上流の clone（`.gitignore` した `vendor/` 等、環境変数 `VOCATAB_DIR`）を指す。SoundFont は実行時に CDN（dtm 既定、FluidR3 / GeneralUser GS のみ）から読む。`.gitignore` に `vendor/`, `*.onnx`, `*.sf2`, `node_modules/`, 生成した音声（`out/`）を入れる。
- 生成したサンプルの音声（MP3/WAV）は commit しない（`out/` に置く）。確認用の数値・スクリーンショット（小さな PNG）は可。
- **秘密の値（トークン・APIキー・パスワード）をどこにも書かない**（コード、コミット、ログ、REPORT）。
- GPU は使わない（必要なら止めて REPORT に書く。GPU 処理は gpuq 経由の別作業）。MogulSim のジョブ・プロセスに触らない。他のジョブのプロセスを kill しない（kill は自分が起こした PID 指定だけ）。
- ssh・tailscale・ネットワークの不調は**自分で直さない**。症状・コマンド・エラー文を `JEV_NEEDS_MUGI: ...` の1行で出し、REPORT に書いて、ネットワーク不要の作業だけ続けるか終了する。
- 有料 API・従量課金・購入・外部への送信はしない（必要なら BLOCKED APPROVALS に書く）。
- 開発サーバーのポートは手法ごとに分ける（同じマシンで並行するため）: claude-code = 5100〜5199、codex = 5200〜5299、cursor = 5300〜5399。終わったら自分が起こしたサーバーを止める。
- 依存は pnpm か npm（どちらでもよい、lockfile を commit）。dtm は npm の `@onjmin/dtm`（2.1.38 以上、AGPL）か、上流 clone からのビルドのどちらでもよい。

## 5. 進め方（上限付き1ループ）
1. 最初に `REPORT.md` に GOAL と ACCEPTANCE TESTS（A1〜A7 を確かめるコマンド）を書いて commit。
2. 実装 → テスト → 修正。受入テストが落ちたら**自動修正は最大2回**。それでも駄目なら到達点で止める。
3. 節目ごとに commit/push（自分のブランチだけ）。
4. 時間上限（全体で4時間）が来たら、その時点の到達点で REPORT を書いて終える。
5. 最後に `REPORT.md`: やったこと、受入テストの結果（pass/fail と数値）、再現コマンド、commit 一覧、未解決、NEXT STEPS、BLOCKED APPROVALS。さらに `logs/usage-<手法>.md` に、自分で分かる範囲の所要時間・修復回数・CLI 切替回数を書く（トークン数は外部の集計スクリプトが追記する。自分で推測値を書かない）。

## 6. 参考（上流の場所、メモより）
- VocaTab: `ui/src/model.ts`（Project/Note, TPQ=480）、`ui/src/engine-web/{worker,core,client,protocol}.ts`、`ui/src/engine.ts`（composeF0, phraseParams）、`ui/src/export.ts`（OfflineAudioContext）、ビルド `python tools/build.py`（esbuild）。
- dtm: `src/types.ts`（DawInstance: loadMML/getMML/play/stop/exportMIDI…）、`playMML`、`createBackingAudio`（`src/audio/backing-audio.ts`、同じ AudioContext の時計で頭を揃える）、`scripts/compose/strata-compose.ts`（OpenAI 互換の道具ループの前例）、README の MML 記法。

## 7. プロンプト往復の流れ（main-v1）

1. 歌詞（かな）と曲のイメージを入力し、プロンプトをコピーする。既存の曲を変える場合は「今の曲を土台にする」を選ぶ。
2. 契約しているLLMへ貼る。プロンプトにはSongDoc仕様、音価・音名・MML、GM楽器指定、vocaloidを含むエフェクト、完全な例と任意の現在曲が含まれる。従量APIやキーは不要。
3. LLMの返答全文を貼り、「読み込んで鳴らす」。正規出力は `json` フェンス1つのSongDoc全体で、伴奏MMLもJSON内に含む。歌をVocaTabで合成し、FluidR3 GM伴奏と同じ時計で実再生する。
4. 説明文・裸JSON・複数フェンス・末尾カンマ・コメント・全角・表記ゆれなどの軽微な崩れを共通パーサで直し、「自動修正した点」に表示する。曲の構造・単音の重なり・音域・小節範囲・歌詞の一致は検査する。
5. 修復できない場合は場所つきの問題を出し、「修正依頼文をコピー」でLLMへ戻す。返答を手編集せず、直された返答全文を貼り直す。
6. ピアノロールで歌の音符とかなを編集できる。再生とMP3/WAV書き出しは同じオフラインPCMを使い、書き出し前にもブラウザで実再生する。

MCPも同じSongDocを正本にする。`get_song` の既定/fullとJSON書き出しは貼付JSONと同形。`load_song_json` は同じパーサを通し、失敗時は元の曲を保つ。`get_prompt` は現在曲と仕様を含む。`set_track_mml.instrument` はGM名/0始まり番号、旧programは互換用に維持する。

## 8. サンプル集ページ（main-v1）

`/gallery.html` を作曲画面から開く。カードは曲3枚以上（ジャンルとテンポを変える）、伴奏2枚以上、歌の効果プリセット2枚以上（ボカロ風0.8・ケロケロ）とし、種類で絞り込める。

各カードは「▶ 試聴」「アプリで開く」「Claude 用にコピー」「ChatGPT 用にコピー」を持つ。試聴はページ内で歌を合成し、伴奏をSoundFontで鳴らす。作曲画面を同一オリジンの再生ホストとして共用する。停止でき、複数カードを同時に鳴らさない。楽器取得失敗時の警告も表示する。

コピー文はサンプルSongDoc全体、共通の書式仕様、「これを土台にどう変えるか」の指示を含む自己完結の文章。M1プロンプト生成器を共有し、ClaudeにはArtifact不要、ChatGPTにはファイルリンク/実行コード不要を添える。成功時は「コピーしました」と表示する。「アプリで開く」は曲・歌詞を読み込み、後から再生・編集・書き出しできる。

データは `fixtures/gallery/*.json`。全件を共通パーサと検査へ通す。headless Chromeのe2eで両コピー内容・実再生録音の非無音・SoundFont利用・画面を確認する。実LLM返答は未編集のテキストとハッシュだけを保存し、MP3・モデル・音源データはcommitしない。
