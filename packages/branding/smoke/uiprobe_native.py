#!/usr/bin/env python3
"""[fork-only] uiprobe 的 native 层 —— 按平台分派 [feat: upstream-sync-2026-08] 2026-08-14

## 为什么单独一个文件

`uiprobe.py` 的 CDP 部分(click/key/type_text/drag/find_element/overflow_of/is_occluded/
css_var/shot/zoom_shot/deep_find_text/selection_text)**本来就跨平台**,一行不用改。
真正绑死 macOS 的只有一层:窗口几何、屏幕枚举、真实系统按键、原生对话框 —— 全走 AppleScript。

Mac 端交接文档(`6-windows-handoff.md`)建议 Win 端「重写脚本」,但重写 = 两套工具双轨维护,
违背项目「绝对单一」的元原则。这里改为**把 native 层抽出来按平台分派**:
同一份 `uiprobe.py` / `run_group*.py` 两端都能跑,平台差异收口在本文件。

## 两端能力对照

| 能力 | macOS 实现 | Windows 实现 |
|---|---|---|
| 窗口边界 / 数量 | AppleScript System Events | ctypes EnumWindows + GetWindowRect |
| 屏幕枚举 | AppleScript Finder(只报主屏) | ctypes EnumDisplayMonitors(**全部屏幕,含副屏负坐标**) |
| 真实系统按键 | AppleScript keystroke | ctypes keybd_event |
| 前台化 | System Events frontmost | ctypes SetForegroundWindow |
| 原生对话框读取 / 点按钮 | AppleScript AXDialog | ctypes EnumChildWindows(**不能用 UIA**,模态框阻塞 UI 线程时 UIA 恒返回空)|
| 菜单树导出 | AppleScript(原生菜单) | PowerShell UIAutomation(仅非模态场景)|
| 退出全屏 | ⌃⌘F | ShowWindow(SW_RESTORE) |

## Windows 特有的两个坑(踩过才写在这)

1. **DPI 虚拟化**:Python 进程若不声明 DPI 感知,`GetWindowRect` 拿到的是被系统缩放过的
   逻辑坐标,而 Electron 是 per-monitor DPI aware —— 两者对不上,窗口几何判定会整体偏移。
   本模块 import 时立刻声明 per-monitor-v2 感知,**必须在任何窗口 API 调用之前**。
2. **cmd 修饰键**:fork 在 Win 上快捷键是 `Ctrl+`,不是 `Cmd+`。调用方(两端共用的脚本)
   仍写 `cmd=True`,由本模块在 Windows 上映射成 Ctrl —— 这样脚本不必到处写 if platform。
"""
import ctypes
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"


# ── Windows:DPI 感知必须在任何窗口 API 之前声明 ─────────────────────
def _declare_dpi_aware():
    """声明 per-monitor-v2 DPI 感知。

    不声明的后果:在 150% 缩放的屏幕上,`GetWindowRect` 返回的是被 DWM 虚拟化过的坐标,
    与 Electron 自己报告的窗口位置差一个缩放系数 —— 「窗口是否在屏幕外」这类判定会全错,
    而且错得不显眼(数值看着都合理)。
    """
    if not IS_WIN:
        return
    try:  # Win10 1703+
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        return
    except Exception:
        pass
    try:  # Win8.1+
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
        return
    except Exception:
        pass
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


_declare_dpi_aware()


class Native:
    """native 层接口。未实现的能力一律返回 None / False,**绝不假装成功**。

    返回 None 与返回「失败」是两回事:调用方据此把结论记为「前提不满足」而不是「缺陷」——
    这正是 Mac 端交接文档里点名的最重要教训。
    """

    platform = "unknown"
    supports_native_dialog = False

    def window_bounds(self, process_name: str) -> dict | None:
        return None

    def window_count(self, process_name: str) -> int | None:
        return None

    def displays(self) -> list:
        return []

    def focus(self, process_name: str) -> bool:
        return False

    def send_key(self, key: str, cmd: bool = False, shift: bool = False,
                 alt: bool = False, ctrl: bool = False) -> bool:
        return False

    def type_text(self, text: str) -> bool:
        return False

    def set_window_size(self, process_name: str, w: int, h: int) -> bool:
        return False

    def exit_fullscreen(self, process_name: str) -> bool:
        return False

    def dialogs(self, process_name: str) -> list:
        """返回该进程当前的原生对话框:[{title, text, buttons: [名字...]}]"""
        return []

    def click_dialog_button(self, process_name: str, name: str) -> bool:
        return False


# ══════════════════════════════════════════════════════════════════
# macOS —— 原实现原样搬过来(uiprobe.py 2026-08-13 版),行为不变
# ══════════════════════════════════════════════════════════════════
class MacNative(Native):
    platform = "darwin"
    supports_native_dialog = True

    _KEYCODES = {"Escape": 53, "Enter": 36, "Return": 36, "Tab": 48, "Backspace": 51,
                 "ArrowUp": 126, "ArrowDown": 125, "ArrowLeft": 123, "ArrowRight": 124}

    def _osa(self, script: str) -> str:
        try:
            r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10)
            return (r.stdout or "").strip()
        except Exception:
            return ""

    def window_bounds(self, process_name: str) -> dict | None:
        raw = self._osa(
            'tell application "System Events" to tell process "%s" to return '
            "(position of window 1) & (size of window 1)" % process_name)
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if len(parts) < 4:
            return None
        try:
            x, y, w, h = (int(float(p)) for p in parts[:4])
        except ValueError:
            return None
        return {"x": x, "y": y, "w": w, "h": h, "right": x + w, "bottom": y + h}

    def window_count(self, process_name: str) -> int | None:
        raw = self._osa('tell application "System Events" to tell process "%s" to return count of windows'
                        % process_name)
        try:
            return int(raw)
        except ValueError:
            return None

    def displays(self) -> list:
        raw = self._osa('tell application "Finder" to return bounds of window of desktop')
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if len(parts) >= 4:
            try:
                l, t, r, b = (int(float(p)) for p in parts[:4])
                return [{"x": l, "y": t, "right": r, "bottom": b, "w": r - l, "h": b - t, "primary": True}]
            except ValueError:
                pass
        return []

    def focus(self, process_name: str) -> bool:
        self._osa('tell application "System Events" to set frontmost of process "%s" to true' % process_name)
        time.sleep(0.35)
        return True

    def send_key(self, key, cmd=False, shift=False, alt=False, ctrl=False) -> bool:
        mods = []
        if cmd:
            mods.append("command down")
        if shift:
            mods.append("shift down")
        if alt:
            mods.append("option down")
        if ctrl:
            mods.append("control down")
        using = (" using {%s}" % ", ".join(mods)) if mods else ""
        code = self._KEYCODES.get(key)
        if code is not None:
            self._osa('tell application "System Events" to key code %d%s' % (code, using))
        else:
            self._osa('tell application "System Events" to keystroke "%s"%s' % (key, using))
        time.sleep(0.25)
        return True

    def type_text(self, text: str) -> bool:
        self._osa('tell application "System Events" to keystroke %s' % json.dumps(text))
        return True

    def set_window_size(self, process_name: str, w: int, h: int) -> bool:
        self._osa('tell application "System Events" to tell process "%s" to '
                  'set size of (first window whose subrole is "AXStandardWindow") to {%d, %d}'
                  % (process_name, w, h))
        time.sleep(0.6)
        return True

    def exit_fullscreen(self, process_name: str) -> bool:
        self.focus(process_name)
        self._osa('tell application "System Events" to keystroke "f" using {control down, command down}')
        time.sleep(2.5)
        return True

    def dialogs(self, process_name: str) -> list:
        raw = self._osa('tell application "System Events" to tell process "%s" to '
                        'return count of (every window whose subrole is "AXDialog")' % process_name)
        try:
            n = int(raw)
        except ValueError:
            return []
        return [{"title": None, "text": None, "buttons": []} for _ in range(n)]

    def click_dialog_button(self, process_name: str, name: str) -> bool:
        self._osa('tell application "System Events" to tell process "%s" to '
                  'click button 1 of (first window whose subrole is "AXDialog")' % process_name)
        time.sleep(0.8)
        return True


# ══════════════════════════════════════════════════════════════════
# Windows —— ctypes(几何/按键,快)+ PowerShell UIAutomation(对话框)
# ══════════════════════════════════════════════════════════════════
if IS_WIN:
    from ctypes import wintypes

    _user32 = ctypes.WinDLL("user32", use_last_error=True)
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    _WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    _MONITORENUMPROC = ctypes.WINFUNCTYPE(
        wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)

    _user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    _user32.IsWindowVisible.argtypes = [wintypes.HWND]
    _user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    _user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    _user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    _user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    _user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                     ctypes.c_int, ctypes.c_int, wintypes.UINT]
    _user32.GetWindowPlacement.argtypes = [wintypes.HWND, ctypes.c_void_p]
    _user32.GetParent.argtypes = [wintypes.HWND]
    _user32.GetParent.restype = wintypes.HWND
    # SendMessageW 的 lParam 类型**随消息而变**:WM_SETTEXT 要字符串指针,BM_CLICK 要整数。
    # 全局把 argtypes 定死成 c_wchar_p,BM_CLICK 传 0 就会 ArgumentError(2026-08-14 实撞)。
    # 所以按用途取两个独立的函数原型,各自声明。
    _send_text = ctypes.WINFUNCTYPE(
        ctypes.c_long, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, ctypes.c_wchar_p
    )(("SendMessageW", _user32))
    _send_msg = ctypes.WINFUNCTYPE(
        ctypes.c_long, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
    )(("SendMessageW", _user32))

    _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    _SW_RESTORE, _SW_SHOW = 9, 5
    _SWP_NOMOVE, _SWP_NOZORDER, _SWP_NOACTIVATE = 0x0002, 0x0004, 0x0010
    _KEYEVENTF_KEYUP, _KEYEVENTF_EXTENDEDKEY, _KEYEVENTF_UNICODE = 0x02, 0x01, 0x04

    class _WINDOWPLACEMENT(ctypes.Structure):
        _fields_ = [("length", wintypes.UINT), ("flags", wintypes.UINT),
                    ("showCmd", wintypes.UINT), ("ptMinPosition", wintypes.POINT),
                    ("ptMaxPosition", wintypes.POINT), ("rcNormalPosition", wintypes.RECT)]

    def _process_image_name(pid: int) -> str:
        """pid → 进程名。不依赖 psutil(测试机不一定装),走 QueryFullProcessImageNameW。"""
        h = _kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return ""
        try:
            size = wintypes.DWORD(1024)
            buf = ctypes.create_unicode_buffer(1024)
            if _kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
                return os.path.basename(buf.value)
            return ""
        finally:
            _kernel32.CloseHandle(h)

    def _win_text(hwnd) -> str:
        buf = ctypes.create_unicode_buffer(512)
        _user32.GetWindowTextW(hwnd, buf, 512)
        return buf.value

    def _win_class(hwnd) -> str:
        buf = ctypes.create_unicode_buffer(256)
        _user32.GetClassNameW(hwnd, buf, 256)
        return buf.value

    def _is_cloaked(hwnd) -> bool:
        """DWM 隐藏(cloaked)窗口。

        `IsWindowVisible` 对它返回 **true**,但用户完全看不见 —— Electron 会留这类窗口。
        不过滤的话 `window_count` 会虚高,触发 uiprobe 的「多窗口,几何不可信」告警,
        把一次正常的单窗口测试污染成「结论不可信」。
        """
        try:
            val = ctypes.c_int(0)
            ctypes.windll.dwmapi.DwmGetWindowAttribute(
                wintypes.HWND(hwnd), 14, ctypes.byref(val), ctypes.sizeof(val))  # DWMWA_CLOAKED
            return val.value != 0
        except Exception:
            return False

    def _top_windows_of(process_name: str, include_minimized: bool = False) -> list:
        """该进程所有**用户真能看见的顶层窗口**,按面积从大到小。

        进程名匹配用 basename 去扩展名比对,调用方传 "DeskFox 本地版" 或 "DeskFox 本地版.exe" 都行。

        三层过滤,每层都对应一次实测到的假信号(2026-08-14 Win 端接入时踩的):
          1. **0 尺寸**:Electron 的辅助窗口;
          2. **x/y = -32000**:Windows 把最小化窗口停在这个坐标。实测 user 的正式版 DeskFox
             就报出 `x=-32000, w=199, h=34` —— 拿它当主窗口,几何判定会全错且错得不显眼;
          3. **DWM cloaked**:`IsWindowVisible` 说可见、用户其实看不见。
        """
        want = os.path.splitext(process_name)[0].lower()
        out = []

        def _cb(hwnd, _lparam):
            if not _user32.IsWindowVisible(hwnd):
                return True
            pid = wintypes.DWORD()
            _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            name = os.path.splitext(_process_image_name(pid.value))[0].lower()
            if name != want:
                return True
            r = wintypes.RECT()
            if not _user32.GetWindowRect(hwnd, ctypes.byref(r)):
                return True
            w, h = r.right - r.left, r.bottom - r.top
            if w <= 0 or h <= 0:
                return True
            minimized = bool(_user32.IsIconic(hwnd)) or r.left <= -30000 or r.top <= -30000
            if minimized and not include_minimized:
                return True
            if _is_cloaked(hwnd):
                return True
            out.append({"hwnd": hwnd, "x": r.left, "y": r.top, "w": w, "h": h,
                        "right": r.right, "bottom": r.bottom, "minimized": minimized,
                        "title": _win_text(hwnd), "cls": _win_class(hwnd)})
            return True

        _user32.EnumWindows(_WNDENUMPROC(_cb), 0)
        out.sort(key=lambda d: d["w"] * d["h"], reverse=True)
        return out

    def _dialog_children(hwnd) -> list:
        """对话框的全部子控件(递归),标出**是否为对话框直属**。

        `direct` 这个字段不是可有可无的:文件对话框里有**两个** Edit ——
        「文件夹:」输入框是对话框直属,地址栏那个嵌在 WorkerW → ComboBoxEx32 下。
        写错一个,路径静静地填到地址栏里、确认按钮拿到的还是旧值,表现为「点了没反应」。
        """
        out = []

        def _cb(child, _lparam):
            out.append({"hwnd": child, "cls": _win_class(child), "text": _win_text(child),
                        "direct": _user32.GetParent(child) == hwnd})
            return True

        _user32.EnumChildWindows(hwnd, _WNDENUMPROC(_cb), 0)
        return out

    _VK = {"Escape": 0x1B, "Enter": 0x0D, "Return": 0x0D, "Tab": 0x09, "Backspace": 0x08,
           "Delete": 0x2E, "Space": 0x20, "Home": 0x24, "End": 0x23,
           "ArrowUp": 0x26, "ArrowDown": 0x28, "ArrowLeft": 0x25, "ArrowRight": 0x27,
           "F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73, "F5": 0x74, "F6": 0x75,
           "F10": 0x79, "F11": 0x7A, "F12": 0x7B}
    _EXTENDED = {0x26, 0x28, 0x25, 0x27, 0x24, 0x23, 0x2E}
    _VK_CONTROL, _VK_SHIFT, _VK_MENU = 0x11, 0x10, 0x12

    def _tap(vk: int, down: bool):
        flags = _KEYEVENTF_EXTENDEDKEY if vk in _EXTENDED else 0
        if not down:
            flags |= _KEYEVENTF_KEYUP
        _user32.keybd_event(vk, 0, flags, 0)
        time.sleep(0.02)

    class WinNative(Native):
        platform = "win32"
        supports_native_dialog = True

        # ── 几何 ─────────────────────────────────────────────
        def window_bounds(self, process_name: str) -> dict | None:
            wins = _top_windows_of(process_name)
            if not wins:
                return None
            w = wins[0]
            return {k: w[k] for k in ("x", "y", "w", "h", "right", "bottom")}

        def window_count(self, process_name: str) -> int | None:
            return len(_top_windows_of(process_name))

        def displays(self) -> list:
            """枚举**全部**显示器 —— 比 Mac 侧强(那边 Finder 只报主屏)。

            副屏在主屏左侧时坐标为负,`_is_offscreen` 判定必须拿到全部屏幕才准;
            Mac 端「窗口在副屏 x=-1623 点击全落空」那次翻车,根因之一就是只知道主屏边界。
            """
            out = []
            primary_origin = (0, 0)

            def _cb(hmon, _hdc, lprect, _lparam):
                r = lprect.contents
                out.append({"x": r.left, "y": r.top, "right": r.right, "bottom": r.bottom,
                            "w": r.right - r.left, "h": r.bottom - r.top,
                            "primary": (r.left, r.top) == primary_origin})
                return True

            _user32.EnumDisplayMonitors(0, None, _MONITORENUMPROC(_cb), 0)
            out.sort(key=lambda d: (not d["primary"], d["x"]))
            return out

        # ── 前台 / 按键 ────────────────────────────────────────
        def focus(self, process_name: str) -> bool:
            wins = _top_windows_of(process_name)
            if not wins:
                return False
            hwnd = wins[0]["hwnd"]
            _user32.ShowWindow(hwnd, _SW_SHOW)
            # SetForegroundWindow 在前台窗口属于别的进程时会被系统拒绝(防抢焦点)。
            # 附着到当前前台线程的输入队列可绕过——这是 Win 上做 native 自动化的标准手法。
            fg = _user32.GetForegroundWindow()
            cur = _kernel32.GetCurrentThreadId()
            tgt = _user32.GetWindowThreadProcessId(fg, None) if fg else 0
            if tgt and tgt != cur:
                _user32.AttachThreadInput(tgt, cur, True)
                ok = bool(_user32.SetForegroundWindow(hwnd))
                _user32.AttachThreadInput(tgt, cur, False)
            else:
                ok = bool(_user32.SetForegroundWindow(hwnd))
            time.sleep(0.35)
            return ok

        def send_key(self, key, cmd=False, shift=False, alt=False, ctrl=False) -> bool:
            """真实系统按键。

            **`cmd` 在 Windows 上映射为 Ctrl** —— fork 在 Win 的快捷键是 `Ctrl+`。
            两端共用的测试脚本照旧写 `cmd=True`,不必到处 if platform;
            要区分时用 `ctrl=` 显式表达即可(二者在 Win 上等价、不会重复按)。
            """
            use_ctrl = ctrl or cmd
            mods = []
            if use_ctrl:
                mods.append(_VK_CONTROL)
            if shift:
                mods.append(_VK_SHIFT)
            if alt:
                mods.append(_VK_MENU)
            vk = _VK.get(key)
            if vk is None:
                if len(key) != 1:
                    return False
                vk = ord(key.upper())
            for m in mods:
                _tap(m, True)
            _tap(vk, True)
            _tap(vk, False)
            for m in reversed(mods):
                _tap(m, False)
            time.sleep(0.25)
            return True

        def type_text(self, text: str) -> bool:
            """逐字符真实输入(走 KEYEVENTF_UNICODE,中文/空格路径都能打)。

            用于原生文件对话框这类 **CDP 够不着** 的地方 —— 网页内输入仍走 uiprobe.type_text。
            """
            for ch in text:
                code = ord(ch)
                _user32.keybd_event(0, code, _KEYEVENTF_UNICODE, 0)
                _user32.keybd_event(0, code, _KEYEVENTF_UNICODE | _KEYEVENTF_KEYUP, 0)
                time.sleep(0.012)
            return True

        # ── 窗口复位 ───────────────────────────────────────────
        def set_window_size(self, process_name: str, w: int, h: int) -> bool:
            wins = _top_windows_of(process_name)
            if not wins:
                return False
            ok = _user32.SetWindowPos(wins[0]["hwnd"], 0, 0, 0, w, h,
                                      _SWP_NOMOVE | _SWP_NOZORDER | _SWP_NOACTIVATE)
            time.sleep(0.6)
            return bool(ok)

        def exit_fullscreen(self, process_name: str) -> bool:
            """Win 上最大化/全屏都用 SW_RESTORE 复位。

            与 Mac 不同:Windows 没有「独立 Space」概念,全屏窗口照样能被 EnumWindows 枚举到,
            所以不会出现 Mac 那种「count of windows = 0,以为窗口被关了」的假象。
            """
            wins = _top_windows_of(process_name)
            if not wins:
                return False
            hwnd = wins[0]["hwnd"]
            pl = _WINDOWPLACEMENT()
            pl.length = ctypes.sizeof(_WINDOWPLACEMENT)
            _user32.GetWindowPlacement(hwnd, ctypes.byref(pl))
            if pl.showCmd == 3:  # SW_SHOWMAXIMIZED
                _user32.ShowWindow(hwnd, _SW_RESTORE)
                time.sleep(0.8)
                return True
            return False

        def is_maximized(self, process_name: str) -> bool | None:
            wins = _top_windows_of(process_name)
            if not wins:
                return None
            pl = _WINDOWPLACEMENT()
            pl.length = ctypes.sizeof(_WINDOWPLACEMENT)
            _user32.GetWindowPlacement(wins[0]["hwnd"], ctypes.byref(pl))
            return pl.showCmd == 3

        # ── 原生对话框(UIAutomation)───────────────────────────
        def dialogs(self, process_name: str) -> list:
            """列出该进程的原生对话框及其按钮 —— **走 ctypes,不走 UIA**。

            2026-08-14 实测修正(本文件早先的注释写反了,已改):
            · Electron 在 Windows 确实用 TaskDialogIndirect,**正文**在 DirectUI 里读不到;
              但**按钮是真 Win32 `Button` 子窗口**,`EnumChildWindows` + `WM_GETTEXT` 读得到
              (崩溃对话框实测拿到「重新启动 / 导出日志 / 退出」)。
            · 更关键的是:**模态对话框会阻塞应用的 UI 线程,UIA 跨进程查询直接返回空** ——
              实测崩溃对话框明明在屏幕上,UIA 却报 0 个。若按 UIA 的结果下结论,
              会得到「崩溃后没有弹恢复对话框」这种**完全相反**的判断。
            所以 Win 上对话框一律以 ctypes 为准;UIA 只用于菜单树这类非模态场景。
            """
            out = []
            for w in _top_windows_of(process_name, include_minimized=True):
                if w["cls"] != "#32770":
                    continue
                kids = _dialog_children(w["hwnd"])
                buttons = [c["text"] for c in kids if c["cls"] == "Button" and c["text"]]
                texts = [c["text"] for c in kids if c["cls"] in ("Static", "SysLink") and c["text"]]
                out.append({"title": w["title"], "cls": w["cls"], "modal": True,
                            "text": " | ".join(texts), "buttons": buttons})
            return out

        def click_dialog_button(self, process_name: str, name: str) -> bool:
            """点对话框按钮。`name` 为空串时点第一个(用于 heal_window 的兜底关闭)。"""
            for w in _top_windows_of(process_name, include_minimized=True):
                if w["cls"] != "#32770":
                    continue
                btns = [c for c in _dialog_children(w["hwnd"])
                        if c["cls"] == "Button" and c["text"]]
                if not btns:
                    continue
                target = btns[0] if not name else next(
                    (b for b in btns if b["text"] == name or name in b["text"]), None)
                if not target:
                    continue
                _send_msg(target["hwnd"], 0x00F5, 0, 0)  # BM_CLICK
                return True
            return False

        def dialog_controls(self, process_name: str) -> list:
            """文件对话框的 Win32 子控件清单(排障用:先看清结构再动手)。

            **不用 UIA**:文件对话框的 UIA 树含整个文件列表,`FindAll(Descendants)` 动辄几千个节点,
            实测 40s 超时(2026-08-14)。而它的关键控件恰恰是**真 Win32 控件**
            (`Static 文件夹:` / `Edit` / `Button 选择文件夹`),EnumChildWindows 一瞬就拿到。
            —— 消息框(TaskDialog)那种才必须走 UIA,两者别混为一谈。
            """
            out = []
            for w in _top_windows_of(process_name, include_minimized=True):
                if w["cls"] != "#32770":
                    continue
                out.append({"title": w["title"], "cls": w["cls"],
                            "controls": [{"cls": c["cls"], "text": c["text"], "direct": c["direct"]}
                                         for c in _dialog_children(w["hwnd"])]})
            return out

        def open_path_in_dialog(self, process_name: str, path: str) -> dict | None:
            """往原生文件/文件夹对话框填路径并点确认。

            WM_SETTEXT 直接写进「文件夹:」输入框,再 BM_CLICK 确认按钮 ——
            **不模拟键盘**:中文路径不必过输入法,也不用猜「按几次回车」
            (Mac 版 open_project.py 正是在回车次数上翻过车,见其 press_until 注释)。
            """
            dlgs = [w for w in _top_windows_of(process_name, include_minimized=True) if w["cls"] == "#32770"]
            if not dlgs:
                return {"ok": False, "reason": "当前没有 #32770 原生对话框"}
            kids = _dialog_children(dlgs[0]["hwnd"])

            # 输入框要挑**对话框直属**的那个 Edit:地址栏也有一个 Edit,
            # 但它嵌在 WorkerW → ComboBoxEx32 里(direct=False),写进去不起作用。
            edit = next((c for c in kids if c["cls"] == "Edit" and c["direct"]), None)
            if not edit:
                return {"ok": False, "reason": "对话框里没有直属 Edit 控件"}
            if not _send_text(edit["hwnd"], 0x000C, 0, path):  # WM_SETTEXT
                return {"ok": False, "reason": "WM_SETTEXT 写入失败"}
            time.sleep(0.3)

            for cand in ("选择文件夹", "打开", "确定", "Select Folder", "Open", "OK"):
                btn = next((c for c in kids if c["cls"] == "Button" and c["text"] == cand), None)
                if not btn:
                    continue
                _send_msg(btn["hwnd"], 0x00F5, 0, 0)  # BM_CLICK
                return {"ok": True, "typed": path, "button": cand}
            return {"ok": False, "typed": path, "reason": "填了路径但找不到确认按钮"}

        def menu_bar(self, process_name: str) -> list:
            """Win 应用内菜单栏的 UIA 快照(顶层项 + 子项名)。

            Mac 是原生菜单、Win 是 `autoHideMenuBar` 的应用内菜单栏 —— 实现不同但
            **两端都在 UIA/AX 树里**,所以中文化校验可以用同一套断言。
            """
            return self._uia("menu", process_name) or []

        def _uia(self, verb: str, process_name: str, arg: str = ""):
            ps = os.path.join(HERE, "uia_win.ps1")
            if not os.path.exists(ps):
                return None
            try:
                # errors="replace" 不能省:PS 在设置 OutputEncoding 之前若先写了 stderr
                # (如程序集加载失败),那几个字节仍是系统 ANSI(中文机上是 GBK),
                # 严格 utf-8 解码会在读取线程里抛 UnicodeDecodeError —— 表现为工具整个挂掉,
                # 而真正的原因只是一句诊断信息编码不对。2026-08-14 实撞。
                r = subprocess.run(
                    ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                     "-File", ps, "-Verb", verb, "-Process", process_name, "-Arg", arg],
                    capture_output=True, text=True, timeout=40,
                    encoding="utf-8", errors="replace")
                out = (r.stdout or "").strip()
                if not out:
                    return None
                data = json.loads(out)
                # 双保险:PS5.1 的 ConvertTo-Json 有把单元素数组拆成对象的毛病。
                # ps1 侧已用 -InputObject 修掉,这里再兜一层 —— 列表型 verb 拿到 dict 时
                # 包成单元素列表,免得调用方的 len() 数成字典键个数(实撞过,见 ps1 注释)。
                if verb in ("dialogs", "menu", "controls") and isinstance(data, dict):
                    return [data]
                return data
            except Exception as e:  # 工具失败 ≠ 功能坏了,显式说出来
                print("[native] UIA 调用失败(%s):%s" % (verb, e), file=sys.stderr)
                return None


def get_native() -> Native:
    if IS_MAC:
        return MacNative()
    if IS_WIN:
        return WinNative()
    return Native()


# ── CLI 自查:直接跑本文件,确认 native 层在当前平台可用 ─────────────
if __name__ == "__main__":
    proc = sys.argv[1] if len(sys.argv) > 1 else "DeskFox 本地版"
    n = get_native()
    print("platform:", n.platform)
    print("displays:", json.dumps(n.displays(), ensure_ascii=False))
    print("window_count(%s):" % proc, n.window_count(proc))
    print("window_bounds(%s):" % proc, json.dumps(n.window_bounds(proc), ensure_ascii=False))
    if IS_WIN:
        print("dialogs:", json.dumps(n.dialogs(proc), ensure_ascii=False))
