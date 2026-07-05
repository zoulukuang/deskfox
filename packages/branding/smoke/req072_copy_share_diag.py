#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""诊断:打开副本项目 session 共享。reload 后抓 session.list 请求 URL + 响应体条数。"""
import json, os, time, subprocess, urllib.request, websocket

UD = os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local")
GD = os.path.join(UD, "opencode.global.dat")
APP = "/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
COPY = "/Users/openclaw/W-标题也改了_副本"

def sh(*a): return subprocess.run(a, capture_output=True, text=True)
def rd(): d=json.load(open(GD)); return d, json.loads(d["server"])
def seed(worktree):
    d,s=rd(); s["projects"]["local"]=[{"worktree":worktree,"expanded":True}]; s["lastProject"]["local"]=worktree
    d["server"]=json.dumps(s,ensure_ascii=False); json.dump(d,open(GD,"w"),ensure_ascii=False,indent="\t")
def kill(): sh("pkill","-f","DeskFox 本地版.app/Contents/"); time.sleep(2)
def cdp():
    t=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")); p=next(x for x in t if x.get("type")=="page")
    return websocket.create_connection(p["webSocketDebuggerUrl"],timeout=25,suppress_origin=True)

seed(COPY); kill()
subprocess.Popen(["open","-n",APP,"--args","--remote-debugging-port=9222"])
for _ in range(40):
    try: urllib.request.urlopen("http://127.0.0.1:9222/json/version",timeout=1); break
    except: time.sleep(1)
time.sleep(4)

ws=cdp(); mid=[0]
def send(method,params=None):
    mid[0]+=1; mine=mid[0]; ws.send(json.dumps({"id":mine,"method":method,"params":params or {}})); return mine
def wait(i):
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==i: return m.get("result",{})
send("Network.enable"); send("Runtime.enable")
# reload 重新触发所有请求
send("Runtime.evaluate",{"expression":"location.reload()"})
reqs={}
ws.settimeout(2); end=time.time()+20
while time.time()<end:
    try: m=json.loads(ws.recv())
    except: continue
    meth=m.get("method")
    if meth=="Network.requestWillBeSent":
        u=m["params"]["request"]["url"]
        if "/session" in u and ("roots" in u or "scope" in u):
            reqs[m["params"]["requestId"]]={"url":u}
    elif meth=="Network.loadingFinished":
        rid=m["params"]["requestId"]
        if rid in reqs:
            try:
                bid=send("Network.getResponseBody",{"requestId":rid}); r=wait(bid)
                body=r.get("body","")
                try: arr=json.loads(body); reqs[rid]["count"]=len(arr) if isinstance(arr,list) else "?"; reqs[rid]["ids"]=[x.get("id","?")[:14] for x in arr][:5] if isinstance(arr,list) else None
                except: reqs[rid]["count"]="parse-fail"; reqs[rid]["raw"]=body[:120]
            except Exception as e: reqs[rid]["err"]=str(e)[:80]

print("=== 打开副本 W-标题也改了_副本 后的 session.list 请求 ===")
for r in reqs.values():
    q = r["url"].split("?",1)[-1] if "?" in r["url"] else ""
    print(f"  count={r.get('count')} ids={r.get('ids')} q={q[:120]}")
if not reqs: print("  (未抓到 session.list 请求)")
ws.close(); kill()
