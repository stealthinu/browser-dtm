# AGENTS.md — ブラウザDTM

VocaTab と onjmin/dtm を使った、歌と楽器のブラウザ DTM。担当 bot は「ブラウザDTM」（6b52edfc）。仕様は `SPEC.md`、使い方は `README.md`。

## 置き場所（2026-11-26）
- 正本: デスクトップ WSL `~/browser-dtm/repo`（GitHub `stealthinu/browser-dtm`、`main`）。T3 プロジェクト名 `browser-dtm`。
- **正本はデスクトップ**（Kiyoshiさん 2026-11-26）。box の `/workspace/browser-dtm` は旧作業場所で、消さずに残してある（未コミットだった fullchorus・gallery 作業は `wip/box-fullchorus-20261126` 経由で 2026-11-26 に main へ取り込み済み）。box 側では新しい作業をしない。

## 動かし方（WSL）
- `npm ci`
- 上流ソース（`vendor/` は .gitignore 済み。ワークツリーでは正本の vendor を指せばよい）:
  `export VOCATAB_DIR=~/browser-dtm/repo/vendor/vocatab DTM_DIR=~/browser-dtm/repo/vendor/dtm`
- テスト: `npm test`（2026-11-26 時点で 49 件 pass）。ビルド: `npm run build`。
- 手元サーバー: `npm run serve`（`127.0.0.1:5500`）。
- 歌声モデル・ボコーダ・SoundFont はコミットしない（再配布禁止）。

## T3 Code から作業するとき（共通、2026-11-26）
- 開発は KSATO-DESKTOP WSL の T3 Code（`http://100.90.81.97:3773/`、スマホは T3 Connect）でやる。Grok Bot は監視と全体の指示だけ。手順の正本は `~/shared-kb/t3code-desktop.md`、チーム規約は `~/bots/setup/setup/T3-TEAM.md`。
- プロジェクトの正本は `~/<プロジェクト名>/`（この repo はその中の `repo/` など）。旧パス（`~/projects/...`、`~/bots/...`）は symlink で残してあるが、新しく書くときは新パスを使う。
- **1 スレッド 1 ワークツリー**。CLI なら `--worktree <基点ブランチ> --branch t3/<作業名>`。ワークツリーは `~/.t3/worktrees/` にできる。同じフォルダで 2 スレッドを同時に書かせない。正本のチェックアウトを直接編集しない。
- モデル: 実装は Codex `gpt-6.2-sol`（`reasoningEffort=high`）、レビューは別モデル（Codex `gpt-6.2-astra` など）。Cursor は必ず `composer-2.5` か `default`（Auto）を明示する（Other Models 枠が残り少ない）。創作・デザインは Claude Opus（サブスクのみ。`ANTHROPIC_API_KEY` は使わない）。
- pstack: Codex は `$poteto-mode`（プラグイン `pstack@pstack-claude`、役割モデルは `~/.codex/pstack-models.md`）、Claude Code は `/pstack:poteto-mode`、Cursor は `/poteto-mode`、OpenCode は pstack プラグイン。重い作業や長い作業はこれで進め、終わる条件（テストが通る等）を必ず書く。
- GPU を使う処理は必ず `gpuq` 経由。実行中のジョブ、tmux、他のスレッドの作業フォルダには触らない。
- force-push しない。データを消さない。プロセスは PID 指定でだけ止める。秘密（`.env*`、`~/bots/secrets/`、トークン）は表示もコミットもしない。待ち受けポートを LAN/Tailscale に出すときは Kiyoshiさんの承認を取る。
- デスクトップから box（Grok Bot の VM）へ ssh しない。box 側が要るときは Grok Bot に頼む。
- 区切りごとに、変えたファイル・テスト結果・残りのリスクを HANDOFF / NOTES に書く。
