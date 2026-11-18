#!/usr/bin/env python3
"""Collect token usage for one implementation lane and write it into logs/usage-<lane>.md.

Sources (read-only, nothing is sent anywhere):
  - jev job status:  ~/jev-starter/status/<job-id>.json   (start/end, exit code, role, model, route)
  - Codex sessions:  ~/.codex/sessions/**/rollout-*.jsonl  (session_meta.cwd + last token_count)
  - Claude sessions: ~/.claude/projects/<cwd-slug>/*.jsonl (assistant message.usage, deduped by message id)
Cursor usage is not on this machine: take it from the Cursor dashboard (Usage → Export CSV) or the Admin API.

Usage: tools/collect-usage.py --lane codex --cwd <repo-worktree> --job <jev-job-id> [--out logs/usage-codex.md]
"""
import argparse, glob, json, os, re
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
BEGIN, END = "<!-- auto-usage:begin -->", "<!-- auto-usage:end -->"


def ts(s):
    if not s: return None
    try: return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except ValueError: return None


def codex_usage(cwd, t0, t1):
    tot = dict(sessions=0, input=0, cached_input=0, output=0, reasoning_output=0)
    for f in glob.glob(str(HOME / ".codex/sessions/**/rollout-*.jsonl"), recursive=True):
        if os.path.getmtime(f) < (t0 or 0) - 60: continue
        meta_cwd, start, last = None, None, None
        with open(f, errors="replace") as fh:
            for line in fh:
                if '"session_meta"' in line and meta_cwd is None:
                    try:
                        p = json.loads(line)["payload"]; meta_cwd = p.get("cwd"); start = ts(p.get("timestamp"))
                    except Exception: pass
                elif '"token_count"' in line:
                    try:
                        o = json.loads(line); info = (o.get("payload") or o).get("info") or {}
                        if info.get("total_token_usage"): last = info["total_token_usage"]
                    except Exception: pass
        if not meta_cwd or os.path.realpath(meta_cwd) != os.path.realpath(cwd): continue
        if start and ((t0 and start < t0 - 60) or (t1 and start > t1 + 60)): continue
        tot["sessions"] += 1
        if last:
            tot["input"] += last.get("input_tokens", 0); tot["cached_input"] += last.get("cached_input_tokens", 0)
            tot["output"] += last.get("output_tokens", 0); tot["reasoning_output"] += last.get("reasoning_output_tokens", 0)
    return tot


def claude_usage(cwd, t0, t1):
    slug = re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(cwd))
    tot = dict(sessions=0, input=0, cache_read=0, cache_write=0, output=0)
    for f in glob.glob(str(HOME / ".claude/projects" / slug / "*.jsonl")):
        if os.path.getmtime(f) < (t0 or 0) - 60: continue
        per_msg, used = {}, False
        with open(f, errors="replace") as fh:
            for line in fh:
                if '"usage"' not in line: continue
                try: o = json.loads(line)
                except Exception: continue
                t = ts(o.get("timestamp"))
                if t and ((t0 and t < t0 - 60) or (t1 and t > t1 + 60)): continue
                m = o.get("message") or {}
                u = m.get("usage")
                if not u: continue
                k = m.get("id") or id(o); prev = per_msg.get(k, {})
                per_msg[k] = {f: max(prev.get(f) or 0, u.get(f) or 0) for f in
                              ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")}
                used = True
        if used: tot["sessions"] += 1
        for u in per_msg.values():
            tot["input"] += u.get("input_tokens") or 0; tot["output"] += u.get("output_tokens") or 0
            tot["cache_read"] += u.get("cache_read_input_tokens") or 0
            tot["cache_write"] += u.get("cache_creation_input_tokens") or 0
    return tot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lane", required=True); ap.add_argument("--cwd", required=True)
    ap.add_argument("--job", action="append", default=[], help="jev job id (repeatable)")
    ap.add_argument("--out")
    a = ap.parse_args()
    jobs = []
    for j in a.job:
        p = HOME / "jev-starter/status" / f"{j}.json"
        if p.is_file(): jobs.append(json.loads(p.read_text()))
    t0 = min([x.get("start_ts") or ts(x.get("start")) or 0 for x in jobs] or [0]) or None
    ends = [ts(x.get("end")) or x.get("end_ts") for x in jobs]
    t1 = None if (not jobs or any(e is None for e in ends)) else max(ends)
    cx, cl = codex_usage(a.cwd, t0, t1), claude_usage(a.cwd, t0, t1)
    now = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")
    lines = [BEGIN, f"## 自動集計（tools/collect-usage.py, {now}）", "",
             "| jev job | role | model | 状態 | exit | 開始 | 終了 | 所要(分) |", "|---|---|---|---|---|---|---|---|"]
    for x in jobs:
        s, e = x.get("start_ts") or ts(x.get("start")), ts(x.get("end"))
        dur = f"{(e - s) / 60:.1f}" if s and e else "実行中"
        r = x.get("route") or {}
        lines.append(f"| {x.get('id')} | {x.get('role')} | {r.get('model') or x.get('model')} | {x.get('state')} | {x.get('exit_code')} | {x.get('start')} | {x.get('end') or '-'} | {dur} |")
    lines += ["", "| ソース | セッション | 入力 | うちキャッシュ読み | キャッシュ書き | 出力 | うち推論 |", "|---|---|---|---|---|---|---|"]
    if cx["sessions"]:
        lines.append(f"| Codex（input はキャッシュ込み） | {cx['sessions']} | {cx['input']:,} | {cx['cached_input']:,} | - | {cx['output']:,} | {cx['reasoning_output']:,} |")
    if cl["sessions"]:
        lines.append(f"| Claude Code（input はキャッシュ別） | {cl['sessions']} | {cl['input']:,} | {cl['cache_read']:,} | {cl['cache_write']:,} | {cl['output']:,} | - |")
    if not (cx["sessions"] or cl["sessions"]):
        lines.append("| （このマシンにこの作業ディレクトリのセッション記録なし。Cursor はダッシュボード/Admin API で取得） | 0 | - | - | - | - | - |")
    lines += ["", "修復回数・CLI切替回数はワーカーが下の手書き欄に書く。", END]
    block = "\n".join(lines)
    out = Path(a.out or Path(a.cwd) / "logs" / f"usage-{a.lane}.md")
    out.parent.mkdir(parents=True, exist_ok=True)
    old = out.read_text() if out.is_file() else f"# 使用量ログ: {a.lane}\n\n"
    new = re.sub(re.escape(BEGIN) + ".*?" + re.escape(END), lambda _: block, old, flags=re.S) if BEGIN in old else old.rstrip() + "\n\n" + block + "\n"
    out.write_text(new)
    print(block)


if __name__ == "__main__":
    main()
