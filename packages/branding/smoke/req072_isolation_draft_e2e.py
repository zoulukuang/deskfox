#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REQ-072/071 剩余自动验证:
  A. 普通项目会话隔离(scope=project 无回归 + 不泄漏 global/跨项目)
  D. REQ-071 冷启动草稿不丢(键入→完全退出→重开→草稿仍在)
读侧栏实际渲染 [data-session-id];草稿走 prompt-input contenteditable。"""
import json, os, time, subprocess, urllib.request, websocket

UD = os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local")
GD = os.path.join(UD, "opencode.global.dat")
APP = "/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"

PLAN = "/Volumes/ExtSSD/OPENCODE-PLAN"
SITE = "/Volumes/ExtSSD/deskfox-site"

def sh(*a): return subprocess.run(a, capture_output=True, text=True)
def rd(): d=json.load(open(GD)); return d, json.loads(d["server"])
def seed(worktree):
    d,s=rd(); s["projects"]["local"]=[{"worktree":worktree,"expanded":True}]; s["lastProject"]["local"]=worktree
    d["server"]=json.dumps(s,ensure_ascii=False); json.dump(d,open(GD,"w"),ensure_ascii=False,indent="\t")
def kill(): sh("pkill","-f","DeskFox 本地版.app/Contents/"); time.sleep(2)
def launch():
    subprocess.Popen(["open","-n",APP,"--args","--remote-debugging-port=9222"])
    for _ in range(40):
        try: urllib.request.urlopen("http://127.0.0.1:9222/json/version",timeout=1); return
        except: time.sleep(1)
def cdp():
    t=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")); p=next(x for x in t if x.get("type")=="page")
    return websocket.create_connection(p["webSocketDebuggerUrl"],timeout=25,suppress_origin=True)
def ev(ws, expr):
    ws.send(json.dumps({"id":1,"method":"Runtime.evaluate","params":{"expression":expr,"returnByValue":True,"awaitPromise":True}}))
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==1:
            r=m.get("result",{})
            if "exceptionDetails" in r: return {"__err__":str(r["exceptionDetails"])[:200]}
            return r.get("result",{}).get("value")

READ_TITLES = r"""
(() => { const seen=new Map();
  document.querySelectorAll('[data-session-id]').forEach(e=>{const id=e.getAttribute('data-session-id');
    const t=(e.innerText||'').split('\n').map(s=>s.trim()).filter(Boolean)[0]||''; if(!seen.has(id)) seen.set(id,t);});
  return JSON.stringify([...seen.values()]); })()
"""

GLOBAL_ONLY = ["Office文件", "创建测试文档"]          # global 专属,任何普通项目都不该出现
results = []

def open_and_titles(worktree):
    seed(worktree); kill(); launch(); time.sleep(5)
    ws=cdp(); ev(ws,"location.reload()"); time.sleep(6)
    raw=ev(ws,READ_TITLES); ws.close()
    try: return json.loads(raw) if isinstance(raw,str) else []
    except: return []

# ---- Test A1: OPENCODE-PLAN 只见自己会话 ----
t_plan = open_and_titles(PLAN)
plan_has = any("架构决策" in x for x in t_plan) and any("Testing" in x for x in t_plan)
plan_no_global = not any(any(g in x for g in GLOBAL_ONLY) for x in t_plan)
plan_no_cross = not any("东京服务器" in x for x in t_plan)
A1 = plan_has and plan_no_global and plan_no_cross
results.append(("A1 OPENCODE-PLAN 只见自身会话(无 global/跨项目泄漏)", A1, t_plan))

# ---- Test A2: deskfox-site 只见自己会话 ----
t_site = open_and_titles(SITE)
site_has = any("东京服务器" in x for x in t_site)
site_no_global = not any(any(g in x for g in GLOBAL_ONLY) for x in t_site)
site_no_cross = not any("架构决策" in x for x in t_site)
A2 = site_has and site_no_global and site_no_cross
results.append(("A2 deskfox-site 只见自身会话(无 global/跨项目泄漏)", A2, t_site))

# ---- Test D: REQ-071 冷启动草稿 ----
DRAFT = "REQ071冷启动草稿验证-do-not-send-8xq"
seed(PLAN); kill(); launch(); time.sleep(6)
ws=cdp()
# 定位 composer contenteditable,聚焦并键入
type_js = """
(() => {
  const el = document.querySelector('[data-component="prompt-input"][contenteditable="true"]')
         || document.querySelector('[contenteditable="true"]');
  if (!el) return 'NO_EDITOR';
  el.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, %r);
  el.dispatchEvent(new InputEvent('input', {bubbles:true}));
  return (el.innerText||'').trim();
})()
""" % DRAFT
typed = ev(ws, type_js)
time.sleep(3)  # 等 persist 落盘
ws.close()
# 完全退出 + 重开
kill(); launch(); time.sleep(6)
ws=cdp()
read_js = """
(() => { const el=document.querySelector('[data-component="prompt-input"][contenteditable="true"]')
      || document.querySelector('[contenteditable="true"]');
  return el ? (el.innerText||'').trim() : 'NO_EDITOR'; })()
"""
after = ev(ws, read_js); ws.close()
D = isinstance(after,str) and DRAFT in after
results.append(("D REQ-071 冷启动草稿不丢(键入→真退→重开→仍在)", D, {"typed":typed,"after_restart":after}))

kill()
print("\n================ 自动验证结果 ================")
allok=True
for name, ok, detail in results:
    allok = allok and ok
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    print(f"       侧栏/内容 = {detail if not isinstance(detail,list) else detail}")
print("\n总判定:", "全部通过 ✅" if allok else "有失败 ❌")
raise SystemExit(0 if allok else 1)
