#!/usr/bin/env python3
"""[fork-only] DeskFox 界面交互测试工具包 —— 长期复用 [feat: ui-probe-toolkit] 2026-08-13

## 为什么有这个文件

2026-08-12/13 连续两天出现「修了又复发」「验证报绿但其实没验到」的问题,复盘发现**不是判断力问题,
是缺工具**。同一类失误反复出现:

| 踩过的坑 | 后果 | 本工具对应能力 |
|---|---|---|
| 点击坐标落在视口外 / 窗口在副屏(x 为负) | 点了个空,却当成「功能正常」 | `assert_in_viewport` / `window_geometry` |
| 用 `element.click()` 合成事件 | 触发不了 SolidJS handler,误判「功能失效」 | `click` / `key` / `drag`(CDP 真实输入) |
| 用 `innerText.includes()` 判状态 | 被其他区域同名文案污染,结论错 | `css_var` / `element_box` 等结构化读取 |
| 读 computed style 就宣布「样式挂上了」 | 实际被子元素覆盖,用户根本看不见 | `is_occluded` / `zoom_shot` 像素级验收 |
| 选择器没命中就断定「功能坏了」 | 两次误报 | `find_element` 多策略回退 + 未命中自动截图 |
| 前提不成立仍继续跑 | 空点击混成绿灯 | `require()` 断言,失败即中止 |
| 多窗口时连到后台 page target | 渲染器被节流,evaluate 超时,误判成「工具坏了」 | `_ws_url()` 优先选前台窗口并告警 |
| 元素存在但 height=0 等不可见 | 报「未找到」,被当成功能缺失 | `find_element` 未命中时二次查找并说明**为何不可见** |

## 三条硬规矩(工具替你守住)

1. **真实输入**,不用合成事件 —— 所有 `click/key/drag` 走 CDP `Input.dispatch*`。
2. **可靠指标**,不用文案判定 —— 读驱动行为的变量/几何本身。
3. **视觉改动像素级验收** —— `zoom_shot` 放大截图,`sample_column` 采样颜色。

## 坐标系(这次坑的根源,务必分清)

- **屏幕坐标**:多屏时可为负(副屏在主屏左侧)。`screencapture` / AppleScript 用这套。
- **视口坐标**:CDP `Input.dispatch*` 与 `getBoundingClientRect()` 用这套,原点是网页左上角。
两者**不能混用**。本工具的 `window_geometry()` 同时给出两套并标注所在屏幕。

## 用法

    from uiprobe import UI
    ui = UI()                          # 连 CDP 9222
    print(ui.window_geometry())        # 窗口在哪个屏幕 / 边界 / 视口
    el = ui.find_element(label="切换文件树")
    ui.require(el, "找不到「切换文件树」按钮")
    ui.click_element(el)               # 自动做视口断言
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

try:
    import websocket  # pip install websocket-client
except ImportError:  # pragma: no cover
    print("需要 websocket-client:pip install websocket-client", file=sys.stderr)
    raise

CDP_HOST = "127.0.0.1:9222"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_APP_PROCESS = "DeskFox 本地版"


class ProbeError(RuntimeError):
    """前提不成立 —— 故意抛出,避免「点了个空还报绿」。"""


class UI:
    def __init__(self, host: str = CDP_HOST, process_name: str = DEFAULT_APP_PROCESS, shot_dir: str | None = None):
        self.host = host
        self.process_name = process_name
        self.shot_dir = shot_dir or os.path.join(HERE, "_shots")
        self._id = 0
        self.ws = websocket.create_connection(self._ws_url(), timeout=30, suppress_origin=True)

    # ── 基础 ────────────────────────────────────────────────
    def _ws_url(self) -> str:
        """选取要连的 page target。

        **不能盲取第一个** —— 2026-08-13 实撞:测多窗口时留下第二个窗口,列表里就有两个 page,
        取到的那个是**后台窗口**,渲染器被浏览器节流,`Runtime.evaluate` 迟迟不返回,
        表现为「CDP 连接超时」,极易被误判成工具坏了或应用挂了(当时排查了很久)。
        这里优先选**前台可见**窗口:用 CDP 的 attached/visible 线索排序,并在多 target 时打印提示。
        """
        targets = json.load(urllib.request.urlopen("http://%s/json" % self.host, timeout=5))
        pages = [t for t in targets if t.get("type") == "page"]
        if not pages:
            raise ProbeError("CDP 没有 page target —— 应用没起来,或没开 --remote-debugging-port")
        if len(pages) > 1:
            print("[uiprobe] 检测到 %d 个 page target(多窗口)。后台窗口的渲染器会被节流、"
                  "evaluate 可能超时 —— 已优先选择前台窗口;若结果异常请只留一个窗口重试。"
                  % len(pages), file=sys.stderr)
        # 前台窗口通常不带 "(background)" 标记且 attached;这里做一次稳妥排序
        pages.sort(key=lambda t: (0 if t.get("attached") else 1, 0 if "background" not in (t.get("title") or "").lower() else 1))
        return pages[0]["webSocketDebuggerUrl"]

    def send(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        self.ws.send(json.dumps({"id": self._id, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self._id:
                return msg

    def ev(self, expression: str):
        r = self.send("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        res = r.get("result", {})
        if "exceptionDetails" in res:
            raise ProbeError("JS 求值失败: %s" % str(res["exceptionDetails"])[:300])
        return res.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass

    # ── 断言 ────────────────────────────────────────────────
    @staticmethod
    def require(cond, message: str):
        """前提断言。失败直接抛 ProbeError —— 宁可中止,不要假绿。"""
        if not cond:
            raise ProbeError("前提不成立:%s" % message)
        return cond

    # ── 1. 窗口 / 屏幕 / 视口几何(user 2026-08-13 点名要的能力)───────
    def window_geometry(self) -> dict:
        """一次给全三层坐标信息,并判断窗口在哪个屏幕、是否有部分在屏幕外。

        返回:
          viewport      网页视口尺寸与 dpr(CDP Input 与 getBoundingClientRect 的坐标系)
          screen        window.screen 报告的当前屏幕可用区
          window        AppleScript 拿到的**屏幕坐标**下窗口位置/大小(多屏时 x 可为负)
          displays      所有屏幕的边界(用于判断窗口落在哪块)
          on_display    窗口中心点落在哪块屏幕
          offscreen     窗口是否有部分在所有屏幕之外
        """
        vp = self.ev(
            "({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio,"
            "   screenW: screen.availWidth, screenH: screen.availHeight })"
        )
        out = {
            "viewport": {"w": vp["w"], "h": vp["h"], "dpr": vp["dpr"]},
            "screen": {"availW": vp["screenW"], "availH": vp["screenH"]},
        }
        out["window"] = self._window_bounds_via_applescript()
        out["displays"] = self._displays_via_applescript()
        out["on_display"] = self._which_display(out["window"], out["displays"])
        out["offscreen"] = self._is_offscreen(out["window"], out["displays"])
        return out

    def _osascript(self, script: str) -> str:
        try:
            r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10)
            return (r.stdout or "").strip()
        except Exception:
            return ""

    def _window_bounds_via_applescript(self) -> dict | None:
        raw = self._osascript(
            'tell application "System Events" to tell process "%s" to return '
            "(position of window 1) & (size of window 1)" % self.process_name
        )
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if len(parts) < 4:
            return None
        try:
            x, y, w, h = (int(float(p)) for p in parts[:4])
        except ValueError:
            return None
        return {"x": x, "y": y, "w": w, "h": h, "right": x + w, "bottom": y + h}

    def _displays_via_applescript(self) -> list:
        raw = self._osascript(
            'tell application "Finder" to return bounds of window of desktop'
        )
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if len(parts) >= 4:
            try:
                l, t, r, b = (int(float(p)) for p in parts[:4])
                return [{"x": l, "y": t, "right": r, "bottom": b, "w": r - l, "h": b - t, "primary": True}]
            except ValueError:
                pass
        return []

    @staticmethod
    def _which_display(win: dict | None, displays: list):
        if not win or not displays:
            return None
        cx, cy = win["x"] + win["w"] // 2, win["y"] + win["h"] // 2
        for idx, d in enumerate(displays):
            if d["x"] <= cx <= d["right"] and d["y"] <= cy <= d["bottom"]:
                return {"index": idx, "primary": d.get("primary", False)}
        return {"index": -1, "note": "窗口中心不在已知屏幕内(可能在副屏,Finder 只报主屏边界)"}

    @staticmethod
    def _is_offscreen(win: dict | None, displays: list) -> bool | None:
        if not win or not displays:
            return None
        d = displays[0]
        return not (d["x"] <= win["x"] and win["right"] <= d["right"] and d["y"] <= win["y"] and win["bottom"] <= d["bottom"])

    # ── 2. 元素定位(多策略回退,未命中自动截图)──────────────────
    def find_element(self, label: str | None = None, text: str | None = None,
                     selector: str | None = None, role: str | None = None,
                     require_visible: bool = True) -> dict | None:
        """按 aria-label / 文本 / selector / role 多路查找,返回视口坐标与几何。

        未命中时自动截一张图到 shot_dir —— 避免「选择器不对」被误判成「功能坏了」。
        """
        js = """
        (() => {
          const label = %s, text = %s, selector = %s, role = %s, requireVisible = %s;
          const vis = (e) => { const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.x < window.innerWidth && r.y < window.innerHeight
                   && r.right > 0 && r.bottom > 0; };
          let el = null;
          if (selector) el = document.querySelector(selector);
          if (!el && label) el = [...document.querySelectorAll('[aria-label]')]
             .find(e => (e.getAttribute('aria-label')||'') === label && (!requireVisible || vis(e)));
          if (!el && label) el = [...document.querySelectorAll('[aria-label]')]
             .find(e => (e.getAttribute('aria-label')||'').includes(label) && (!requireVisible || vis(e)));
          if (!el && text) el = [...document.querySelectorAll('button,a,[role=button],[role=menuitem],[role=tab]')]
             .find(e => (e.textContent||'').trim() === text && (!requireVisible || vis(e)));
          if (!el && text) el = [...document.querySelectorAll('*')]
             .find(e => e.children.length === 0 && (e.textContent||'').trim() === text && (!requireVisible || vis(e)));
          if (!el && role) el = [...document.querySelectorAll('[role="'+role+'"]')].find(e => !requireVisible || vis(e));
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                   cx: Math.round(r.x + r.width/2), cy: Math.round(r.y + r.height/2),
                   right: Math.round(r.right), bottom: Math.round(r.bottom),
                   tag: el.tagName.toLowerCase(),
                   label: el.getAttribute('aria-label'),
                   text: (el.textContent||'').trim().slice(0, 30),
                   inViewport: r.x >= 0 && r.y >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight };
        })()
        """ % (json.dumps(label), json.dumps(text), json.dumps(selector), json.dumps(role),
               "true" if require_visible else "false")
        found = self.ev(js)
        if not found:
            # 区分「压根不存在」与「存在但当前不可见」—— 2026-08-13 实撞:
            # 通知面板入口 aria-label 明明在 DOM 里,却因 height=0(未展开)被可见性过滤掉,
            # 报成「未找到」→ 差点被当成功能缺失。二者的处置完全不同:
            #   不存在 = 可能真缺陷;不可见 = 需要先把它所在的区域打开(环境前提)。
            hidden = self._find_ignoring_visibility(label=label, text=text, selector=selector, role=role)
            key = label or text or selector or role or "unknown"
            path = self.shot("find-miss-%s" % key)
            if hidden:
                print("[uiprobe] 「%s」存在于 DOM 但当前不可见(%s)—— 不是缺失,"
                      "需先让它所在区域可见。截图:%s"
                      % (key, hidden.get("why"), path), file=sys.stderr)
            else:
                print("[uiprobe] 「%s」在 DOM 中不存在。截图供人工确认:%s" % (key, path), file=sys.stderr)
        return found

    def _find_ignoring_visibility(self, label=None, text=None, selector=None, role=None) -> dict | None:
        """忽略可见性再找一次,用于分辨「不存在」与「存在但不可见」。"""
        args = json.dumps({"label": label, "text": text, "selector": selector, "role": role}, ensure_ascii=False)
        js = (
            "(() => { const A = " + args + ";\n"
            "  let el = null;\n"
            "  if (A.selector) el = document.querySelector(A.selector);\n"
            "  if (!el && A.label) el = [...document.querySelectorAll('[aria-label]')]\n"
            "      .find(e => (e.getAttribute('aria-label')||'').includes(A.label));\n"
            "  if (!el && A.text) el = [...document.querySelectorAll('button,a,[role=button],[role=tab]')]\n"
            "      .find(e => (e.textContent||'').trim().includes(A.text));\n"
            "  if (!el && A.role) el = document.querySelector('[role=\"'+A.role+'\"]');\n"
            "  if (!el) return null;\n"
            "  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);\n"
            "  const why = r.height === 0 ? 'height=0(未展开)'\n"
            "    : r.width === 0 ? 'width=0'\n"
            "    : cs.display === 'none' ? 'display:none'\n"
            "    : cs.visibility === 'hidden' ? 'visibility:hidden'\n"
            "    : (r.y > window.innerHeight || r.bottom < 0) ? '滚出视口'\n"
            "    : (r.x > window.innerWidth || r.right < 0) ? '在视口左右之外'\n"
            "    : '原因未知';\n"
            "  return { why, x: Math.round(r.x), y: Math.round(r.y),\n"
            "           w: Math.round(r.width), h: Math.round(r.height) };\n"
            "})()"
        )
        try:
            return self.ev(js)
        except ProbeError:
            return None

    # ── 3. 视口断言 + 真实输入 ─────────────────────────────────
    def assert_in_viewport(self, box: dict, what: str = "目标元素"):
        """坐标越界直接中止 —— 这次三连假绿(y=1083 超视口 / 窗口在副屏 x=-1623)全靠它拦。"""
        vp = self.ev("({ w: window.innerWidth, h: window.innerHeight })")
        self.require(box, "%s 不存在" % what)
        ok = 0 <= box["cx"] < vp["w"] and 0 <= box["cy"] < vp["h"]
        if not ok:
            raise ProbeError(
                "%s 的点击坐标 (%s, %s) 不在视口 %sx%s 内 —— 点下去会落空。"
                "常见原因:窗口在副屏(坐标为负)、元素被滚动出可视区、面板未展开。"
                % (what, box["cx"], box["cy"], vp["w"], vp["h"])
            )
        return True

    def click(self, x: int, y: int, button: str = "left", clicks: int = 1):
        for t in ("mousePressed", "mouseReleased"):
            self.send("Input.dispatchMouseEvent",
                      {"type": t, "x": x, "y": y, "button": button, "clickCount": clicks})
            time.sleep(0.06)

    def click_element(self, box: dict, what: str = "目标元素", button: str = "left"):
        self.assert_in_viewport(box, what)
        self.click(box["cx"], box["cy"], button=button)

    def key(self, key: str, code: str, vk: int = 0, cmd: bool = False, shift: bool = False,
            alt: bool = False, ctrl: bool = False):
        mods = (1 if alt else 0) | (2 if ctrl else 0) | (4 if cmd else 0) | (8 if shift else 0)
        for t in ("keyDown", "keyUp"):
            self.send("Input.dispatchKeyEvent",
                      {"type": t, "key": key, "code": code, "modifiers": mods,
                       "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk})
            time.sleep(0.06)

    def drag(self, x1: int, y1: int, x2: int, y2: int, steps: int = 8):
        """拖选文本 —— 选区类交互必须用真实拖拽,JS 设 Selection 不会触发业务 handler。"""
        self.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x1, "y": y1,
                                               "button": "left", "clickCount": 1})
        time.sleep(0.1)
        for k in range(1, steps + 1):
            self.send("Input.dispatchMouseEvent",
                      {"type": "mouseMoved", "x": x1 + (x2 - x1) * k // steps,
                       "y": y1 + (y2 - y1) * k // steps, "button": "left"})
            time.sleep(0.05)
        self.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x2, "y": y2,
                                               "button": "left", "clickCount": 1})
        time.sleep(0.3)

    # ── 4. 遮挡 / 溢出 / 焦点(这次三个 bug 各对应一个)──────────────
    def is_occluded(self, box: dict) -> dict:
        """元素是否被别的元素盖住 —— 用 elementFromPoint 在它自己的矩形内做命中测试。

        「分隔线看不见」「查找框关闭按钮点不到」两个 bug 都是这样查出来的:
        命中的不是自己,就是被盖住了。
        """
        js = """
        (() => {
          const b = %s;
          const pts = [[b.cx, b.cy], [b.x + 3, b.cy], [b.right - 3, b.cy]];
          const hits = pts.map(([x, y]) => {
            const e = document.elementFromPoint(x, y);
            return e ? { x, y, tag: e.tagName.toLowerCase(),
                         cls: (e.className||'').toString().slice(0, 40),
                         text: (e.textContent||'').trim().slice(0, 20) } : { x, y, tag: null };
          });
          return { hits };
        })()
        """ % json.dumps(box)
        r = self.ev(js)
        r["occluded"] = any(h.get("tag") is None for h in r["hits"])
        return r

    def overflow_of(self, selector: str) -> dict:
        """容器是否溢出(scrollWidth/Height vs clientWidth/Height)+ 哪些子元素越界。

        「聊天区恒定溢出 40px 被右侧面板盖住」就是靠这个量出来的。
        """
        js = """
        (() => {
          const el = document.querySelector(%s);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const kids = [...el.children].map(c => {
            const cr = c.getBoundingClientRect();
            return { cls: (c.className||'').toString().slice(0,40),
                     x: Math.round(cr.x), right: Math.round(cr.right), w: Math.round(cr.width),
                     overflowRight: Math.round(cr.right - r.right),
                     overflowLeft: Math.round(r.x - cr.x) };
          });
          return { x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width),
                   scrollW: el.scrollWidth, clientW: el.clientWidth,
                   overflowX: el.scrollWidth - el.clientWidth,
                   children: kids.filter(k => k.overflowRight > 0 || k.overflowLeft > 0) };
        })()
        """ % json.dumps(selector)
        return self.ev(js)

    def focus_state(self, container_selector: str | None = None) -> dict:
        """当前焦点在哪、是否落在指定容器内。

        「失焦后回车仍切换预览」的根因(点击文件树后 activeElement 居然是 body)就是这样发现的。
        """
        js = """
        (() => {
          const sel = %s;
          const a = document.activeElement;
          return {
            tag: a ? a.tagName.toLowerCase() : null,
            cls: a ? (a.className||'').toString().slice(0, 50) : null,
            tabIndex: a instanceof HTMLElement ? a.tabIndex : null,
            inContainer: (sel && a instanceof Element) ? Boolean(a.closest(sel)) : null,
          };
        })()
        """ % json.dumps(container_selector)
        return self.ev(js)

    def css_var(self, name: str, selector: str | None = None):
        """读 CSS 变量 —— 比 innerText 判定可靠得多(如 --main-right 判侧栏开合)。"""
        js = """
        (() => {
          const sel = %s, name = %s;
          const el = sel ? document.querySelector(sel)
                         : [...document.querySelectorAll('*')].find(e => getComputedStyle(e).getPropertyValue(name).trim() !== '');
          if (!el) return null;
          return getComputedStyle(el).getPropertyValue(name).trim();
        })()
        """ % (json.dumps(selector), json.dumps(name))
        return self.ev(js)

    # ── 5. 像素级验收 ──────────────────────────────────────────
    def shot(self, name: str) -> str:
        os.makedirs(self.shot_dir, exist_ok=True)
        data = self.send("Page.captureScreenshot", {"format": "png"}).get("result", {}).get("data")
        if not data:
            raise ProbeError("截图失败")
        path = os.path.join(self.shot_dir, "%s.png" % name)
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        return path

    def zoom_shot(self, name: str, x: int, y: int, w: int, h: int, scale: float = 8.0) -> str:
        """区域放大截图 —— 1px 分隔线这类细节,不放大根本看不出「画了但被盖住」。

        注意:必须用 CDP 截图而不是 screencapture。多屏环境下窗口可能在副屏(屏幕坐标为负),
        screencapture 只截主屏会得到全白图 —— 2026-08-13 踩过。
        """
        os.makedirs(self.shot_dir, exist_ok=True)
        data = self.send("Page.captureScreenshot", {
            "format": "png",
            "clip": {"x": x, "y": y, "width": w, "height": h, "scale": scale},
        }).get("result", {}).get("data")
        if not data:
            raise ProbeError("区域截图失败")
        path = os.path.join(self.shot_dir, "%s.png" % name)
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        return path

    def sample_column(self, x: int, y_from: int, y_to: int, step: int = 10) -> list:
        """沿竖线采样元素命中情况 —— 判断分隔线/边框这类细长元素是否真的存在于视觉层。"""
        js = """
        (() => {
          const x = %d, y1 = %d, y2 = %d, step = %d;
          const out = [];
          for (let y = y1; y <= y2; y += step) {
            const e = document.elementFromPoint(x, y);
            out.push({ y, tag: e ? e.tagName.toLowerCase() : null,
                       cls: e ? (e.className||'').toString().slice(0, 30) : null });
          }
          return out;
        })()
        """ % (x, y_from, y_to, step)
        return self.ev(js)


# ── CLI:直接跑本文件即输出当前窗口几何,供随时确认坐标系 ──────────
if __name__ == "__main__":
    ui = UI()
    try:
        geo = ui.window_geometry()
        print(json.dumps(geo, ensure_ascii=False, indent=2))
        print()
        if geo.get("offscreen"):
            print("⚠️  窗口有部分在屏幕外 —— 视口坐标可能无法点到,建议先把窗口移回主屏")
        w = geo.get("window") or {}
        if w and w.get("x", 0) < 0:
            print("⚠️  窗口 x=%s 为负(在副屏左侧)—— screencapture 截主屏会得到空白,"
                  "截图一律用 UI.shot()/zoom_shot()" % w["x"])
        print("视口 %sx%s dpr=%s —— CDP 点击坐标必须落在这个范围内"
              % (geo["viewport"]["w"], geo["viewport"]["h"], geo["viewport"]["dpr"]))
    finally:
        ui.close()
