#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REQ-072 端到端:打开复制副本目录 → 侧栏应显示与原件共享的 session。
逐个 seed 目录为当前项目 → 启动 local 版 → reload → 读侧栏 [data-session-id] 实际渲染条目。
验证 orphanRootSessions 前端修复:副本目录 store 经 scope=project 拿到原件会话(directory=原件),
sortedRootSessions 精确过滤会滤掉,补 orphan 认领后应可见。"""
import json, os, time, subprocess, urllib.request, websocket

UD = os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local")
GD = os.path.join(UD, "opencode.global.dat")
APP = "/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"

# 场景:(打开目录, 期望标题子串集合, 说明)
CASES = [
    ("/Users/openclaw/W-标题也改了_副本", {"当前模型查询", "天津中考出分时间"}, "非git副本(共享R的2条)"),
    ("/Users/openclaw/W-标题彻底改掉_副本", {"开源ASR模型推荐"}, "git副本(共享S的1条)"),
    ("/Users/openclaw/Projects/R-标题也改了", {"当前模型查询", "天津中考出分时间"}, "原件R(不回归)"),
    ("/Users/openclaw/Projects/S-标题彻底改掉", {"开源ASR模型推荐"}, "原件S(不回归)"),
]

def sh(*a): return subprocess.run(a, capture_output=True, text=True)
def rd(): d=json.load(open(GD)); return d, json.loads(d["server"])
def seed(worktree):
    d,s=rd(); s["projects"]["local"]=[{"worktree":worktree,"expanded":True}]; s["lastProject"]["local"]=worktree
    d["server"]=json.dumps(s,ensure_ascii=False); json.dump(d,open(GD,"w"),ensure_ascii=False,indent="\t")
def kill(): sh("pkill","-f","DeskFox 本地版.app/Contents/"); time.sleep(2)
def cdp():
    t=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")); p=next(x for x in t if x.get("type")=="page")
    return websocket.create_connection(p["webSocketDebuggerUrl"],timeout=25,suppress_origin=True)
def ev(ws, expr, mid):
    mid[0]+=1; mine=mid[0]
    ws.send(json.dumps({"id":mine,"method":"Runtime.evaluate","params":{"expression":expr,"returnByValue":True,"awaitPromise":True}}))
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==mine:
            r=m.get("result",{})
            if "exceptionDetails" in r: return {"__error__": str(r["exceptionDetails"])[:200]}
            return r.get("result",{}).get("value")

READ_SESSIONS = r"""
(() => {
  const seen = new Map();
  document.querySelectorAll('[data-session-id]').forEach(e => {
    const id = e.getAttribute('data-session-id');
    const title = (e.innerText||'').split('\n').map(s=>s.trim()).filter(Boolean)[0] || '';
    if (!seen.has(id)) seen.set(id, title);
  });
  return JSON.stringify([...seen.entries()].map(([id,title])=>({id,title})));
})()
"""

results=[]
for worktree, expect, desc in CASES:
    seed(worktree); kill()
    subprocess.Popen(["open","-n",APP,"--args","--remote-debugging-port=9222"])
    for _ in range(40):
        try: urllib.request.urlopen("http://127.0.0.1:9222/json/version",timeout=1); break
        except: time.sleep(1)
    time.sleep(5)
    ws=cdp(); mid=[0]
    ev(ws,"location.reload()",mid); time.sleep(6)
    raw = ev(ws,READ_SESSIONS,mid)
    ws.close()
    try: items=json.loads(raw) if isinstance(raw,str) else []
    except: items=[]
    titles={it["title"] for it in items}
    ok = expect.issubset(titles)
    results.append((desc, worktree, ok, sorted(titles), sorted(expect)))
    print(f"[{'PASS' if ok else 'FAIL'}] {desc}")
    print(f"    dir={worktree}")
    print(f"    侧栏渲染标题={sorted(titles)}")
    print(f"    期望包含={sorted(expect)}")

kill()
allok=all(r[2] for r in results)
print("\n=== 汇总 ===")
for desc,_,ok,_,_ in results: print(f"  {'✅' if ok else '❌'} {desc}")
print("总判定:", "全部通过 ✅" if allok else "有失败 ❌")
raise SystemExit(0 if allok else 1)
