# browser-dtm（非公開）

ブラウザで「歌＋楽器」の曲を作る DTM アプリの最小版。歌は VocaTab の歌声合成エンジン、楽器は onjmin/dtm を使い、曲や歌詞は LLM から操作できるようにする。

- 指示書: [SPEC.md](SPEC.md) / 設計メモ: [docs/design-memo.md](docs/design-memo.md)
- ライセンス方針: [LICENSE-POLICY.md](LICENSE-POLICY.md) / 著作権表示: [NOTICE.md](NOTICE.md)
- 手法ブランチ: `impl/cursor`（本実装）
- 使用量ログ: `logs/usage-cursor.md`

**このリポジトリは公開しない。** 歌声モデル・ボコーダ・SoundFont・生成音声は commit しない（SPEC §4）。

## 音価 `len` の表記

| 表記 | 意味 |
|------|------|
| `1` `2` `4` `8` `16` `32` | 分音符 |
| 末尾 `.` | 付点（×1.5）例 `8.` |
| 末尾 `t` | 三連（×2/3）例 `4t` |

位置は `bar`（小節・1始まり）と `beat`（拍・1始まり・小数可）。内部は TPQ=480。

## セットアップ

```bash
# 1) 依存
npm ci

# 2) VocaTab（gitignore の vendor/。モデル含む upstream を clone）
git clone --depth 1 https://github.com/wavtechyukky/vocatab vendor/vocatab
# または既存 clone を指す
# export VOCATAB_DIR=/path/to/vocatab

# 3) VocaTab engine-worker をビルド
npm run build:vocatab

# 4) 単体テスト（SongDoc 変換・歌詞割り当て）
npm test

# 5) 開発サーバー（cursor ポート 5300）
npm run dev
# → http://127.0.0.1:5300/
```

SoundFont は実行時に dtm 既定 CDN（FluidR3 / GeneralUser GS）から取得。onnxruntime-web も CDN。

## 使い方（プロンプトコピペ）

1. 歌詞とイメージを入れ「プロンプト生成＆コピー」→ LLM に貼る
2. LLM の返答（SongDoc JSON）を貼り戻し欄へ →「検査して読込」
3. 実装確認は「見本を読込」（`fixtures/llm-response-sample.txt`）で可
4. Play で歌＋伴奏、Export MP3 で書き出し（既定 MP3）
5. エフェクト4種（ケロケロ / ボコーダー / ビットクラッシュ / ダブリング）は強度 0〜1

## MCP

```bash
npm run mcp
# stdio。tools/list と new_song→set_track_notes→set_lyrics→set_track_mml→export
npm run accept:mcp
```

音声ファイルの実体はブラウザ経路（`npm run accept:render`）。MCP の export は SongDoc/MML を `out/` に書く。

## 受入テスト

```bash
npm run accept:a1       # 見本貼り戻し＋再生＋スクショ
npm run accept:render   # MP3 書き出し＋ RMS/ピーク/onset
npm run accept:fx       # エフェクト 0/1 差分
npm run accept:mcp      # MCP 道具列
npm run accept:all
```

成果物（commit しない）: `out/mix.mp3`, `out/metrics.json`, `docs/evidence/*.png`

## 構成

- `src/songdoc/` … SongDoc・変換・歌詞割り当て
- `src/vocal/` … VocaTab Worker ラッパ（上流非改造）
- `src/audio/` … dtm と時計合わせ再生・MP3 書き出し
- `src/fx/` … 歌エフェクト4種
- `src/tools/` … LLM 道具（MCP と共有）
- `src/mcp/` … MCP stdio サーバー
- `fixtures/` … 見本 SongDoc / LLM 返答
