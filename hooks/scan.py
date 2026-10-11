#!/usr/bin/env python3
"""Scan Claude Code transcripts: per-session tokens bucketed into 5-hour windows.
Prints JSON {now, windows, sessions}. Times are epoch ms. Usage: scan.py [days=14]"""
import glob, json, os, sys, time
from datetime import datetime

DAYS = float(sys.argv[1]) if len(sys.argv) > 1 else 14
WINDOW = 5 * 3600
HOME = os.path.expanduser("~")
now = time.time()
since = now - DAYS * 86400
root = os.path.join(HOME, ".claude", "projects")

titles = {}  # cliSessionId -> sidebar title, from the desktop app's session metadata
for p in glob.glob(os.path.join(HOME, "Library/Application Support/Claude/claude-code-sessions/**/local_*.json"), recursive=True):
    try:
        d = json.load(open(p, encoding="utf-8"))
        if d.get("cliSessionId") and d.get("title"):
            titles[d["cliSessionId"]] = d["title"]
    except (OSError, ValueError):
        continue

def ts_of(o):
    return datetime.fromisoformat(o["timestamp"].replace("Z", "+00:00")).timestamp()

def prompt_text(o):
    c = (o.get("message") or {}).get("content")
    if isinstance(c, list):
        c = next((b.get("text") for b in c if isinstance(b, dict) and b.get("type") == "text"), "")
    return " ".join(c.split())[:60] if isinstance(c, str) and not c.startswith("<") else ""

calls, meta, seen = [], {}, set()
for path in glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True):
    try:
        if os.path.getmtime(path) < since:
            continue
        project = os.path.relpath(path, root).split(os.sep)[0]
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                has_usage = '"usage"' in line
                is_user = '"type":"user"' in line
                if not (has_usage or is_user):
                    continue
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                sid = o.get("sessionId") or os.path.basename(path)[:-6]
                m = meta.setdefault(sid, {"project": project, "cwd": o.get("cwd", ""), "prompt": ""})
                if o.get("cwd"):
                    m["cwd"] = o["cwd"]
                if is_user and not m["prompt"] and o.get("type") == "user":
                    m["prompt"] = prompt_text(o)
                msg = o.get("message") or {}
                u = msg.get("usage")
                if o.get("type") != "assistant" or not u:
                    continue
                try:
                    ts = ts_of(o)
                except (KeyError, ValueError):
                    continue
                if ts < since:
                    continue
                key = (msg.get("id"), o.get("requestId"))
                if key != (None, None):
                    if key in seen:
                        continue
                    seen.add(key)
                calls.append((ts, sid,
                              (u.get("input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0),
                              u.get("output_tokens") or 0,
                              u.get("cache_read_input_tokens") or 0))
    except OSError:
        continue

calls.sort()
windows, widx = [], []  # a window opens at the first call after the previous one closed
for c in calls:
    if not windows or c[0] >= windows[-1][1]:
        windows.append([c[0], c[0] + WINDOW])
    widx.append(len(windows) - 1)

sessions = {}
for c, w in zip(calls, widx):
    s = sessions.setdefault(c[1], {"id": c[1], "byWindow": {}, "calls": [], "first": c[0], "last": c[0]})
    b = s["byWindow"].setdefault(str(w), [0, 0, 0, 0])
    b[0] += c[2]; b[1] += c[3]; b[2] += c[4]; b[3] += 1
    s["first"], s["last"] = min(s["first"], c[0]), max(s["last"], c[0])
    s["calls"].append([int(c[0] * 1000), c[2], c[3]])

out = []
for sid, s in sessions.items():
    if not any(b[0] + b[1] for b in s["byWindow"].values()):
        continue  # zero-token noise, e.g. one-shot classifier calls
    m = meta.get(sid, {})
    s["title"] = titles.get(sid) or m.get("prompt") or sid[:8]
    s["project"] = m.get("project", "")
    s["cwd"] = m.get("cwd", "")
    s["first"], s["last"] = int(s["first"] * 1000), int(s["last"] * 1000)
    s["calls"] = s["calls"][-400:]
    out.append(s)
out.sort(key=lambda s: s["last"], reverse=True)
print(json.dumps({"now": int(now * 1000),
                  "windows": [[int(a * 1000), int(b * 1000)] for a, b in windows],
                  "sessions": out}))
