#!/usr/bin/env python3
"""[fork-only] P1-1 Windows 菜单与中文化 [feat: upstream-sync-2026-08] 2026-08-14

对应 `6-windows-handoff.md` §二 P1-1。

## 交接文档在这条上的前提写错了,先纠正

原文说「Win 是**应用内菜单栏**(`autoHideMenuBar: true`)」。实测两件事:

1. `desktop/src/main/menu.ts` 的 `createMenu()` 第一行就是
   `if (process.platform !== "darwin") return` —— **Windows 上压根没有原生应用菜单**,
   `autoHideMenuBar: true` 隐藏的是一个根本不存在的东西。
2. Win 的菜单是**渲染层组件** `components/windows-app-menu.tsx`(自绘标题栏左上角的汉堡按钮),
   走 Kobalte DropdownMenu 画出来。

后果:这条用例**不能用 UIAutomation 验**(UIA 树里没有 MenuBar,实测返回空),
只能走 CDP。第一版按交接文档去敲 F10 抓 UIA 菜单,拿到空列表 ——
差一点就记成「菜单丢了」这种假缺陷。

跑法:`DeskFox 本地版` 带 --remote-debugging-port=9222 起着。
    python packages/branding/smoke/win_p1_menu.py
"""
import json
import re
import sys
import time

from uiprobe import UI, ProbeError

rows = []

# 允许出现的英文:产品名 / 技术词 / 快捷键记号。除此之外的连续拉丁词都要报出来人工确认。
ALLOWED_LATIN = re.compile(
    r"^(DeskFox|OpenCode|GitHub|URL|PDF|JSON|MCP|LSP|AI|IM|Ctrl|Alt|Shift|Enter|Esc|Tab|Del|"
    r"Backspace|Space|F\d{1,2}|[A-Z0-9]|Cmd|⌘|⌥|⇧|↑|↓|←|→|\+|/|,|\.|-)$"
)
LATIN_WORD = re.compile(r"[A-Za-z][A-Za-z'.-]{1,}")


def record(no, name, status, detail=""):
    rows.append((no, name, status, detail))
    print("  [%s] %s %s %s" % ({"ok": "OK  ", "skip": "SKIP", "fail": "FAIL"}[status],
                               no, name, ("— " + detail) if detail else ""))


def open_menu(ui):
    """打开自绘标题栏的应用菜单,**并确认真的打开了**。

    2026-08-14 实撞:上一轮跑完菜单还开着,这一轮再点触发器等于**把它关掉** ——
    于是报「点了按钮但没有 menuitem」,看着像功能坏了,其实只是没复位。
    所以先 Escape 复位,再点开,再校验;没开就重试一次。
    """
    for attempt in range(2):
        ui.key("Escape", "Escape", 27)
        time.sleep(0.4)
        trig = _find_trigger(ui)
        if not trig:
            return None
        ui.click_element(trig, "应用菜单按钮")
        time.sleep(1.0)
        if menu_items(ui):
            return trig
        print("[menu] 第 %d 次点击后没出菜单项,重试" % (attempt + 1), file=sys.stderr)
    return None


def _find_trigger(ui):
    trig = ui.find_element(label="菜单") or ui.find_element(selector='[aria-haspopup="menu"]')
    if not trig:
        # aria-label 走 i18n,可能不是「菜单」二字 —— 回退到标题栏最左的图标按钮
        trig = ui.ev("""
        (() => { const b = [...document.querySelectorAll('button')].find(e => {
            const r = e.getBoundingClientRect();
            return r.y < 48 && r.x < 60 && r.width > 12 && r.height > 12; });
          if (!b) return null; const r = b.getBoundingClientRect();
          return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
                   cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2),
                   right:Math.round(r.right), bottom:Math.round(r.bottom),
                   label: b.getAttribute('aria-label') }; })()
        """)
    return trig


def menu_items(ui):
    """读当前展开的菜单项(Kobalte 用 role=menuitem / menuitemcheckbox / 子菜单 trigger)。"""
    return ui.ev("""
    (() => [...document.querySelectorAll('[role^="menuitem"]')]
      .filter(e => e.getBoundingClientRect().height > 0)
      .map(e => ({ text: (e.textContent||'').trim().slice(0, 60),
                   // Kobalte 给的是 aria-haspopup="true",**不是** "menu"。
                   // 第一版写死判 === 'menu' → 全部 expandable=false → 一个子菜单都没展开,
                   // 而 M-3「无英文残留」照样报绿(只验了 6 个顶层词)。典型假绿,已加 M-2 硬闸拦。
                   expandable: !!e.getAttribute('aria-haspopup'),
                   expanded: e.getAttribute('aria-expanded') === 'true',
                   x: Math.round(e.getBoundingClientRect().x),
                   y: Math.round(e.getBoundingClientRect().y),
                   cx: Math.round(e.getBoundingClientRect().x + e.getBoundingClientRect().width/2),
                   cy: Math.round(e.getBoundingClientRect().y + e.getBoundingClientRect().height/2) })))()
    """) or []


def suspicious_latin(texts):
    out = []
    for t in texts:
        for w in LATIN_WORD.findall(t):
            if not ALLOWED_LATIN.match(w):
                out.append((t, w))
    return out


def main():
    ui = UI()
    try:
        geo = ui.window_geometry()
        print("窗口: 视口 %sx%s | 平台 %s\n" % (geo["viewport"]["w"], geo["viewport"]["h"], geo.get("platform")))

        # ── M-0 前提:Win 上确实没有原生菜单(纠正交接文档的前提)───
        native_menu = ui.native.menu_bar("DeskFox 本地版") if hasattr(ui.native, "menu_bar") else []
        record("M-0", "Win 无原生菜单栏(菜单在渲染层)", "ok" if not native_menu else "fail",
               "UIA MenuBar=%d 个 —— createMenu() 对非 darwin 直接 return,符合预期"
               % len(native_menu or []))

        # ── M-1 应用菜单能打开 ────────────────────────────────
        trig = open_menu(ui)
        if not trig:
            record("M-1", "应用菜单可打开", "fail", "标题栏找不到菜单触发按钮")
            return finish()
        top = menu_items(ui)
        if not top:
            record("M-1", "应用菜单可打开", "fail", "点了菜单按钮但没有 role=menuitem 出现")
            return finish()
        record("M-1", "应用菜单可打开", "ok", "顶层 %d 项:%s"
               % (len(top), " / ".join(i["text"] for i in top)))

        # ── M-2 顶层逐个展开,收集全部子项 ─────────────────────
        all_texts = [i["text"] for i in top]
        expandable = [i for i in top if i["expandable"]]
        expanded, failed = 0, []
        for item in expandable:
            fresh = menu_items(ui)
            match = next((f for f in fresh if f["text"] == item["text"]), None)
            if not match:
                failed.append(item["text"])
                continue
            try:
                ui.assert_in_viewport(match, "菜单项「%s」" % item["text"])
            except ProbeError:
                failed.append(item["text"] + "(超出视口)")
                continue
            # Kobalte 子菜单靠 hover 展开;只 click 会把菜单整个关掉。先移上去停一下再点。
            ui.send("Input.dispatchMouseEvent",
                    {"type": "mouseMoved", "x": match["cx"], "y": match["cy"]})
            time.sleep(0.9)
            subs = [s["text"] for s in menu_items(ui) if s["text"] not in all_texts]
            if not subs:
                ui.click(match["cx"], match["cy"])
                time.sleep(0.9)
                subs = [s["text"] for s in menu_items(ui) if s["text"] not in all_texts]
            if subs:
                expanded += 1
                all_texts.extend(subs)
            else:
                failed.append(item["text"] + "(展开后无新项)")
        # 硬闸:一个子菜单都没展开时,后面的中文化/快捷键检查等于只验了 6 个顶层词 ——
        # 那种「通过」是假绿,必须在这里就判失败,不能让它顺着流下去。
        if expandable and expanded == 0:
            record("M-2", "顶层菜单逐个展开", "fail",
                   "%d 个可展开项一个都没展开 —— 后续中文化/快捷键检查不可信" % len(expandable))
        else:
            record("M-2", "顶层菜单逐个展开", "ok" if not failed else "fail",
                   "展开 %d/%d,累计 %d 条文案%s"
                   % (expanded, len(expandable), len(all_texts),
                      (";展不开:" + ",".join(failed)) if failed else ""))

        # ── M-3 中文化:不该有英文残留 ─────────────────────────
        bad = suspicious_latin(all_texts)
        record("M-3", "菜单文案无英文残留", "ok" if not bad else "fail",
               "全部中文(%d 条)" % len(all_texts) if not bad
               else "疑似英文 %d 处:%s" % (len(bad), "; ".join("%s→%s" % (t, w) for t, w in bad[:8])))

        # ── M-4 快捷键按 Win 习惯(Ctrl 而非 Cmd)────────────────
        joined = " ".join(all_texts)
        mac_marks = [m for m in ("⌘", "⌥", "⇧", "Cmd", "Command") if m in joined]
        has_ctrl = "Ctrl" in joined
        record("M-4", "快捷键用 Ctrl 而非 Cmd", "ok" if not mac_marks else "fail",
               ("出现 Ctrl 记号" if has_ctrl else "未见任何快捷键记号(菜单可能不显示快捷键)")
               if not mac_marks else "出现 macOS 记号:%s" % ",".join(mac_marks))

        ui.key("Escape", "Escape", 27)
        time.sleep(0.4)
    finally:
        try:
            ui.close()
        except Exception:
            pass
    return finish()


def finish():
    ok = sum(1 for r in rows if r[2] == "ok")
    skip = sum(1 for r in rows if r[2] == "skip")
    fail = sum(1 for r in rows if r[2] == "fail")
    print("\nP1-1:共 %d 项 — 通过 %d,跳过 %d,待处理 %d" % (len(rows), ok, skip, fail))
    for no, name, status, detail in rows:
        if status == "fail":
            print("  待处理 %s %s — %s" % (no, name, detail))
    return 1 if fail else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ProbeError as e:
        print("\n前提不成立,已中止(这不是缺陷,是环境没准备好):\n  %s" % e)
        sys.exit(2)
