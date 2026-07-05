#!/usr/bin/env python3
"""REQ-071 草稿切项目再水合 CDP 自动化测试(FORK-only QA 工具)。

场景(对齐 2026-07-04 复现路径):
  1. 打开项目 A(/Users/openclaw/req071-A)
  2. 在 composer 键入未发送草稿(真打字,走编辑器 input→persist)
  3. 切到项目 B → 切回 A
  4. 断言:A 的 composer 里草稿仍在(修复前=空=BUG,修复后=草稿在=PASS)

前置:DeskFox 本地版.app 已带 --remote-debugging-port=9222 启动,userData 里
已注册 req071-A / req071-B 两个项目(global.dat server 状态)。
用法:python3 req071_draft_test.py
"""
import json, sys, time, urllib.request, websocket

A_B64 = "L1VzZXJzL29wZW5jbGF3L3JlcTA3MS1B"  # /Users/openclaw/req071-A
B_B64 = "L1VzZXJzL29wZW5jbGF3L3JlcTA3MS1C"  # /Users/openclaw/req071-B
MARKER = "草稿测试REQ071-draft-marker-XYZ"


class CDP:
    def __init__(self):
        targets = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json"))
        page = next(t for t in targets if t.get("type") == "page")
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20, suppress_origin=True)
        self._id = 0

    def send(self, method, params=None):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def ev(self, expr):
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        res = r.get("result", {})
        if "exceptionDetails" in r:
            raise RuntimeError("JS exception: " + json.dumps(r["exceptionDetails"], ensure_ascii=False)[:300])
        return res.get("value")

    def insert_text(self, text):
        self.send("Input.insertText", {"text": text})


def wait_for(cdp, expr, want, timeout=15, desc=""):
    """poll until ev(expr) == want."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = cdp.ev(expr)
        if last == want:
            return True
        time.sleep(0.4)
    raise TimeoutError(f"wait_for {desc!r}: got {last!r}, want {want!r}")


def open_project(cdp, b64, name):
    """点第一个匹配的 project-switch 按钮切项目,等 composer 挂载。"""
    clicked = cdp.ev(f"""(() => {{
      const el = document.querySelector('[data-action="project-switch"][data-project="{b64}"]');
      if (!el) return 'no-el';
      el.click();
      return 'clicked';
    }})()""")
    if clicked != "clicked":
        raise RuntimeError(f"open_project {name}: {clicked}")
    # 等 composer 重新挂载(keyed 子树重建)
    wait_for(cdp, 'document.querySelectorAll(\'[data-component="prompt-input"]\').length >= 1', True,
             desc=f"composer mounted for {name}")
    time.sleep(0.8)  # 给再水合链一点时间


def composer_text(cdp):
    return cdp.ev("""(() => {
      const el = document.querySelector('[data-component="prompt-input"]');
      return el ? el.innerText : '<no-composer>';
    })()""")


def focus_and_type(cdp, text):
    # 聚焦 composer 并把光标放进去
    cdp.ev("""(() => {
      const el = document.querySelector('[data-component="prompt-input"]');
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    })()""")
    time.sleep(0.2)
    cdp.insert_text(text)
    time.sleep(0.5)


def main():
    cdp = CDP()
    cdp.send("Runtime.enable")
    print("== REQ-071 草稿再水合自动化测试 ==")

    # 1. 打开 A
    open_project(cdp, A_B64, "req071-A")
    before = composer_text(cdp)
    print(f"[1] 打开 A,composer 初值: {before!r}")

    # 2. 键入草稿
    focus_and_type(cdp, MARKER)
    typed = composer_text(cdp)
    print(f"[2] 键入草稿后 composer: {typed!r}")
    if MARKER not in (typed or ""):
        print(f"❌ 前置失败:草稿没打进 composer(得到 {typed!r})")
        sys.exit(2)

    # 3. 切到 B 再切回 A
    open_project(cdp, B_B64, "req071-B")
    print(f"[3a] 切到 B,composer: {composer_text(cdp)!r}")
    open_project(cdp, A_B64, "req071-A")
    # 给再水合额外时间(异步读盘 + reconcile)
    time.sleep(1.5)
    after = composer_text(cdp)
    print(f"[3b] 切回 A,composer: {after!r}")

    # 4. 断言
    if MARKER in (after or ""):
        print(f"✅ PASS:切回 A 后草稿仍在 → REQ-071 修复生效")
        sys.exit(0)
    else:
        print(f"❌ FAIL:切回 A 后草稿丢失(得到 {after!r}) → BUG 仍在")
        sys.exit(1)


if __name__ == "__main__":
    main()
