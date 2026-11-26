# 使用量ログ: fullchorus（ギャラリー全面差し替え）

時刻はすべて Asia/Tokyo（JST）。Claude Opus 5.5 の曲データ作成は購読枠。従量APIは使っていない。

## 作業メモ

- 開始: 2026-11-18 16:18 JST 頃（t37u: サンプルを Opus のフルコーラス曲に作り直す）
- 歌詞・構成（stage 1）: 成功
- 作曲（stage 2）: 2026-11-18 16:25 JST に 4 ジョブを投入したところ、Claude 購読の 5 時間枠に当たって即失敗。リセットは **2026-11-18 20:20 JST（Asia/Tokyo）**。jev はこの文言を `other` と分類したため API 従量への自動切替は走っていない。従量課金は使わず、枠の回復を待つ。
- 誤投入: `jev-route run creative --help` がジョブとして走り、短い Opus 呼び出しになった（20261118-162117-creative-9bbc）

## jev ジョブ

| jev job | role | model | 状態 | exit | 開始 (JST) | 終了 (JST) | 所要 | 内容 |
|---|---|---|---|---|---|---|---|---|
| 20261118-162117-creative-9bbc | creative | claude-opus-5-5 | done | 0 | 16:21:17 | 16:21:29 | 12.1s | 誤って `--help` を creative に渡した。caller=unknown |
| 20261118-162157-creative-6d3f | creative | claude-opus-5-5 | done | 0 | 16:21:57 | 16:24:14 | 136.9s | 4曲の歌詞と構成。caller=ブラウザDTM |
| 20261118-162516-creative-7dc3 | creative | claude-opus-5-5 | failed | 1 | 16:25:16 | 16:25:19 | 2.8s | compose hidamari-skip。5h limit |
| 20261118-162517-creative-6fe2 | creative | claude-opus-5-5 | failed | 1 | 16:25:17 | 16:25:20 | 2.9s | compose yukidoke-no-tegami。5h limit |
| 20261118-162517-creative-5105 | creative | claude-opus-5-5 | failed | 1 | 16:25:17 | 16:25:20 | 3.0s | compose kaze-wo-kire。5h limit |
| 20261118-162518-creative-4845 | creative | claude-opus-5-5 | failed | 1 | 16:25:18 | 16:25:20 | 2.8s | compose mayonaka-loop-line。5h limit |

## トークン（Claude セッション、cwd ごとの jsonl）

Claude Code と同じ集計（message.usage、メッセージIDで最大値）。input はキャッシュ別。

| ジョブ | セッション | 入力 | キャッシュ読み | キャッシュ書き | 出力 | うち思考 |
|---|---|---|---|---|---|---|
| 20261118-162117-creative-9bbc（誤 --help） | 8adaf1b6-ccfd-4bd3-804d-30ff7feeabdc | 2 | 30,841 | 947 | 605 | 29 |
| 20261118-162157-creative-6d3f（歌詞・構成） | 06f67772-7474-4c7d-ae6d-83b61b947979 | 2 | 38,080 | 1,280 | 6,512 | 1,443 |
| 上記 4 件の compose（5h 制限で失敗） | 各 1 セッション | 0 | 0 | 0 | 0 | - |
| 合計（成功分） | 2 | 4 | 68,921 | 2,227 | 7,117 | 1,472 |

<!-- auto-usage:begin -->
（compose 成功後に tools/collect-usage.py --lane fullchorus で追記する）
<!-- auto-usage:end -->
