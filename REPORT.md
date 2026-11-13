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

## 状況
SPEC.md 全文、設計メモ、ライセンス方針を読了。実装前。上流は既存の読み取り専用 clone を調査する。

## テスト結果
未実行。

## Commits
最終更新時に記録する。

## NEXT STEPS
上流 API の実態を確認し、ホストと共通 API を実装する。

## BLOCKED APPROVALS
なし。公開・投稿・有料API・上流への連絡は行わない。
