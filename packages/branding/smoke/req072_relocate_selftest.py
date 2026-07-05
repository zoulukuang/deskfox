#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REQ-072 改名 relocate 自我测试(真机 CDP)。

验证:
  A. flag 开 → 非 git 项目拿到稳定 id(非 global),打开后 StoredProject.id 已持久化。
  B. git 项目改名后 → autoselect/openProject 锚扫描 relocate → 项目打开(不再"打不开")。
  C. 非 git 项目改名后 → 同样 relocate 打开。
  D. relocate 后旧 stale 条目已就地改成新路径(无残留 → 无反复 503)。

流程:seed 项目(无id) → 开(id 持久化) → kill → 磁盘改名 → 重开(验 relocate)。
"""
import json, os, sys, time, subprocess, urllib.request, websocket

USERDATA = os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local")
GLOBAL_DAT = os.path.join(USERDATA, "opencode.global.dat")
APP = "/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
# 唯一路径(每次运行不同)—— 消除同路径跨运行的陈旧 project 身份缓存污染,做真正 hermetic 验证
_U = str(int(time.time()))
GIT = f"/Users/openclaw/rtgit-{_U}"
GIT_R = f"/Users/openclaw/rtgit-{_U}-renamed"
PLAIN = f"/Users/openclaw/rtplain-{_U}"
PLAIN_R = f"/Users/openclaw/rtplain-{_U}-renamed"

def sh(*a): return subprocess.run(a, capture_output=True, text=True)

def read_server():
    d = json.load(open(GLOBAL_DAT)); return d, json.loads(d["server"])

def seed(worktrees, last):
    # 保留已持久化的 id(真实 app 改名后不会抹掉 server.projects.local 里的 id)
    d, server = read_server()
    existing = {p["worktree"]: p.get("id") for p in server["projects"]["local"] if isinstance(p, dict)}
    server["projects"]["local"] = [
        ({"worktree": w, "expanded": True, "id": existing[w]} if existing.get(w) else {"worktree": w, "expanded": True})
        for w in worktrees
    ]
    server["lastProject"]["local"] = last
    d["server"] = json.dumps(server, ensure_ascii=False)
    json.dump(d, open(GLOBAL_DAT, "w"), ensure_ascii=False, indent="\t")

def stored_projects():
    _, server = read_server()
    return server["projects"]["local"], server["lastProject"].get("local")

def kill():
    sh("pkill", "-f", "DeskFox 本地版.app/Contents/"); time.sleep(2)

def launch():
    subprocess.Popen(["open", "-n", APP, "--args", "--remote-debugging-port=9222"])
    for _ in range(40):
        try: urllib.request.urlopen("http://127.0.0.1:9222/json/version", timeout=1); break
        except Exception: time.sleep(1)
    time.sleep(4)

def ev(expr):
    targets = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json"))
    page = next(t for t in targets if t.get("type") == "page")
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20, suppress_origin=True)
    ws.send(json.dumps({"id":1,"method":"Runtime.evaluate","params":{"expression":expr,"returnByValue":True,"awaitPromise":True}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id")==1:
            ws.close(); r=m.get("result",{})
            if "exceptionDetails" in r: return {"__err__": str(r["exceptionDetails"])[:200]}
            return r.get("result",{}).get("value")

def snap():
    return ev("""JSON.stringify({
      openProject: (document.querySelector('[data-action="project-switch"]')||{}).getAttribute?.('aria-label')||'?',
      composer: document.querySelectorAll('[data-component="prompt-input"]').length,
      onHome: document.body.innerText.includes('打开文件夹'),
      toasts: [...document.querySelectorAll('[data-corvu-toast],[role="status"]')].map(e=>e.innerText.trim().slice(0,50)).filter(Boolean),
      body: document.body.innerText.slice(0,90).replace(/\\n+/g,' ')
    })""")

def click_project(worktree):
    import base64
    b64 = base64.b64encode(worktree.encode()).decode()
    return ev(f"""(()=>{{const el=document.querySelector('[data-action="project-switch"][data-project="{b64}"]');if(!el)return 'no-el';el.click();return 'clicked';}})()""")

results = []
def check(name, cond, detail=""):
    results.append((name, cond, detail)); print(f"{'✅' if cond else '❌'} {name}  {detail}")

def main():
    # hermetic:清空 global.dat 里的 projects/lastProject,杜绝跨运行残留 id 干扰(harness 隔离)
    _d, _s = read_server()
    _s["projects"]["local"] = []
    _s["lastProject"]["local"] = None
    _d["server"] = json.dumps(_s, ensure_ascii=False)
    json.dump(_d, open(GLOBAL_DAT, "w"), ensure_ascii=False, indent="\t")
    # 复位磁盘:全删重建,rtgit 建成真 git 仓库、rtplain 非 git
    sh("bash","-c", f"rm -rf {GIT} {GIT_R} {PLAIN} {PLAIN_R}")
    sh("bash","-c", f"mkdir -p {GIT} && cd {GIT} && git init -q && git -c user.email=t@e.com -c user.name=t commit -q --allow-empty -m init && echo hi > readme.md")
    sh("bash","-c", f"mkdir -p {PLAIN} && echo hi > {PLAIN}/readme.md")

    print("== STEP1: seed 两项目(无id)并逐个打开让 id 持久化 ==")
    kill(); seed([GIT, PLAIN], PLAIN); launch()
    click_project(PLAIN); time.sleep(3)
    click_project(GIT); time.sleep(3)
    click_project(PLAIN); time.sleep(2)  # 回到 PLAIN 再确保
    kill()

    projs, _ = stored_projects()
    idmap = {p["worktree"]: p.get("id") for p in projs}
    print("  持久化后 StoredProject:", idmap)
    # A 权威证据 = 锚文件内容(flag 开 → 非git 铸稳定 id 写进 .deskfox/id;非 global 即证 flag 生效)
    def anchor_id(d):
        try: return open(f"{d}/.deskfox/id").read().strip()
        except: return None
    plain_anchor = anchor_id(PLAIN)
    check("A: 非git flag 开 → 稳定身份(.deskfox/id 锚非空且非 global)", bool(plain_anchor) and plain_anchor != "global", f"anchor={plain_anchor}")
    check("A2: git 项目也写了稳定身份锚", bool(anchor_id(GIT)), f"anchor={anchor_id(GIT)}")
    check("A3: 非git 写了 .deskfox/id 锚", os.path.exists(f"{PLAIN}/.deskfox/id"))
    check("A4: git 写了 .deskfox/id 锚", os.path.exists(f"{GIT}/.deskfox/id"))

    print("== STEP2: 磁盘改名两项目,lastProject=stale git 旧路径,重开验 relocate ==")
    sh("mv", GIT, GIT_R); sh("mv", PLAIN, PLAIN_R)
    seed([GIT, PLAIN], GIT)  # 列表仍旧路径 + id 已在(上一步持久化);lastProject=stale git
    launch()
    time.sleep(3)
    s = json.loads(snap())
    print("  autoselect 后:", s)
    check("B: git 改名后 autoselect relocate → 项目打开(有composer/不在首页)", s["composer"]>=1 and not s["onHome"], f"open={s['openProject']}")
    check("B2: 打开的是改名后新路径 rtgit-renamed", os.path.basename(GIT_R) in s["openProject"] or os.path.basename(GIT_R) in s["body"])
    # 列表里旧 git 路径应已 relocate 成新路径
    projs2, last2 = stored_projects()
    wts = [p["worktree"] for p in projs2]
    check("D: stale 旧 git 路径已 relocate(列表无旧路径)", GIT not in wts, f"list={wts}")
    check("D2: lastProject 也已改成新路径", last2 == GIT_R, f"last={last2}")

    print("== STEP3: 非git cold-start lastProject=stale rtplain → autoselect relocate ==")
    kill()
    # 列表旧路径 + id 已持久化(STEP1);lastProject=stale 非git 旧路径
    seed([GIT_R, PLAIN], PLAIN)  # git 已 relocate 到 GIT_R,非git 仍旧路径 PLAIN(stale)
    launch(); time.sleep(3)
    s3 = json.loads(snap())
    print("  非git autoselect 后:", s3)
    check("C: 非git 改名后 autoselect relocate → 打开新路径 rtplain-renamed",
          (os.path.basename(PLAIN_R) in s3["openProject"]) or (os.path.basename(PLAIN_R) in s3["body"]), f"open={s3['openProject']}")
    check("C2: 非git 项目正常打开(有composer/不在首页)", s3["composer"] >= 1 and not s3["onHome"])
    projs3, _ = stored_projects()
    wts3 = [p["worktree"] for p in projs3]
    check("C3: stale 旧非git 路径已 relocate(列表无旧路径)", PLAIN not in wts3, f"list={wts3}")

    kill()
    print("\n=== 汇总 ===")
    passed = sum(1 for _,c,_ in results if c)
    print(f"{passed}/{len(results)} 通过")
    sys.exit(0 if passed==len(results) else 1)

if __name__ == "__main__":
    main()
