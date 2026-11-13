# REPORT — impl/claude-code

## GOAL
SPEC.md の最小版: プロンプトコピペ方式で LLM（実装中は見本返答フィクスチャ）から SongDoc＋MML を貼り戻すと、
VocaTab の歌声（画面なし engine-web Worker）＋ dtm の伴奏（2パート以上）がブラウザで同じ時計で鳴る。
エフェクト4種（ケロケロ/ボコーダー/ビットクラッシャー/ダブリング、強度0〜1）、ピアノロール表示、MCP サーバー（stdio）、既定 MP3 書き出し。

## ACCEPTANCE TESTS（確認コマンド）
| ID | コマンド | 合格条件 |
|---|---|---|
| A5 | `npm test` | SongDoc 変換・歌詞割り当ての単体テストが全部通る |
| A1/A2/A3 | `npm run e2e` (headless Chrome で fixtures/sample-response.txt を貼り戻し→再生→MP3 書き出し) | ブラウザで歌＋伴奏が鳴り、`out/song.mp3` の RMS/ピークが無音でもクリップだけでもなく、歌区間・伴奏区間がそれぞれ有音、頭のずれ < 30ms |
| A4 | `npm run e2e:fx` | 4種のエフェクトを強度0と1で書き出し、差分（RMS 差 / 相関）が数値で出る |
| A6 | `npm run mcp:smoke` | MCP サーバーが起動し tools/list が返り、new_song→set_track_notes→set_lyrics→set_track_mml→export で MP3（または WAV）ができる |
| A7 | README の手順 | 依存取得・上流の場所・テスト・書き出しが書かれている |

（結果は作業の最後に下へ追記する）
