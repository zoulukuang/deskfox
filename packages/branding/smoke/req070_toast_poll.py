#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REQ-070 2a toast 精确复测:卸载盘→冷启动→每 0.5s 轮询 body 文案,捕捉 unreachable 引导 toast
(toast 会自动淡出,7s 一次性抓易漏)。"""
import json, os, time, subprocess, urllib.request, websocket
UD=os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local")
GD=os.path.join(UD,"opencode.global.dat")
APP="/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
VOL="/Volumes/WININSTALL"; NONGIT="/Volumes/WININSTALL/养老"
GIT="/Volumes/WININSTALL/程序代码/MyProgram/UvxyOptionPrice"; GIT_ID="96178197511accc650dacecdda09a2b42382d406"
def sh(*a): return subprocess.run(a,capture_output=True,text=True)
def kill(): sh("pkill","-f","DeskFox 本地版.app/Contents/"); time.sleep(2)
def mount():
    r=sh("diskutil","mount","/dev/disk4s1")
    if r.returncode!=0: sh("diskutil","mount",VOL)
    time.sleep(1)
d=json.load(open(GD)); s=json.loads(d["server"])
s["projects"]["local"]=[{"worktree":NONGIT,"expanded":False,"id":"fld_946fa06c993ddc886eaf59d7dc8f3c84"},
                        {"worktree":GIT,"expanded":False,"id":GIT_ID}]
s["lastProject"]["local"]=NONGIT
d["server"]=json.dumps(s,ensure_ascii=False); json.dump(d,open(GD,"w"),ensure_ascii=False,indent="\t")
kill()
sh("diskutil","unmount","force",VOL); time.sleep(1)
print("盘已卸载:", "是" if not os.path.isdir(VOL) else "否")
subprocess.Popen(["open","-n",APP,"--args","--remote-debugging-port=9222"])
for _ in range(40):
    try: urllib.request.urlopen("http://127.0.0.1:9222/json/version",timeout=1); break
    except: time.sleep(1)
# 尽快连上,轮询 body 文案
seen=""; ws=None
for i in range(30):  # 15s 窗口
    try:
        if ws is None:
            t=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")); p=next(x for x in t if x.get("type")=="page")
            ws=websocket.create_connection(p["webSocketDebuggerUrl"],timeout=10,suppress_origin=True)
        ws.send(json.dumps({"id":1,"method":"Runtime.evaluate","params":{"expression":"document.body?document.body.innerText:''","returnByValue":True}}))
        while True:
            m=json.loads(ws.recv())
            if m.get("id")==1: break
        body=m.get("result",{}).get("result",{}).get("value") or ""
        if any(k in body for k in ["暂不可达","unavailable","未连接"]):
            # 抓到,截取含关键字的行
            for line in body.split("\n"):
                if any(k in line for k in ["暂不可达","unavailable","未连接","重试","磁盘"]):
                    seen=line.strip(); break
            if seen: break
    except Exception:
        ws=None
    time.sleep(0.5)
if ws: ws.close()
kill(); mount()
print("捕捉到 toast 文案:", repr(seen) if seen else "(未捕捉到)")
print("盘已重挂:", "是" if os.path.isdir(NONGIT) else "否")
print("判定:", "PASS ✅" if seen else "FAIL ❌")
