#!/usr/bin/env python3
"""[fork-only] P1-3 崩溃恢复对话框 [feat: upstream-sync-2026-08] 2026-08-14

对应 `6-windows-handoff.md` §二 P1-3 第三条。交接文档说「这条 CDP 部分跨平台,
只有读对话框那步要换 Win 自动化」—— 正是如此:`Page.crash()` 两端通用,
读对话框在 Win 上走 `uiprobe_native` 的 UIA(Electron 在 Windows 用 TaskDialogIndirect,
正文与按钮在 DirectUI 里,`GetWindowText` 一个字都读不到)。

⚠️ 本脚本会**真的把渲染进程搞崩**。跑完应用会停在崩溃对话框上,需要按下面提示恢复。
只在 local 档跑(独立身份 + 数据隔离,不影响你在用的正式版)。

跑法:python packages/branding/smoke/win_p1_crash.py
"""
import json
import sys
import time

from uiprobe import UI, ProbeError
from uiprobe_native import get_native

APP_PROCESS = "DeskFox 本地版"
rows = []


def record(no, name, status, detail=""):
    rows.append((no, name, status, detail))
    print("  [%s] %s %s %s" % ({"ok": "OK  ", "skip": "SKIP", "fail": "FAIL"}[status],
                               no, name, ("— " + detail) if detail else ""))


def main():
    native = get_native()

    # 前提:开跑前不能已有对话框,否则分不清是崩溃弹的还是本来就在
    pre = native.dialogs(APP_PROCESS)
    if pre:
        print("前提不成立:已有 %d 个原生对话框挂着,先关掉再跑" % len(pre))
        return 2

    ui = UI()
    try:
        print("窗口: 视口 %(w)sx%(h)s" % ui.window_geometry()["viewport"])
        print("即将触发渲染进程崩溃(Page.crash)…\n")
        try:
            # crash 后连接会断,send 多半拿不到回包 —— 这是预期,不是失败
            ui.send("Page.crash")
        except Exception:
            pass
    except ProbeError as e:
        print("连 CDP 失败:%s" % e)
        return 2
    finally:
        try:
            ui.close()
        except Exception:
            pass

    # ── C-1 崩溃对话框出现 ────────────────────────────────────
    dlg = None
    for _ in range(20):
        time.sleep(1.0)
        found = native.dialogs(APP_PROCESS)
        if found:
            dlg = found[0]
            break
    if not dlg:
        record("C-1", "崩溃后弹出恢复对话框", "fail",
               "Page.crash 后 20s 内没有出现任何原生对话框")
        return finish()
    record("C-1", "崩溃后弹出恢复对话框", "ok",
           "标题=%r 正文=%r" % (dlg.get("title"), (dlg.get("text") or "")[:60]))

    # ── C-2 按钮齐全且是中文 ──────────────────────────────────
    buttons = [b for b in (dlg.get("buttons") or []) if b]
    latin = [b for b in buttons if all(ord(c) < 128 for c in b.replace("&", ""))]
    record("C-2", "对话框按钮齐全且中文", "ok" if buttons and not latin else "fail",
           "按钮:%s" % json.dumps(buttons, ensure_ascii=False))

    # ── C-3 点第一个按钮能恢复 ────────────────────────────────
    target = buttons[0] if buttons else ""
    clicked = native.click_dialog_button(APP_PROCESS, target)
    if not clicked:
        record("C-3", "点按钮后恢复", "fail", "点不动按钮「%s」" % target)
        return finish()
    time.sleep(3.0)
    back = False
    for _ in range(20):
        time.sleep(1.5)
        try:
            probe = UI()
            ready = probe.ev("document.readyState")
            probe.close()
            if ready == "complete":
                back = True
                break
        except Exception:
            continue
    record("C-3", "点「%s」后界面恢复" % target, "ok" if back else "fail",
           "CDP 重新可用、页面 readyState=complete" if back
           else "20 轮重试内没能重新连上渲染进程")
    return finish()


def finish():
    ok = sum(1 for r in rows if r[2] == "ok")
    fail = sum(1 for r in rows if r[2] == "fail")
    print("\nP1-3 崩溃恢复:共 %d 项 — 通过 %d,待处理 %d" % (len(rows), ok, fail))
    for no, name, status, detail in rows:
        if status == "fail":
            print("  待处理 %s %s — %s" % (no, name, detail))
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
