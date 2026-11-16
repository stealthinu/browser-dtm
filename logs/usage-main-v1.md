# main-v1 使用量ログ（手書き）

## M1 — プロンプト往復・ボカロ風v2・録音傷

- 開始: 2026-11-16 10:38:17 JST
- 終了記録（最終commit直前）: 2026-11-16 10:57:57 JST
- 所要: 19分40秒
- 失敗後の修復: 4回（npm test 1、録音対照 1、e2e:llm 2。各テスト上限2以内）
- CLI切替: 指定されたSonnet→Codexのロール切替1回。障害・quotaによる切替0回、従量fallback0回
- 購読LLM呼出: Sonnet 1回、Codex 1回。返答は未編集保存。Opus判断0回
- 最終結果: 単体32/32、e2e8/8、fx25/25、LLM17/17、MCP PASS
- トークン数: この手書きログでは計測していないため記載しない
- 証拠: REPORT.md の main-v1 M1 節、docs/evidence/main-v1-m1.json

## M2 — SoundFontの楽器・ドラム＋ピアノロール編集

- 開始: 2026-11-16 10:59:16 JST
- 終了記録（最終commit直前）: 2026-11-16 11:14:53 JST
- 所要: 15分37秒
- 失敗後の修復: 計3回（e2e:soundfont 2、e2e:pianoroll 1。各テスト上限2以内）。単体・M1回帰は0回
- CLI切替: 0回（provider/quota障害無し）。購読LLM/Opus呼出0、従量API0
- 最終結果: npm test38/38、SoundFont6/6、pianoroll14/14、e2e8/8、fx25/25、LLM17/17、MCP PASS
- トークン数: この手書きログでは計測していないため記載しない
- 証拠: REPORT.mdのmain-v1 M2節、docs/evidence/main-v1-m2.json、指定の最終MP3/画面

## M3（最終）— サンプル集・MCP整合・実LLM長尺往復・最終検証

- 開始: 2026-11-16 11:16:16 JST
- 終了記録（最終commit直前）: 2026-11-16 11:34:32 JST
- 所要: 18分16秒
- 失敗後の修復: 0回（全受入テスト初回PASS、各テスト上限2以内）
- CLI切替: provider/quota障害による切替0回。指定のSonnet→Codexロール切替1回、従量fallback0回
- 購読LLM呼出: creative-sonnet 1回（11.3秒）、exec-sol 1回（54.9秒）。未編集返答と出所ハッシュを保存。Opus判断0回
- 最終結果: npm ci/build成功、単体48/48、e2e合計101/101、MCP14道具PASS。全MP3 10本clip0、画面3枚最新
- トークン数: この手書きログでは計測していないため記載しない
- 証拠: REPORT.mdのmain-v1 M3/最終節、docs/evidence/main-v1-m3.json、main-v1-m3-*.log、最終MP3/画面
