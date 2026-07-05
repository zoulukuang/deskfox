#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REQ-072:打开复制副本目录应停在副本本身(项目头 data-project = 副本 worktree)。"""
import json, os, time, subprocess, urllib.request, websocket, base64
GD=os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local/opencode.global.dat")
APP="/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
COPY="/Users/openclaw/W-标题也改了_副本"
ORIG="/Users/openclaw/Projects/R-标题也改了"
def sh(*a): return subprocess.run(a,capture_output=True,text=True)
d=json.load(open(GD)); s=json.loads(d["server"])
s["projects"]["local"]=[{"worktree":COPY,"expanded":True}]; s["lastProject"]["local"]=COPY
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
        if m.get("id")==1:
            r=m.get("result",{})
            if "exceptionDetails" in r: return {"err":str(r["exceptionDetails"])[:150]}
            return r.get("result",{}).get("value")
# 收集所有 data-project 值(base64 worktree)
raw=ev("JSON.stringify([...new Set([...document.querySelectorAll('[data-project]')].map(e=>e.getAttribute('data-project')))])")
vals=json.loads(raw) if isinstance(raw,str) else []
def enc(p):
    return base64.b64encode(p.encode('utf-8')).decode('ascii').replace('+','-').replace('/','_').replace('=','')
copy_b64=enc(COPY); orig_b64=enc(ORIG)
print("data-project 值:", vals)
print("copy_b64:", copy_b64, "| orig_b64:", orig_b64)
stay = copy_b64 in vals and orig_b64 not in vals
print("STAY_IN_COPY:", "PASS" if stay else "FAIL")
ws.close(); sh("pkill","-f","DeskFox 本地版.app/Contents/")
