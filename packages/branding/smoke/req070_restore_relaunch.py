#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""恢复项目列表(4 本地测试目录 + 2 外置盘项目),干净启动 local 版供 user 验。"""
import json, os, glob, time, subprocess
GD=os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local/opencode.global.dat")
APP="/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
HOME=os.path.expanduser("~")
def sh(*a): return subprocess.run(a,capture_output=True,text=True)
def anchor(d):
    p=os.path.join(d,".deskfox","id"); return open(p).read().strip() if os.path.exists(p) else None
cands=glob.glob(os.path.join(HOME,"Projects","R-*"))+glob.glob(os.path.join(HOME,"Projects","S-*"))+glob.glob(os.path.join(HOME,"W-*"))
cands+=["/Volumes/WININSTALL/养老","/Volumes/WININSTALL/程序代码/MyProgram/UvxyOptionPrice"]
dirs=[]
for c in cands:
    if os.path.isdir(c):
        a=anchor(c); dirs.append({"worktree":c,"expanded":False,**({"id":a} if a else {})})
d=json.load(open(GD)); s=json.loads(d["server"])
s["projects"]["local"]=dirs
if dirs: s["lastProject"]["local"]=dirs[0]["worktree"]
d["server"]=json.dumps(s,ensure_ascii=False); json.dump(d,open(GD,"w"),ensure_ascii=False,indent="\t")
sh("pkill","-f","DeskFox 本地版.app/Contents/"); time.sleep(2)
subprocess.Popen(["open","-n",APP]); time.sleep(3)
print("恢复", len(dirs), "项目并启动:")
for x in dirs: print("  ", x["worktree"])
