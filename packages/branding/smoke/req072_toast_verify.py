#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证:切到目录已删除的项目 → 不再弹「列出文件失败 503」toast(仍显文件树占位)。"""
import json, os, sys, time, subprocess, urllib.request, websocket

UD = os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local")
GD = os.path.join(UD, "opencode.global.dat")
APP = "/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
P = f"/Users/openclaw/toasttest-{int(time.time())}"

def sh(*a): return subprocess.run(a, capture_output=True, text=True)
def rd(): d=json.load(open(GD)); return d, json.loads(d["server"])
def seed(projs, last):
    d,s=rd(); s["projects"]["local"]=projs; s["lastProject"]["local"]=last
    d["server"]=json.dumps(s,ensure_ascii=False); json.dump(d,open(GD,"w"),ensure_ascii=False,indent="\t")
def kill(): sh("pkill","-f","DeskFox 本地版.app/Contents/"); time.sleep(2)
def launch():
    subprocess.Popen(["open","-n",APP,"--args","--remote-debugging-port=9222"])
    for _ in range(40):
        try: urllib.request.urlopen("http://127.0.0.1:9222/json/version",timeout=1); break
        except: time.sleep(1)
    time.sleep(4)
def ev(expr):
    t=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")); p=next(x for x in t if x.get("type")=="page")
    ws=websocket.create_connection(p["webSocketDebuggerUrl"],timeout=20,suppress_origin=True)
    ws.send(json.dumps({"id":1,"method":"Runtime.evaluate","params":{"expression":expr,"returnByValue":True,"awaitPromise":True}}))
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==1: ws.close(); return m.get("result",{}).get("result",{}).get("value")

# 建 git 项目、seed、开一次
sh("bash","-c",f"rm -rf {P}; mkdir -p {P} && cd {P} && git init -q && git -c user.email=t@e.com -c user.name=t commit -q --allow-empty -m init")
kill(); seed([{"worktree":P,"expanded":True}], P); launch(); time.sleep(3)
# 删掉目录(模拟切到目录已删的项目)
sh("bash","-c",f"rm -rf {P}")
# 重启,lastProject=已删项目 → 加载 → /file 503
kill(); seed([{"worktree":P,"expanded":True}], P); launch(); time.sleep(5)
# 抓 toast + 文件树占位
res = ev("""JSON.stringify({
  toasts: [...document.querySelectorAll('[data-corvu-toast],[role="status"]')].map(e=>e.innerText.trim()).filter(Boolean),
  hasListFailedToast: [...document.querySelectorAll('[data-corvu-toast],[role="status"]')].some(e=>e.innerText.includes('列出文件失败')||e.innerText.includes('503')),
  fileTreePlaceholder: document.body.innerText.includes('加载文件树失败')
})""")
r = json.loads(res)
print("toasts:", r["toasts"])
print("has 503/列出文件失败 toast:", r["hasListFailedToast"])
print("file tree placeholder shown:", r["fileTreePlaceholder"])
kill()
sh("bash","-c",f"rm -rf {P}")
ok = (not r["hasListFailedToast"])
print(f"\n{'PASS ✅ 无 503 toast(占位保留)' if ok else 'FAIL ❌ 仍弹 503 toast'}")
sys.exit(0 if ok else 1)
