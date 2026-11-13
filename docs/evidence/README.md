# 検証証拠の範囲

- `audio-metrics.json`: 2026-11-13 20:45 JST、初回実装（checkpoint `6eec0c9`）のブラウザ実再生・MP3/WAVデコード結果。補正前ボコーダー単独ステムにクリップが残ることも記録している。
- `piano-roll.png`: 修復後の画面（プロンプト、貼り戻し、歌/Piano/Bass、4種の強度、書き出し）。音声の成功を示す画像ではない。

修復後の最終ブラウザ検証は Runtime timeout により FAIL。最新コードの成功の証拠として初回の音声数値を流用しない。経緯と再現コマンドは [REPORT.md](../../REPORT.md)。音声は gitignore 対象の `out/` にだけ保存している。
