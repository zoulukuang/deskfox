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
| 用 CDP 合成 `⌘A` 清空输入 | 它不全选、反而弹「关于」对话框(真实系统 ⌘A 正常)→ 搜索词拼成乱串,结论全错 | `clear_input()` 用退格逐字删 |
| 目标滚出视口就放弃 | 断言正确地拦下点击,但问题其实只是「没滚过去」 | `scroll_into_view()` 先滚再重新量几何 |

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

# native 层(窗口几何 / 真实系统按键 / 原生对话框)按平台分派 —— 2026-08-14 Win 端接入。
# CDP 部分本来就跨平台,一行没动;绑死 macOS 的只有下面这一层,收口到 uiprobe_native.py。
from uiprobe_native import get_native

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
        self.native = get_native()
        self._id = 0
        self.ws = websocket.create_connection(self._ws_url(), timeout=30, suppress_origin=True)

    # ── 基础 ────────────────────────────────────────────────
    def _ws_url(self) -> str:
        """选取要连的 page target。

        **不能盲取第一个** —— 2026-08-13 实撞:测多窗口时留下第二个窗口,列表里就有两个 page,
        取到的那个是**后台窗口**,渲染器被浏览器节流,`Runtime.evaluate` 迟迟不返回,
        表现为「CDP 连接超时」,极易被误判成工具坏了或应用挂了(当时排查了很久)。
        这里**实测**每个 target 的 `document.visibilityState`,只挑 visible 的那个。

        2026-08-13 二次实撞:原实现按 title 里有没有 "background" 排序 —— 但两个窗口 title 都是
        "OpenCode",`attached` 也都是 None,排序等于没排,照样取到列表第一个(恰是隐藏窗口)。
        **靠命名约定猜前台是不可靠的,必须实测。** 猜 → 测,是这次工具修正的核心。
        """
        targets = json.load(urllib.request.urlopen("http://%s/json" % self.host, timeout=5))
        pages = [t for t in targets if t.get("type") == "page"]
        return self.pick_visible_page(pages, self._probe_visibility)["webSocketDebuggerUrl"]

    @staticmethod
    def pick_visible_page(pages: list, probe) -> dict:
        """从 page target 列表里挑出前台可见的那个。

        抽成不碰网络的纯函数,`probe(ws_url) -> str | None` 由调用方注入 ——
        这样选取逻辑本身能离线回归(见 `uiprobe_selftest.py` 第 0 节),
        不必真开两个窗口才能验。
        """
        if not pages:
            raise ProbeError("CDP 没有 page target —— 应用没起来,或没开 --remote-debugging-port")
        if len(pages) == 1:
            return pages[0]

        visible = []
        for p in pages:
            state = probe(p["webSocketDebuggerUrl"])
            print("[uiprobe] target %s… visibilityState=%s" % (p.get("id", "?")[:8], state), file=sys.stderr)
            if state == "visible":
                visible.append(p)
        if not visible:
            raise ProbeError(
                "%d 个 page target 全部处于 hidden —— 窗口可能被最小化或全被遮挡。"
                "后台渲染器会被节流、evaluate 可能超时,此时任何结论都不可信。" % len(pages))
        if len(visible) > 1:
            print("[uiprobe] %d 个窗口同时可见,取第一个;若结果异常请只留一个窗口重试。"
                  % len(visible), file=sys.stderr)
        print("[uiprobe] 共 %d 个 page target,已选中可见窗口 %s…"
              % (len(pages), visible[0].get("id", "?")[:8]), file=sys.stderr)
        return visible[0]

    def _probe_visibility(self, ws_url: str) -> str | None:
        """单独连一次,只问一句 visibilityState。超时即视为不可用(被节流的后台窗口)。"""
        try:
            ws = websocket.create_connection(ws_url, timeout=5, suppress_origin=True)
        except Exception:
            return None
        try:
            ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                                "params": {"expression": "document.visibilityState",
                                           "returnByValue": True}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == 1:
                    return msg.get("result", {}).get("result", {}).get("value")
        except Exception:
            return None
        finally:
            ws.close()

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
        out["platform"] = self.native.platform
        out["window"] = self._window_bounds_native()
        # 多窗口时 native 层的「第一个窗口」未必是 CDP 连着的那个 —— 2026-08-13 实撞:
        # CDP 视口 1600x950,AppleScript 报 1500x900,两者说的根本不是同一个窗口。
        # 拿它去判「窗口尺寸记忆」必然得出错误结论,故显式标注不可信。
        # (Win 侧同理:EnumWindows 按面积排序取最大的那个,多开时同样不保证是 CDP 目标窗口。)
        out["window_count"] = self._window_count_native()
        if out["window_count"] and out["window_count"] > 1:
            w = out["window"] or {}
            mismatch = abs((w.get("w") or 0) - vp["w"]) > 40 or abs((w.get("h") or 0) - vp["h"]) > 60
            out["window_untrusted"] = (
                "存在 %d 个窗口,native 层的第一个窗口未必是 CDP 连着的那个%s —— "
                "窗口位置/尺寸类判定请先关到只剩一个窗口" % (
                    out["window_count"],
                    "(实测已不一致:native %sx%s vs 视口 %sx%s)" % (w.get("w"), w.get("h"), vp["w"], vp["h"])
                    if mismatch else "")
            )
            print("[uiprobe] 警告:%s" % out["window_untrusted"], file=sys.stderr)
        out["displays"] = self._displays_native()
        out["on_display"] = self._which_display(out["window"], out["displays"])
        out["offscreen"] = self._is_offscreen(out["window"], out["displays"])
        return out

    def _window_bounds_native(self) -> dict | None:
        return self.native.window_bounds(self.process_name)

    def _window_count_native(self) -> int | None:
        return self.native.window_count(self.process_name)

    def _displays_native(self) -> list:
        return self.native.displays()

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

    def scroll_into_view(self, selector_js: str, refetch, what: str = "目标元素"):
        """把滚出视口的元素滚进来,再返回**重新量过**的几何。

        2026-08-13 加:长会话里「复制」「步骤触发器」按钮 y 会跑到 1076 或 -372,
        `assert_in_viewport` 正确地拦下了点击(这是它该做的),但光拦下不解决问题 ——
        元素只是被滚走了,不是不存在。缺的是「先滚过去」这一步。

        `selector_js` 是一段返回元素的 JS;`refetch` 是滚动后重新取几何的可调用对象
        (通常就是 `lambda: box_of(ui, selector_js)`)—— 必须重新量,
        因为滚动之后原来那份坐标全部作废。
        """
        self.ev("""
        (() => { const e = (() => %s)(); if (!e) return false;
          e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          return true; })()
        """ % selector_js)
        time.sleep(0.6)
        box = refetch()
        if not box:
            raise ProbeError("%s 滚动后反而找不到了" % what)
        return box

    def key(self, key: str, code: str, vk: int = 0, cmd: bool = False, shift: bool = False,
            alt: bool = False, ctrl: bool = False):
        mods = (1 if alt else 0) | (2 if ctrl else 0) | (4 if cmd else 0) | (8 if shift else 0)
        for t in ("keyDown", "keyUp"):
            self.send("Input.dispatchKeyEvent",
                      {"type": t, "key": key, "code": code, "modifiers": mods,
                       "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk})
            time.sleep(0.06)

    def type_text(self, text: str, per_char: float = 0.02):
        """逐字符真实输入。

        用 `Input.dispatchKeyEvent` 的 `char` 类型走浏览器真实输入通路,
        而不是 JS 直接改 `textContent` / `value` —— 后者不触发 SolidJS 的 input handler,
        输入框看着有字、状态里却是空的,发出去就是空消息(第三条硬规矩的同类陷阱)。
        """
        for ch in text:
            self.send("Input.dispatchKeyEvent", {"type": "char", "text": ch})
            time.sleep(per_char)

    def key_native(self, key: str, cmd: bool = False, shift: bool = False,
                   alt: bool = False, ctrl: bool = False, focus: bool = True):
        """用**真实系统按键**发快捷键(AppleScript),而不是 CDP 合成事件。

        2026-08-13 实撞,代价很大:CDP 的 cmd 组合键会**漏进 macOS 原生菜单层**,
        打中本不该触发的菜单项 —— 已坐实两例:
          · CDP `⌘A` → 弹出「关于 DeskFox」(3/3 复现),且**不执行全选**;
          · 跑测试期间主窗口反复进出**全屏**(1600×950 ↔ 2560×1410,一轮记录到 68 次),
            全屏时窗口进独立 Space,AppleScript 甚至枚举不到它(`count of windows` = 0),
            排查时一度以为窗口被关掉了。user 直接反馈「窗口不停地放大缩小」。
        同样的按键用**真实系统按键**发则一切正常(⌘A 不弹对话框)。

        所以带 cmd 的快捷键一律走这里。这正是工具包第一条硬规矩「真实输入」——
        之前只在鼠标那一层贯彻了,键盘这层留了缺口。

        代价:真实按键发给**前台应用**,所以默认先把目标进程抢到前台。

        **Windows 侧**(2026-08-14 接入):`cmd=True` 自动映射为 Ctrl —— fork 在 Win 的快捷键是
        `Ctrl+`。所以两端共用的脚本照旧写 `cmd=True` 即可,不必到处 if platform。
        另注:上面那两条 macOS 副作用(⌘A 弹「关于」、窗口反复进出全屏)是 **macOS 原生菜单层**
        的特性,Windows 没有等价机制 —— 但 Win 上仍建议走这里,因为 Electron 的菜单加速键
        由主进程窗口消息循环处理,**CDP 合成按键根本送不到那一层**,合成 Ctrl+ 组合会静默失效。
        """
        if focus:
            self.native.focus(self.process_name)
        self.native.send_key(key, cmd=cmd, shift=shift, alt=alt, ctrl=ctrl)

    def heal_window(self, want_w: int = 1600, want_h: int = 950) -> str | None:
        """把窗口从「测试副作用」里拉回正常态,返回做了什么(没事就返回 None)。

        2026-08-13 起因:跑测试时主窗口会**反复进出 macOS 全屏**
        (1600×950 ↔ 屏幕满尺寸,一轮记录到 68 次),user 直接看到「窗口不停放大缩小」。
        根因是 CDP 合成的 cmd 组合键会漏进原生菜单层(同一机制已坐实 `⌘A` → 弹「关于」);
        改用真实系统按键则**按键根本送不进副屏上的窗口**,那条路不通。
        既然消不掉源头,就让它**自愈**:每轮开跑前检查一次,发现异常就复位,
        把「持续抖动」收敛成「最多一次复位」。

        全屏时窗口进独立 Space,AppleScript 会枚举不到它(`count of windows` = 0)——
        这一点也踩过:当时以为窗口被关掉了,其实只是进了全屏。

        **Windows 侧**:全屏/最大化窗口照样能被 EnumWindows 枚举到,不会出现 Mac 那种
        「count of windows = 0,以为窗口被关了」的假象;复位走 `ShowWindow(SW_RESTORE)`。
        """
        actions = []
        count = self._window_count_native()
        if count == 0:
            # macOS:枚举不到 = 多半在全屏的独立 Space 里,⌃⌘F 退出来
            # Windows:枚举不到 = 窗口真的没了(最小化到托盘或已退出),下面的复位会自然跳过
            if self.native.exit_fullscreen(self.process_name):
                actions.append("退出全屏")
            count = self._window_count_native()
        elif self.native.platform == "win32" and getattr(self.native, "is_maximized", None):
            # Win 上「窗口不停放大缩小」的等价物是被最大化,同样会让尺寸判定失真
            if self.native.is_maximized(self.process_name) and self.native.exit_fullscreen(self.process_name):
                actions.append("退出最大化")

        # 关掉测试误触弹出的对话框(它会让「第一个窗口」指向错对象,污染几何判定)
        if self.native.dialogs(self.process_name):
            if self.native.click_dialog_button(self.process_name, ""):
                time.sleep(0.8)
                actions.append("关闭误触的对话框")

        win = self._window_bounds_native()
        if win and (abs(win["w"] - want_w) > 40 or abs(win["h"] - want_h) > 40):
            if self.native.set_window_size(self.process_name, want_w, want_h):
                actions.append("尺寸复位 %sx%s → %sx%s" % (win["w"], win["h"], want_w, want_h))
        return ";".join(actions) if actions else None

    def clear_input(self, times: int = 60):
        """清空当前焦点输入框 —— **不要用 ⌘A**。

        2026-08-13 实测(3/3 复现):CDP 的合成 `⌘A` 在本应用里
          ① **不执行全选**(`getSelection()` 长度为 0),
          ② 反而会弹出「关于 DeskFox」对话框。
        而**真实系统 ⌘A 一切正常**(AppleScript 发同样按键,不弹对话框)——
        所以这是 CDP 合成按键的假象,**不是产品缺陷**,别去改代码。

        两个真实后果都踩过:命令面板里「清空再搜」只删掉一个字符,
        导致后两轮搜的是拼接乱串(「文件/命令」双双 0 条,差点报成缺陷);
        以及测试跑完后莫名多出一个窗口,让 `window_geometry` 变得不可信。
        故本方法用退格逐字删。
        """
        for _ in range(times):
            self.send("Input.dispatchKeyEvent",
                      {"type": "keyDown", "key": "Backspace", "code": "Backspace",
                       "windowsVirtualKeyCode": 8, "nativeVirtualKeyCode": 8})
            self.send("Input.dispatchKeyEvent",
                      {"type": "keyUp", "key": "Backspace", "code": "Backspace",
                       "windowsVirtualKeyCode": 8, "nativeVirtualKeyCode": 8})

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

    def deep_find_text(self, marker: str) -> dict | None:
        """按特征词查找元素,**穿透 shadow DOM**,返回几何。

        2026-08-13 实撞:代码/文本预览渲染在 `<diffs-container>` 的 **shadow root** 里,
        `document.body.innerText` 里根本没有文件内容 —— 于是「打开 plain.txt 后搜不到 TXTMARK」
        被误读成「代码类文件没渲染」,还去翻了 iframe、canvas、闭合 shadow。
        真相是内容一直都在,只是 `querySelectorAll` 不穿 shadow 边界。
        判定「元素在不在」时,**普通选择器的『找不到』不等于『不存在』**,这是本工具第 8 类翻车。

        返回值含 `inShadow`,提示调用方:该元素的选区/文本读取也要走 shadow 通道。
        """
        js = """
        (() => {
          const needle = %s;
          const hits = [];
          const walk = (root, inShadow) => {
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) walk(el.shadowRoot, true);
              if ((el.textContent || '').includes(needle)) hits.push({ el, inShadow });
            }
          };
          walk(document, false);
          if (!hits.length) return null;
          const { el, inShadow } = hits[hits.length - 1];
          const r = el.getBoundingClientRect();
          if (r.height <= 0 || r.width <= 0) return null;
          return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
                   cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2),
                   right:Math.round(r.right), bottom:Math.round(r.bottom),
                   tag: el.tagName.toLowerCase(), inShadow,
                   text: (el.textContent||'').trim().slice(0, 40) };
        })()
        """ % json.dumps(marker)
        return self.ev(js)

    def selection_text(self) -> str:
        """读当前选区文本,**兼容 shadow DOM**。

        `window.getSelection()` 在 shadow 边界内可能返回空;Chromium 提供
        `shadowRoot.getSelection()`,这里两条都试。
        """
        return self.ev("""
        (() => { const top = (window.getSelection()||'').toString();
          if (top) return top;
          for (const el of document.querySelectorAll('*')) {
            const sr = el.shadowRoot;
            if (sr && typeof sr.getSelection === 'function') {
              const s = (sr.getSelection()||'').toString();
              if (s) return s;
            }
          }
          return ''; })()
        """) or ""

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
    @staticmethod
    def _safe_name(name: str) -> str:
        """把任意字符串洗成合法文件名。

        2026-08-14 Win 端实撞:`find_element` 未命中时会用**选择器本身**当截图文件名,
        而 Windows 文件名不允许 `\\ / : * ? " < > |`。于是 `[data-tree-path="docs\\x.md"]`
        这种选择器一命中失败,`shot()` 就抛 `OSError: Invalid argument` ——
        **工具在替你截图诊断的那一刻自己崩掉**,比原本的「未命中」更难排查。
        macOS 上只有 `/` 违规,所以这条路径 Mac 端永远走不到。
        """
        out = "".join("_" if c in '\\/:*?"<>|' or ord(c) < 32 else c for c in name)
        return out.strip(" .")[:120] or "shot"

    def shot(self, name: str) -> str:
        name = self._safe_name(name)
        os.makedirs(self.shot_dir, exist_ok=True)
        data = self.send("Page.captureScreenshot", {"format": "png"}).get("result", {}).get("data")
        if not data:
            raise ProbeError("截图失败")
        path = os.path.join(self.shot_dir, "%s.png" % name)
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        return path

    def zoom_shot(self, name: str, x: int, y: int, w: int, h: int, scale: float = 8.0) -> str:  # noqa: D401
        """区域放大截图 —— 1px 分隔线这类细节,不放大根本看不出「画了但被盖住」。

        注意:必须用 CDP 截图而不是 screencapture。多屏环境下窗口可能在副屏(屏幕坐标为负),
        screencapture 只截主屏会得到全白图 —— 2026-08-13 踩过。
        """
        name = self._safe_name(name)
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
