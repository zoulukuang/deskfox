#!/usr/bin/env python3
"""Minimal CDP Runtime.evaluate helper for DeskFox local/dev build QA.

Drives a running Electron build via --remote-debugging-port=9222: reads an
expression from stdin, runs it in the page via Runtime.evaluate, prints the
JSON result. Generic (not tied to any version); FORK-only test tool.

Usage:  echo 'document.title' | python3 cdp_eval.py
"""
import json, os, sys, websocket

# 端口可配:Win 上 9222 常被别的 Chrome 实例先占住 —— 不加这个会把表达式
# 执行到别人的页面上(轻则读到 null,重则在用户浏览器里跑脚本)。
CDP_HOST = os.environ.get("DESKFOX_CDP", "127.0.0.1:9222")

def get_ws():
    import urllib.request
    targets = json.load(urllib.request.urlopen("http://%s/json" % CDP_HOST))
    for t in targets:
        if t.get("type") == "page":
            return t["webSocketDebuggerUrl"]
    raise SystemExit("no page target")

def ev(expr):
    ws = websocket.create_connection(get_ws(), timeout=15, suppress_origin=True)
    ws.send(json.dumps({
        "id": 1, "method": "Runtime.evaluate",
        "params": {"expression": expr, "returnByValue": True, "awaitPromise": True},
    }))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            ws.close()
            r = msg.get("result", {})
            if "exceptionDetails" in r:
                return {"__error__": r["exceptionDetails"].get("exception", {}).get("description", str(r["exceptionDetails"]))}
            return r.get("result", {}).get("value")

if __name__ == "__main__":
    expr = sys.stdin.read()
    print(json.dumps(ev(expr), ensure_ascii=False, indent=2))
