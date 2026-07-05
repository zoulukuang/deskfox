#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""清理自动测试残留:清 composer 草稿 + 恢复 4 测试目录项目列表,启动干净本地版。"""
import json, os, glob, time, subprocess, urllib.request, websocket
UD = os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local")
GD = os.path.join(UD, "opencode.global.dat")
APP = "/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
HOME = os.path.expanduser("~")
def sh(*a): return subprocess.run(a, capture_output=True, text=True)
def anchor(d):
    p=os.path.join(d,".deskfox","id"); return open(p).read().strip() if os.path.exists(p) else None

# 1) 先启动指向 PLAN(草稿所在)清掉草稿
d=json.load(open(GD)); s=json.loads(d["server"])
s["projects"]["local"]=[{"worktree":"/Volumes/ExtSSD/OPENCODE-PLAN","expanded":True}]
s["lastProject"]["local"]="/Volumes/ExtSSD/OPENCODE-PLAN"
d["server"]=json.dumps(s,ensure_ascii=False); json.dump(d,open(GD,"w"),ensure_ascii=False,indent="\t")
sh("pkill","-f","DeskFox 本地版.app/Contents/"); time.sleep(2)
subprocess.Popen(["open","-n",APP,"--args","--remote-debugging-port=9222"])
for _ in range(40):
    try: urllib.request.urlopen("http://127.0.0.1:9222/json/version",timeout=1); break
    except: time.sleep(1)
time.sleep(6)
t=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")); p=next(x for x in t if x.get("type")=="page")
ws=websocket.create_connection(p["webSocketDebuggerUrl"],timeout=25,suppress_origin=True)
def ev(expr):
    ws.send(json.dumps({"id":1,"method":"Runtime.evaluate","params":{"expression":expr,"returnByValue":True,"awaitPromise":True}}))
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==1: return m.get("result",{}).get("result",{}).get("value")
cleared = ev("""(()=>{const el=document.querySelector('[data-component="prompt-input"][contenteditable="true"]')||document.querySelector('[contenteditable="true"]');
 if(!el)return 'NO_EDITOR'; el.focus(); document.execCommand('selectAll',false,null); document.execCommand('delete',false,null);
 el.dispatchEvent(new InputEvent('input',{bubbles:true})); return (el.innerText||'').trim();})()""")
print("草稿清理后 composer =", repr(cleared))
time.sleep(2); ws.close()

# 2) 恢复 4 测试目录
sh("pkill","-f","DeskFox 本地版.app/Contents/"); time.sleep(2)
cands=glob.glob(os.path.join(HOME,"Projects","R-*"))+glob.glob(os.path.join(HOME,"Projects","S-*"))+glob.glob(os.path.join(HOME,"W-*"))
dirs=[]
for c in sorted(cands):
    if os.path.isdir(c):
        a=anchor(c); dirs.append({"worktree":c,"expanded":False,**({"id":a} if a else {})})
d=json.load(open(GD)); s=json.loads(d["server"])
s["projects"]["local"]=dirs
if dirs: s["lastProject"]["local"]=dirs[0]["worktree"]
d["server"]=json.dumps(s,ensure_ascii=False); json.dump(d,open(GD,"w"),ensure_ascii=False,indent="\t")
print("恢复", len(dirs), "项目:", [x["worktree"] for x in dirs])

# 3) 干净启动(无调试口)
subprocess.Popen(["open","-n",APP])
time.sleep(3)
print("干净本地版已启动")
