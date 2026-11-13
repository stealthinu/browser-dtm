# 起動したジョブ（2026-11-13 20:35 JST）

| 手法 | ブランチ | 実行 | ジョブ | モデル | 時間上限 |
|---|---|---|---|---|---|
| claude-code | impl/claude-code | jev（box `/workspace/browser-dtm-wt/claude-code`） | 20261113-203534-complex-claude-2655 | Claude Code / claude-opus-5-5 high（role complex-claude, --no-quota） | 4h（00:15 JST までに REPORT、00:35 JST に timeout で強制終了） |
| codex | impl/codex | jev（box `/workspace/browser-dtm-wt/codex`） | 20261113-203536-complex-22ca | Codex / gpt-6.1-sol high（role complex, --no-quota, sandbox full） | 同上 |
| cursor | impl/cursor | Cursor クラウドエージェント（Grok Bot 本体が起動） | - | - | - |

- 指示: 両ジョブとも同一のプロンプト（box `/workspace/browser-dtm-wt/PROMPT.md`、WORKER CONTRACT＋SPEC.md を読んで実装）。
- jev の記録: box `~/jev-starter/status/<job>.json`、ログ `~/jev-starter/logs/<job>.log`（`jev-status --tail <job> | jev-shrink`）。
- 使用量の集計（ジョブ終了後、box で）:
  - `tools/collect-usage.py --lane claude-code --cwd /workspace/browser-dtm-wt/claude-code --job 20261113-203534-complex-claude-2655`
  - `tools/collect-usage.py --lane codex --cwd /workspace/browser-dtm-wt/codex --job 20261113-203536-complex-22ca`
  - 書き込み先は各作業ツリーの `logs/usage-<手法>.md`（自動集計欄）。commit/push は集計した側が行う。
- gpt-6.2-sol は ChatGPT ログインの Codex で未対応（2026-11-13 20:31 JST に確認: "not supported when using Codex with a ChatGPT account"）のため gpt-6.1-sol。
