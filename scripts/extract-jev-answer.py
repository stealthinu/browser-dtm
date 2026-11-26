#!/usr/bin/env python3
"""Save jev result_text to out/fullchorus/answers/<id>.txt (unedited)."""
import argparse, json, re, sys
from pathlib import Path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--out-dir", default="/workspace/browser-dtm/out/fullchorus/answers")
    a = ap.parse_args()
    st = Path.home() / "jev-starter/status" / f"{a.job}.json"
    o = json.loads(st.read_text())
    if o.get("state") != "done" or o.get("exit_code") not in (0, "0"):
        print(f"job not successful: state={o.get('state')} exit={o.get('exit_code')}", file=sys.stderr)
        return 1
    text = o.get("result_text") or ""
    dest = Path(a.out_dir) / f"{a.id}.txt"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    print(f"wrote {dest} ({len(text)} chars) from {a.job}")
    if "```json" not in text:
        print("warning: no ```json fence in result_text", file=sys.stderr)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
