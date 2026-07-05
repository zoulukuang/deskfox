#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""恢复 local 版项目列表为 4 个 REQ-072 测试目录(glob 发现,不硬编码中文名)。"""
import json, os, glob, subprocess
GD = os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local/opencode.global.dat")
HOME = os.path.expanduser("~")

def anchor_id(d):
    p = os.path.join(d, ".deskfox", "id")
    if os.path.exists(p):
        return open(p).read().strip()
    return None

candidates = []
candidates += glob.glob(os.path.join(HOME, "Projects", "R-*"))
candidates += glob.glob(os.path.join(HOME, "Projects", "S-*"))
candidates += glob.glob(os.path.join(HOME, "W-*"))
dirs = []
for d in candidates:
    if not os.path.isdir(d):
        continue
    aid = anchor_id(d)
    dirs.append({"worktree": d, "expanded": False, **({"id": aid} if aid else {})})

d = json.load(open(GD)); s = json.loads(d["server"])
s["projects"]["local"] = dirs
if dirs:
    s["lastProject"]["local"] = dirs[0]["worktree"]
d["server"] = json.dumps(s, ensure_ascii=False)
json.dump(d, open(GD, "w"), ensure_ascii=False, indent="\t")
print("restored", len(dirs), "projects:")
for x in dirs:
    print("  ", x["worktree"], "id=", x.get("id"))
