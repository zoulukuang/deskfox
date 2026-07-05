#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REQ-072 git relocate 最小隔离测试(排查 flaky)。单 git 项目,hermetic。"""
import json, os, sys, time, subprocess, urllib.request, websocket

UD = os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local")
GD = os.path.join(UD, "opencode.global.dat")
APP = "/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"
GIT = "/Users/openclaw/mgit"
GIT_R = "/Users/openclaw/mgit-renamed"

def sh(*a): return subprocess.run(a, capture_output=True, text=True)
def rd(): d=json.load(open(GD)); return d, json.loads(d["server"])
def seed(projs, last):
    d,s = rd(); s["projects"]["local"]=projs; s["lastProject"]["local"]=last
    d["server"]=json.dumps(s,ensure_ascii=False); json.dump(d,open(GD,"w"),ensure_ascii=False,indent="\t")
def projs():
    _,s=rd(); return s["projects"]["local"], s["lastProject"].get("local")
def anchor(d):
    try: return open(os.path.join(d,".deskfox","id")).read().strip()
    except: return None
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
        if m.get("id")==1:
            ws.close(); r=m.get("result",{})
            return {"__err__":str(r.get("exceptionDetails"))[:150]} if "exceptionDetails" in r else r.get("result",{}).get("value")
def click(b64path):
    import base64; b=base64.b64encode(b64path.encode()).decode()
    return ev(f"(()=>{{const e=document.querySelector('[data-action=\"project-switch\"][data-project=\"{b}\"]');if(!e)return'no';e.click();return'ok';}})()")
def snap():
    return json.loads(ev("""JSON.stringify({open:(document.querySelector('[data-action="project-switch"]')||{}).getAttribute?.('aria-label')||'?',composer:document.querySelectorAll('[data-component="prompt-input"]').length,home:document.body.innerText.includes('打开文件夹')})"""))

def run_once(i, is_git=True):
    sh("bash","-c",f"rm -rf {GIT} {GIT_R}")
    if is_git:
        sh("bash","-c",f"mkdir -p {GIT} && cd {GIT} && git init -q && git -c user.email=t@e.com -c user.name=t commit -q --allow-empty -m init")
    else:
        sh("bash","-c",f"mkdir -p {GIT} && echo hi > {GIT}/readme.md")
    kill(); seed([{"worktree":GIT,"expanded":True}], GIT); launch()
    click(GIT); time.sleep(3); kill()
    p,_ = projs(); pid = next((x.get("id") for x in p if x["worktree"]==GIT), None)
    # 改名
    sh("mv", GIT, GIT_R)
    a = anchor(GIT_R)
    print(f"[run{i}] 持久化id={pid[:12] if pid else None}  renamed锚id={a[:12] if a else None}  match={pid==a}")
    # lastProject=stale 旧路径,cold-start
    kill(); seed([{"worktree":GIT,"expanded":True,"id":pid}], GIT); launch(); time.sleep(3)
    s = snap()
    p2,last2 = projs()
    ok = ("mgit-renamed" in s["open"]) and s["composer"]>=1 and not s["home"]
    print(f"[run{i}] autoselect→ open={s['open']} composer={s['composer']} home={s['home']} last={last2} => {'PASS' if ok else 'FAIL'}")
    kill()
    return ok

if __name__=="__main__":
    mode = sys.argv[1] if len(sys.argv)>1 else "git"
    n = int(sys.argv[2]) if len(sys.argv)>2 else 3
    is_git = mode != "nongit"
    print(f"== {'GIT' if is_git else 'NON-GIT'} relocate 隔离测试 x{n} ==")
    results = [run_once(i+1, is_git) for i in range(n)]
    print(f"\n{sum(results)}/{len(results)} PASS")
    sys.exit(0 if all(results) else 1)
