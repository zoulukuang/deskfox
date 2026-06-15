# [fork-only] DeskFox 冷启动健康检查(Electron,真冷 sidecar)— verify 链 L1。
#
# 源:OPENCODE-PLAN/诊断工具/cold-start-health-check.py(诊断工具家),本副本随 verify 链入主仓,
# 让 L1 闸自包含(不依赖 sibling repo 在场)。**已修** conn-refused 误报(见下「修复」段)。
#
# 为什么需要它:
#   启动时序类 bug(sidecar HTTP 已起但内部未热 → 首个 file.list 返回 500「Unexpected server error」
#   弹红 toast)只在【真冷 sidecar】启动窗口暴露;reload(暖 sidecar)永远抓不到。
#   2026-06-13 实战:这个 500 race 是 user 报的、暖态自测漏掉的。
#
# 由 verify.ts --cold 编排:先杀全部 DeskFox/electron/sidecar → 冷启 dev → 立即挂本脚本监控 ~22s
# (本脚本只监控,不负责 kill/launch)。判定经退出码回传:0=CLEAN / 1=FAIL / 2=renderer 未出现。
#
# 修复(2026-06-15,接 OPENCODE-PLAN 需求池「冷启动健康脚本-误报FAIL-connection-refused」):
#   冷启 sidecar 有 ~1.5s 预热窗口,渲染器此间 fetch 拿 ERR_CONNECTION_REFUSED 后重试连上 —— 原脚本
#   未白名单 → 误判 FAIL。修法(保留「sidecar 真没起来」的检出):conn-refused 单独计数,**仅在终态
#   已连上**(有会话/文件树节点/已渲染 shell)时算瞬时;始终没连上则算真 FAIL。
#
# 依赖:pip install websocket-client(urllib 标准库)。CDP 9222(非 packaged dev 自动开)。
import json, time, sys, urllib.request, websocket
sys.stdout.reconfigure(encoding="utf-8")

CDP_HOST = "http://127.0.0.1:9222"

def http_json(path):
    return json.load(urllib.request.urlopen(CDP_HOST + path, timeout=3))

page_ws = None
for _ in range(40):
    try:
        for t in http_json("/json"):
            if t.get("type") == "page" and "renderer" in t.get("url", ""):
                page_ws = t["webSocketDebuggerUrl"]; break
    except Exception:
        pass
    if page_ws:
        break
    time.sleep(0.5)
if not page_ws:
    print("FAIL: renderer page 未出现"); raise SystemExit(2)

ws = websocket.create_connection(page_ws, suppress_origin=True, max_size=80_000_000)
i = [0]
def send(m, p=None):
    i[0] += 1; ws.send(json.dumps({"id": i[0], "method": m, "params": p or {}}))
def run(m, p=None):
    send(m, p)
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == i[0]: return r
def ev(expr):
    r = run("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
    return r.get("result", {}).get("result", {}).get("value")

run("Runtime.enable"); run("Log.enable"); run("Page.enable")

console_errors = []
toasts_seen = set()
TOAST_JS = r'''JSON.stringify([...document.querySelectorAll("[data-component=toast],[data-variant=error],[role=alert],[role=status]")].map(t=>t.textContent.trim()).filter(Boolean))'''
PROJECT_CLICK = r'''(()=>{const a=document.querySelector("[data-component=workspace-rail] button, nav button");if(a){const b=a.getBoundingClientRect();return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)});}return JSON.stringify({err:1});})()'''
# 终态健康:app 最终是否连上(有会话 / 文件树节点 / 已渲染 shell)。决定 conn-refused 算瞬时还是真 FAIL。
CONNECTED_JS = r'''(document.querySelectorAll('[data-session-id]').length>0 || document.querySelectorAll('[data-component=file-tree] [role=treeitem]').length>0 || document.querySelector('[data-component=workspace-rail]')!=null)'''

clicked = False
deadline = time.time() + 22
while time.time() < deadline:
    ws.settimeout(0.4)
    try:
        while True:
            msg = json.loads(ws.recv())
            m = msg.get("method")
            if m == "Runtime.consoleAPICalled" and msg["params"].get("type") in ("error", "assert"):
                txt = " ".join(str(a.get("value", a.get("description", ""))) for a in msg["params"].get("args", []))
                console_errors.append(txt[:200])
            elif m == "Log.entryAdded" and msg["params"]["entry"].get("level") == "error":
                console_errors.append(("LOG: " + msg["params"]["entry"].get("text", ""))[:200])
            elif m == "Runtime.exceptionThrown":
                d = msg["params"]["exceptionDetails"]
                console_errors.append(("EXC: " + (d.get("exception", {}).get("description", d.get("text", ""))))[:200])
    except Exception:
        pass
    ws.settimeout(None)
    try:
        for t in json.loads(ev(TOAST_JS) or "[]"):
            toasts_seen.add(t)
    except Exception:
        pass
    if not clicked and time.time() > deadline - 19:
        try:
            c = json.loads(ev(PROJECT_CLICK))
            if not c.get("err"):
                run("Input.dispatchMouseEvent", {"type":"mousePressed","x":c["x"],"y":c["y"],"button":"left","clickCount":1})
                run("Input.dispatchMouseEvent", {"type":"mouseReleased","x":c["x"],"y":c["y"],"button":"left","clickCount":1})
                clicked = True
        except Exception:
            pass
    time.sleep(0.3)

# 终态健康判定(在关 ws 前评估)
connected = False
try:
    connected = bool(ev(CONNECTED_JS))
except Exception:
    pass
ws.close()

err_toasts = [t for t in toasts_seen if "失败" in t or "error" in t.lower() or "失敗" in t or "Unexpected" in t]
def is_transient_500(e):
    return "Failed to load resource" in e and "500" in e
def is_conn_refused(e):
    return "ERR_CONNECTION_REFUSED" in e
transient_500 = [e for e in console_errors if is_transient_500(e)]
conn_refused = [e for e in console_errors if is_conn_refused(e) and not is_transient_500(e)]
fatal_console = [e for e in console_errors if not is_transient_500(e) and not is_conn_refused(e)]
# conn-refused:终态连上 = 预热竞态瞬时噪音;始终没连上 = sidecar 真没起来(FAIL,别为消误报牺牲真检出)
conn_refused_fatal = [] if connected else conn_refused

print("=== STARTUP HEALTH ===")
print("clicked project:", clicked)
print("终态已连上:", connected)
print("用户可见 error toast:", json.dumps(err_toasts, ensure_ascii=False))
print("JS 异常 / 致命 console:", json.dumps(fatal_console[:8], ensure_ascii=False))
print("瞬时 resource 500(已被重试吞掉,后台噪音):", len(transient_500))
print("connection-refused(%s):" % ("终态已连上=瞬时" if connected else "终态未连上=FAIL"), len(conn_refused))
user_facing_fail = bool(err_toasts or fatal_console or conn_refused_fatal)
print("RESULT:", "FAIL (用户可见问题)" if user_facing_fail else "CLEAN (无用户可见错误)")
raise SystemExit(1 if user_facing_fail else 0)
