#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REQ-070 物理盘 QA(app 级,local 版):外置盘卸载模拟拔盘。
  2a: 卸载盘→冷启动→断言 lastProject 不被清 + projects.local 保留 + unreachable toast + log errno。
  2b: 全程后 git 项目 DB worktree 不被误重绑;重挂→冷启动→恢复正常。
盘卸载用 diskutil unmount force(= 模拟拔盘),结束 diskutil mount 恢复。"""
import json, os, time, subprocess, urllib.request, websocket, sqlite3

UD = os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local")
GD = os.path.join(UD, "opencode.global.dat")
APP = "/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
DB = os.path.expanduser("~/.local/share/opencode/opencode-local.db")
LOG = os.path.expanduser("~/.local/share/opencode/log/opencode.log")
VOL = "/Volumes/WININSTALL"
NONGIT = "/Volumes/WININSTALL/养老"
GIT = "/Volumes/WININSTALL/程序代码/MyProgram/UvxyOptionPrice"
GIT_ID = "96178197511accc650dacecdda09a2b42382d406"

def sh(*a): return subprocess.run(a, capture_output=True, text=True)
def mounted(): return os.path.isdir(VOL)
def unmount():
    r=sh("diskutil","unmount","force",VOL); print("  unmount:",r.stdout.strip()[:80] or r.stderr.strip()[:80]); time.sleep(1)
def mount():
    r=sh("diskutil","mount","/dev/disk4s1")
    if r.returncode!=0: r=sh("diskutil","mount",VOL)
    print("  mount:",r.stdout.strip()[:80] or r.stderr.strip()[:80]); time.sleep(1)
def kill(): sh("pkill","-f","DeskFox 本地版.app/Contents/"); time.sleep(2)
def launch(debug=True):
    args=["open","-n",APP]+(["--args","--remote-debugging-port=9222"] if debug else [])
    subprocess.Popen(args)
    if debug:
        for _ in range(40):
            try: urllib.request.urlopen("http://127.0.0.1:9222/json/version",timeout=1); return
            except: time.sleep(1)
def cdp():
    t=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")); p=next(x for x in t if x.get("type")=="page")
    return websocket.create_connection(p["webSocketDebuggerUrl"],timeout=25,suppress_origin=True)
def ev(ws,expr):
    ws.send(json.dumps({"id":1,"method":"Runtime.evaluate","params":{"expression":expr,"returnByValue":True,"awaitPromise":True}}))
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==1: return m.get("result",{}).get("result",{}).get("value")
def gd_state():
    d=json.load(open(GD)); s=json.loads(d["server"])
    return [p.get("worktree") for p in s.get("projects",{}).get("local",[])], s.get("lastProject",{}).get("local")
def git_worktree():
    c=sqlite3.connect(DB); r=c.execute("SELECT worktree FROM project WHERE id=?", (GIT_ID,)).fetchone(); c.close()
    return r[0] if r else None

def seed():
    d=json.load(open(GD)); s=json.loads(d["server"])
    s["projects"]["local"]=[
        {"worktree":NONGIT,"expanded":False,"id":"fld_946fa06c993ddc886eaf59d7dc8f3c84"},
        {"worktree":GIT,"expanded":False,"id":GIT_ID},
    ]
    s["lastProject"]["local"]=NONGIT
    d["server"]=json.dumps(s,ensure_ascii=False); json.dump(d,open(GD,"w"),ensure_ascii=False,indent="\t")

results={}
if not mounted(): mount()
seed()
wt_before=git_worktree()
print("基线 git worktree:", wt_before)
log_sz=os.path.getsize(LOG) if os.path.exists(LOG) else 0

print("\n=== 2a: 卸载盘 → 冷启动 ===")
kill(); unmount()
print("  盘在否:", "在" if mounted() else "已卸载")
launch(debug=True); time.sleep(7)
ws=cdp()
# unreachable toast 检测(文案「暂不可达」)
toast=ev(ws,r"""(()=>{const b=document.body?document.body.innerText:'';return /暂不可达|unavailable|未连接|重试/.test(b)?'FOUND':'';})()""")
ws.close()
projs, last = gd_state()
log_tail = ""
if os.path.exists(LOG):
    with open(LOG,errors="ignore") as f: f.seek(log_sz); log_tail=f.read()
errno_seen = any(k in log_tail for k in ["ENOENT","unreachable","ETIMEDOUT","EACCES"])

results["2a-lastProject 不被清(仍=养老)"] = (last==NONGIT)
results["2a-projects.local 保留两个外置项目"] = (NONGIT in projs and GIT in projs)
results["2a-unreachable 引导 toast 出现"] = (toast=="FOUND")
results["2a-sidecar log 记 errno"] = errno_seen
print("  lastProject=",last," | projects=",projs)
print("  toast=",toast," | errno_seen=",errno_seen," | log_tail(前120)=",log_tail[:120].replace("\n"," "))

print("\n=== 2b: git worktree 不被误重绑 ===")
wt_after_offline=git_worktree()
results["2b-git worktree 离线后不被误重绑"] = (wt_after_offline==wt_before)
print("  worktree 离线后:", wt_after_offline)

print("\n=== 重挂盘 → 冷启动恢复 ===")
kill(); mount()
print("  盘在否:", "在" if mounted() else "仍未挂")
launch(debug=True); time.sleep(7)
ws=cdp()
# 恢复:切到养老应能打开(无 unreachable),侧栏无红错
back=ev(ws,r"""(()=>{const b=document.body?document.body.innerText:'';return /暂不可达/.test(b)?'STILL_OFFLINE':'OK';})()""")
ws.close()
wt_back=git_worktree()
results["恢复-重挂后不再 unreachable"] = (back=="OK")
results["恢复-git worktree 重挂后仍原值"] = (wt_back==wt_before)
print("  重挂后状态=",back," | worktree=",wt_back)

kill()
print("\n================ REQ-070 QA 结果 ================")
allok=True
for k,v in results.items():
    allok=allok and v
    print(f"  [{'PASS' if v else 'FAIL'}] {k}")
print("\n总判定:", "全部通过 ✅" if allok else "有失败 ❌")
print("盘状态:", "已重挂 ✅" if mounted() else "⚠️ 未挂,请手动 diskutil mount")
raise SystemExit(0 if allok else 1)
