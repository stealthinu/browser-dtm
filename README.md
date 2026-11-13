# browser-dtm（非公開）

ブラウザで「歌＋楽器」の曲を作る DTM アプリの最小版。歌は VocaTab の歌声合成エンジン、楽器は onjmin/dtm を使い、曲や歌詞は LLM から操作できるようにする。

- 指示書: [SPEC.md](SPEC.md)（3手法共通） / 設計メモ: [docs/design-memo.md](docs/design-memo.md)
- ライセンス方針: [LICENSE-POLICY.md](LICENSE-POLICY.md) / 著作権表示: [NOTICE.md](NOTICE.md)
- 3手法の比較: ブランチ `impl/claude-code`（Claude Code, jev）、`impl/codex`（Codex, jev）、`impl/cursor`（Cursor クラウドエージェント）。品質は Kiyoshiさんが評価する。
- 使用量ログ: `logs/usage-<手法>.md`（集計は `tools/collect-usage.py`）
- このブランチ（`impl/claude-code`）の結果: [REPORT.md](REPORT.md)

**このリポジトリは公開しない。** 歌声モデル・ボコーダ・SoundFont は commit しない（SPEC §4）。

---

## 仕組み（impl/claude-code）

SPEC の推奨どおり「C（自前の薄いホストアプリ）、中は B（別々に描画して同じ時計で混ぜる）」。上流は改造しない。

```
LLM の返答（SongDoc JSON）──貼り戻し──▶ src/core/prompt.ts（取り出し・検査・修正依頼文）
                                         │
                       src/core/songdoc.ts（SongDoc → VocaTab Note / dtm MML、歌詞の割り当て）
                ┌────────────────────────┴──────────────────────────┐
  src/web/vocal.ts: VocaTab の engine-web Worker を画面なしで       src/web/player.ts: dtm の playMML（伴奏）
  analyze → composeF0（上流を import）→ synthesize → 句を並べる      同じ AudioContext。曲の頭の時刻を固定して
  ＋ src/core/fx.ts（エフェクト）→ AudioBuffer                      歌の AudioBuffer を同じ時刻に start
                └────────────────────────┬──────────────────────────┘
                     AudioWorklet で実際に鳴った音を録る → MP3（lamejs、既定）/ WAV
```

- 歌: `$VOCATAB_DIR/ui/src/engine-web/worker.ts` を esbuild で `dist/engine-worker.js` に包む（上流のファイルは読むだけ）。モデルは開発サーバーが `$VOCATAB_DIR` の `web_index.json`・`voicebanks/`・`vocoders/` をそのまま配る（コピー・同梱しない）。onnxruntime-web は上流どおり jsDelivr から読む。GPU は使わない（WASM、CPU）。
- 伴奏: npm の `@onjmin/dtm`（2.1.38、AGPL）の `playMML` に AudioContext と出力先を渡して鳴らす。音色は dtm の内蔵シンセ（`#t<n>inst=` の GM 楽器名で音色が変わる）。ドラムは `#drum=`。
- 頭あわせ: dtm のシーケンサは「`playMML` を呼んだ時の `ctx.currentTime` + `SEQUENCER_START_DELAY`」を曲の頭にする。その `currentTime` を Proxy で決めた値に固定して呼び、同じ値（サンプルの境目に丸めた時刻）から歌のバッファの開始時刻を決める。

## SongDoc（曲データの正本）

```json
{
  "version": 1, "title": "ゆうやけ", "bpm": 120, "beatsPerBar": 4, "key": "C", "bars": 4,
  "chords": "| C | F | Am G | C |",
  "tracks": [
    { "id": "vo", "kind": "vocal", "singer": "ritsu",
      "effects": [ { "type": "kero", "amount": 0.8 } ],
      "notes": [ { "bar": 1, "beat": 1, "len": "4", "pitch": "E4", "lyric": "ゆ" } ] },
    { "id": "pf", "kind": "inst", "program": "acoustic_grand_piano", "mml": "o4 l4 'ceg' 'ceg' 'ceg' 'ceg'" },
    { "id": "ba", "kind": "inst", "program": "electric_bass_finger", "mml": "o2 l8 c c c c c c c c" },
    { "id": "dr", "kind": "drums", "pattern": "8beat" }
  ]
}
```

- 歌の音符: `bar`（1始まり）・`beat`（1始まり、小数可。`1.5` は1拍目の裏）・`len`・`pitch`・`lyric`（かな1モーラ）。音符は重ねない（単音）。音域 C3〜C6。
- **音価 `len` の表記**: `"1"` 全、`"2"` 2分、`"4"` 4分、`"8"` 8分、`"16"` 16分、`"32"`、`"64"`。付点は後ろに `.`（`"4."`、`"4.."` 複付点）、3連は `t`（`"8t"` = 3連8分）、タイは `+`（`"2+8"`）。4分 = 480 刻み（VocaTab の TPQ）。
- **音名 `pitch`**: `C4` = 中央のド = MIDI 60。`#`（`♯`）・`b`（`♭`）。
- **歌詞**: 1モーラ = 1音符。拗音（`きゃ`）は1、`ー`（`〜`）は伸ばし（前の母音を続ける）、`っ`・`ん` も1モーラ。カタカナはひらがなに揃える（VocaTab ではカタカナの母音は無声化を表すため）。`set_lyrics` は時刻順に配り、余ったモーラ（`surplus`）と歌詞の無い音符の数（`missing`）を返す。
- **伴奏 `mml`**: dtm の MML 記法（パートの中身だけ。`;` `@` `#` は書かない。アプリが `#t<n>inst=`・`#drum=`・`@<n>`・`t<bpm>` を付けて1本の MML に組み立てる）。
- **エフェクト `effects`**（歌トラック、複数可、`amount` 0〜1）: `kero`（ケロケロボイス: 最後の F0 を音符の音高の階段へ寄せて合成し直す）、`vocoder`（20 帯域のチャンネルボコーダー。キャリアは音符の音高のノコギリ波）、`bitcrusher`（16→3 bit、間引き 1→10）、`doubling`（揺らした遅延の写し2本を左右へ、ステレオになる）。再生と書き出しの両方に掛かる。

## 準備

```bash
# 1) 依存（lockfile あり）
npm ci

# 2) 上流 VocaTab（コードは MIT。歌声モデル・ボコーダは個人・非商用・再配布禁止 → commit しない）
#    a) 既にある clone を指す（box では /workspace/dtm-research/vocatab。読み取りだけで使う）
export VOCATAB_DIR=/workspace/dtm-research/vocatab
#    b) または .gitignore 済みの vendor/ へ clone（モデルは Git LFS ではなく通常のファイル）
#    git clone https://github.com/wavtechyukky/vocatab vendor/vocatab
#    （VOCATAB_DIR 未設定なら vendor/vocatab、次に /workspace/dtm-research/vocatab を探す）

# 3) dtm は npm の @onjmin/dtm（2.1.38, AGPL-3.0-or-later）を使う（手順 1 で入る）

# 4) ビルド（dist/ は .gitignore）
npm run build
```

確認した版: VocaTab `2d2a48b`（2026-11-08）、`@onjmin/dtm@2.1.38`、Node 24、Chrome（`/usr/bin/google-chrome`）。
ネットワーク: onnxruntime-web 1.20.1 を jsDelivr から読む（初回のみ）。

## 使う

```bash
npm run serve            # http://127.0.0.1:5100/ （PORT=5100〜5199）
```

1. 「プロンプトを作る」→「コピー」で LLM に貼る（歌詞・イメージ・SongDoc の書式・例が入る）。
2. LLM の返答をそのまま「貼り戻す」欄に貼って「読み込む」（説明文つきでよい。```json の中を取り出す）。問題があれば一覧と「修正依頼文」（LLM に返す文）が出る。見本は「見本返答を入れる」（`fixtures/sample-response.txt`）。
3. エフェクトを選んで強度を決め、「▶ 再生」。ピアノロールに歌（歌詞つき）と伴奏の音符、再生位置が出る。
4. 「MP3 書き出し」（既定）/「WAV」/「SongDoc JSON」。MP3・WAV は実際に鳴らしながら録る（曲の長さ＋1.5 秒かかる）。

## テスト

```bash
npm test             # A5: SongDoc 変換・歌詞割り当て・検査・道具の単体テスト（node:test + tsx）
npm run e2e          # A1〜A3: headless Chrome で見本返答を貼り戻し→鳴らし→MP3 を out/song.mp3 に。数値は out/e2e.json
npm run e2e:fx       # A4: 4種のエフェクト × 強度 0/1 を書き出して比べる。数値は out/e2e-fx.json
npm run mcp:smoke    # A6: MCP サーバーを起動し tools/list → new_song → … → export(mp3)
```

e2e はポート 5100、MCP の書き出しは 5101 を使い、終わったらサーバーと Chrome を閉じる。音声ファイルは `out/`（commit しない）。

## MCP サーバー

```bash
npx tsx mcp/server.ts    # stdio
```

Claude Code / Claude Desktop などの設定例（パスは手元に合わせる）:

```json
{ "mcpServers": { "browser-dtm": { "command": "npx", "args": ["tsx", "mcp/server.ts"],
  "cwd": "/path/to/browser-dtm", "env": { "VOCATAB_DIR": "/workspace/dtm-research/vocatab" } } } }
```

道具: `get_song` `new_song` `set_chords` `set_track_notes` `set_lyrics` `set_track_mml` `set_drums` `set_effects` `set_mix` `check` `export`（mp3 既定 / wav / json / mml）`finish`。道具は事実（過不足・音域・はみ出し・エラーの場所）だけを返し、点数は返さない。`export` の mp3/wav は headless Chrome でアプリを開いて鳴らし、`out/<name>.mp3` に書き出す。定義はブラウザと共有（`src/core/tools.ts`）。

## ファイル

| 場所 | 中身 |
|---|---|
| `src/core/songdoc.ts` | SongDoc の型・検査・変換（VocaTab Note / dtm MML）・歌詞の割り当て |
| `src/core/tools.ts` | LLM 向けの道具（ブラウザ・MCP 共通） |
| `src/core/prompt.ts` | プロンプト・返答の取り出し・修正依頼文 |
| `src/core/fx.ts` / `encode.ts` | エフェクト（ボコーダー・ビットクラッシャー・ダブリング）/ MP3・WAV・数値 |
| `src/web/vocal.ts` | VocaTab engine-web を画面なしで呼ぶ（＋ケロケロの F0） |
| `src/web/player.ts` | dtm と歌を同じ時計で鳴らし、録る |
| `src/web/main.ts`, `web/index.html` | 画面 |
| `mcp/server.ts` | MCP サーバー |
| `scripts/` | ビルド・e2e・数値・MCP のスモーク |
| `fixtures/` | 依頼と「LLM が返しそうな見本返答」 |

## 著作権表示

- VocaTab — MIT License, Copyright (c) 2026 wavtechyukky（https://github.com/wavtechyukky/vocatab）。歌声モデル・ボコーダは個人・非商用・再配布禁止。歌い手のクレジット: 波音リツ（「波音リツ」「カノン」）、夏目悠李（歌声DB制作: アマノケイ／音声提供者: 霧野蒼太）、御丹宮くるみ。
- dtm — AGPL-3.0-or-later, (c) onjmin（https://github.com/onjmin/dtm）。本アプリは AGPL を継承する前提（LICENSE-POLICY.md）。
- 詳細は [NOTICE.md](NOTICE.md)。
