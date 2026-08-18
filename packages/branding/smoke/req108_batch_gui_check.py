#!/usr/bin/env python3
# [fork-only] 会话呈现与输入修复批(REQ-108/109/110/111/112/113/115/116)GUI 验证
# [feat: session-presentation-input-batch] 2026-08-18
#
# 为什么要这一层:本批八条改的全是「用起来是不是原来那样」,而这正是上游同步验收漏掉的维度 ——
# 单测 / typecheck / Playwright(跑在 vite dev server 上、mock 后端)都不等于「真桌面装出来的包里
# 这些东西还在」。本脚本连真跑的 Electron(CDP 9222),在**真实打包产物**里逐条断言:
#   S1 进度条的四条 CSS 规则真进了产物;设置面板「显示会话进度条」开关真渲染出来且默认开
#   S3 「折叠 Shell 命令」开关在、默认开
#   S9 KaTeX 样式与字体真进了产物(公式能出图的前提)
#   全程抓渲染崩溃(error.tsx)与 console.error
#
# 用法:先让 local 版带 --remote-debugging-port=9222 跑起来,然后
#   python3 packages/branding/smoke/req108_batch_gui_check.py
import json
import sys
import time
import urllib.request

import websocket  # pip install websocket-client

CDP = "127.0.0.1:9222"


def page_ws():
    targets = json.load(urllib.request.urlopen("http://%s/json" % CDP, timeout=10))
    pages = [t for t in targets if t.get("type") == "page"]
    if not pages:
        raise SystemExit("no page target — 应用起来了吗?是否带了 --remote-debugging-port=9222")
    return pages[0]["webSocketDebuggerUrl"]


class Session:
    def __init__(self):
        self.ws = websocket.create_connection(page_ws(), timeout=30, suppress_origin=True)
        self._id = 0
        self.errors = []

    def call(self, method, params=None):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown":
                self.errors.append(
                    msg["params"]["exceptionDetails"].get("exception", {}).get("description", "?")
                )
                continue
            if msg.get("method") == "Runtime.consoleAPICalled":
                if msg["params"].get("type") == "error":
                    self.errors.append(
                        " ".join(str(a.get("value", a.get("description", ""))) for a in msg["params"].get("args", []))
                    )
                continue
            if msg.get("id") == mid:
                return msg.get("result", {})

    def ev(self, expr):
        r = self.call(
            "Runtime.evaluate",
            {"expression": expr, "returnByValue": True, "awaitPromise": True},
        )
        if "exceptionDetails" in r:
            desc = r["exceptionDetails"].get("exception", {}).get("description")
            return {"__error__": desc or json.dumps(r["exceptionDetails"])}
        return r.get("result", {}).get("value")

    def click(self, x, y):
        for kind in ("mousePressed", "mouseReleased"):
            self.call(
                "Input.dispatchMouseEvent",
                {"type": kind, "x": x, "y": y, "button": "left", "clickCount": 1},
            )
        time.sleep(0.4)

    def esc(self):
        for kind in ("keyDown", "keyUp"):
            self.call("Input.dispatchKeyEvent", {"type": kind, "key": "Escape", "windowsVirtualKeyCode": 27})
        time.sleep(0.2)


RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append({"name": name, "ok": bool(ok), "detail": str(detail)[:400]})
    print(("  PASS  " if ok else "  FAIL  ") + name + (("  — " + str(detail)[:220]) if detail else ""))


FIND_BUTTON_JS = r"""(()=>{const b=[...document.querySelectorAll('button,[role="button"]')]
  .find(b=>/设置|Settings/.test(b.getAttribute('aria-label')||''));
  if(!b)return null;const r=b.getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()"""

# 设置行:按标题文案找到那一行,读它的 Switch 勾选态(Kobalte 用 data-checked / aria-checked)
ROW_STATE_JS = r"""(()=>{
  const title = %s;
  const nodes = [...document.querySelectorAll('div,section,li')];
  const row = nodes.find(n => {
    const t = (n.textContent||'');
    return t.includes(title) && n.querySelector('[role="switch"],input[type="checkbox"]')
      && n.getElementsByTagName('*').length < 40;
  });
  if (!row) return {found:false};
  const sw = row.querySelector('[role="switch"],input[type="checkbox"]');
  const checked = sw.getAttribute('aria-checked') === 'true'
    || sw.hasAttribute('data-checked')
    || sw.checked === true;
  const r = row.getBoundingClientRect();
  return {found:true, checked, visible: r.width>0 && r.height>0};
})()"""


def open_settings(s):
    if s.ev(r"""(()=>document.body.innerText.includes('提供商')||document.body.innerText.includes('Providers'))()"""):
        return True
    for _ in range(4):
        g = s.ev(FIND_BUTTON_JS)
        if isinstance(g, dict) and g.get("x") is not None:
            s.click(g["x"], g["y"])
            time.sleep(1.2)
            body = s.ev("document.body.innerText") or ""
            if "提供商" in body or "Providers" in body or "通用" in body:
                return True
        time.sleep(0.8)
    return False


def main():
    s = Session()
    s.call("Runtime.enable")
    print("connected: %s" % s.ev("document.title"))
    time.sleep(2)

    # ── S1 进度条 CSS:四块规则是否真进了打包产物 ──────────────────────
    css = s.ev(
        """
        (() => {
          let keyframes = false, comp = false, hiding = false, bar = false, katex = false
          for (const sheet of document.styleSheets) {
            let rules
            try { rules = sheet.cssRules } catch { continue }
            if (!rules) continue
            for (const rule of rules) {
              const t = rule.cssText || ""
              if (t.includes("session-progress-whip")) keyframes = true
              if (t.includes('[data-component="session-progress"]')) comp = true
              if (t.includes('data-state="hiding"')) hiding = true
              if (t.includes('[data-component="session-progress-bar"]')) bar = true
              if (t.includes(".katex")) katex = true
            }
          }
          return { keyframes, comp, hiding, bar, katex }
        })()
        """
    )
    css = css if isinstance(css, dict) else {}
    check("S1 进度条 @keyframes 在打包产物里", css.get("keyframes"), css)
    check("S1 进度条容器规则在", css.get("comp"), "")
    check("S1 淡出态(hiding)规则在 —— 硬消失和淡出是两种手感", css.get("hiding"), "")
    check("S1 进度条 bar 规则在", css.get("bar"), "")
    check("S9 KaTeX 样式在产物里(公式出图前提)", css.get("katex"), "")

    # ── 设置面板:两个新开关真的渲染出来且默认开 ──────────────────────
    if not open_settings(s):
        check("打开设置面板", False, "点不开设置")
    else:
        check("打开设置面板", True)
        for title, label in (
            ("显示会话进度条", "S1 设置开关「显示会话进度条」"),
            ("折叠 Shell 命令", "S3 设置开关「折叠 Shell 命令」"),
        ):
            st = s.ev(ROW_STATE_JS % json.dumps(title))
            st = st if isinstance(st, dict) else {}
            check("%s 已渲染" % label, st.get("found") and st.get("visible"), st)
            check("%s 默认开" % label, st.get("checked"), st)
        s.esc()

    # ── 渲染崩溃 / 控制台错误 ────────────────────────────────────────
    crashed = s.ev(
        """
        (() => {
          const body = document.body.innerText || ""
          const errPage = [...document.querySelectorAll('button')].some(b=>/重启|Restart/.test(b.textContent||''))
            && body.length < 400
          return { errPage, len: body.length }
        })()
        """
    )
    crashed = crashed if isinstance(crashed, dict) else {}
    check("无全屏渲染崩溃页", not crashed.get("errPage"), crashed)
    check("无未捕获异常 / console.error", len(s.errors) == 0, s.errors[:3])

    print("")
    passed = sum(1 for r in RESULTS if r["ok"])
    print("=== %d/%d passed ===" % (passed, len(RESULTS)))
    with open("/tmp/req108-batch-gui-report.json", "w") as f:
        json.dump({"results": RESULTS, "errors": s.errors}, f, ensure_ascii=False, indent=2)
    print("report: /tmp/req108-batch-gui-report.json")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
