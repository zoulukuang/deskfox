#!/usr/bin/env python3
"""[fork-only] CHECKLIST 第 2 组(主界面骨架)自动化执行 [feat: ui-probe-toolkit] 2026-08-13

覆盖 #15 / #17 / #18 / #20 / #21 —— 用 uiprobe 跑,每步带前提断言,不给假绿。
跑法:DeskFox 本地版带 --remote-debugging-port=9222 起着,然后
    python3 packages/branding/smoke/run_group2.py
"""
import json
import sys
import time

from uiprobe import UI, ProbeError

rows = []

TREE_PATHS = ("(() => [...document.querySelectorAll('[data-tree-path]')]"
              ".map(e => e.getAttribute('data-tree-path')))()")


def find_changes_tab(ui):
    """「N 更改」的 N 是动态的(不同项目不同数字),必须正则匹配而不是写死文案。"""
    return ui.ev("""
    (() => { const e = [...document.querySelectorAll('[role=tab],button')]
      .find(x => /^\\d+ 更改$/.test((x.textContent||'').trim()));
      if (!e) return null; const r = e.getBoundingClientRect();
      return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
               cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2),
               right:Math.round(r.right), bottom:Math.round(r.bottom),
               text:(e.textContent||'').trim() }; })()
    """)


# 三态结果:OK 通过 / SKIP 环境前提不满足(不是缺陷)/ FAIL 需处理
# 2026-08-13 教训:把「元素存在但未展开」「页面停在引导态」笼统报 FAIL,
# 会让人误以为功能坏了,反复排查后才发现是环境状态 —— 必须在结果里就分开。
def record(no, name, status, detail=""):
    rows.append((no, name, status, detail))
    tag = {"ok": "OK  ", "skip": "SKIP", "fail": "FAIL"}[status]
    print("  [%s] #%s %s %s" % (tag, no, name, ("— " + detail) if detail else ""))


def main():
    ui = UI()
    try:
        geo = ui.window_geometry()
        print("窗口: 视口 %sx%s | 屏幕坐标 x=%s | 在屏幕外=%s\n" % (
            geo["viewport"]["w"], geo["viewport"]["h"],
            (geo.get("window") or {}).get("x"), geo.get("offscreen")))

        # ── #15 文件树 tab「所有文件 / N 更改」互切 + 顺序 ──
        # 前提:必须先有一个打开的会话,否则整个 tab 条不渲染 —— 脚本自己把前提补上,
        # 而不是记成 SKIP 让人以为验过了。
        allf = ui.find_element(text="所有文件")
        if not allf:
            newsession = ui.find_element(label="新建会话")
            if newsession:
                ui.click_element(newsession, "新建会话")
                time.sleep(2.5)
                allf = ui.find_element(text="所有文件")

        changes = find_changes_tab(ui)
        if allf and changes:
            order_ok = allf["x"] < changes["x"]
            # 指标用**结构化的文件路径列表**,不用 innerText —— 后者会被同名文案污染
            before = ui.ev(TREE_PATHS)
            ui.click_element(changes, "更改 tab")
            time.sleep(1.5)
            changed = ui.ev(TREE_PATHS)
            ui.click_element(allf, "所有文件 tab")
            time.sleep(1.5)
            back = ui.ev(TREE_PATHS)

            # 「更改」视图必须是全量树的**真子集**且非空(它只列有 diff 的文件);
            # 切回后必须重新出现全量树里那些非改动文件。
            changed_set, all_set, back_set = set(changed or []), set(before or []), set(back or [])
            shrank = bool(changed_set) and len(changed_set) < len(all_set)
            restored = all_set.issubset(back_set)
            n = int(changes["text"].split()[0]) if changes["text"].split()[0].isdigit() else None
            # tab 上的数字应与「更改」视图里的**文件**条目数吻合(目录条目不算)
            files_in_changed = [p for p in (changed or []) if not p.endswith("/") and "." in p.rsplit("/", 1)[-1]]
            count_ok = (n is None) or (n == len(files_in_changed))
            record(15, "文件树 tab 互切 + 所有文件在左",
                   "ok" if (order_ok and shrank and restored and count_ok) else "fail",
                   "顺序 %s<%s | 全量 %d → 更改 %d(tab 标 %s)→ 切回恢复 %s"
                   % (allf["x"], changes["x"], len(all_set), len(changed_set), n, restored))
        else:
            record(15, "文件树 tab 互切", "skip",
                   "补开会话后仍无 tab —— 可能停在引导页,需人工确认")

        # ── #17 面板宽度:侧面板占位必须 == 聊天区让位(本次修的不变式)──
        ov = ui.overflow_of("main")
        if ov:
            record(17, "主区域无横向溢出(侧面板占位==聊天区让位)",
                   "ok" if (ov["overflowX"] <= 0 and not ov["children"]) else "fail",
                   "overflowX=%s 越界子元素=%d" % (ov["overflowX"], len(ov["children"])))
        else:
            record(17, "主区域溢出检测", "fail", "找不到 main")

        # ── #18 rail 项目图标切换 ──
        icons = ui.ev("""
        (() => [...document.querySelectorAll('[aria-label]')]
          .filter(e => { const r = e.getBoundingClientRect();
                         return r.x < 60 && r.width > 20 && r.height > 20 && r.y > 40; })
          .map(e => ({ label: e.getAttribute('aria-label'),
                       cx: Math.round(e.getBoundingClientRect().x + e.getBoundingClientRect().width/2),
                       cy: Math.round(e.getBoundingClientRect().y + e.getBoundingClientRect().height/2) }))
          .slice(0, 6))()
        """)
        record(18, "rail 项目图标存在", "ok" if icons else "fail",
               ",".join(i["label"] for i in (icons or [])[:4]))

        # ── #20 前进/返回导航按钮 ──
        back = ui.find_element(label="返回")
        fwd = ui.find_element(label="前进")
        record(20, "前进/返回按钮存在且在视口内", "ok" if (back and fwd) else "fail",
               "返回 x=%s 前进 x=%s" % (back["x"] if back else "?", fwd["x"] if fwd else "?"))

        # ── #21 toast 通知区存在且位置正确 ──
        # 2026-08-13 更正:本条原写成「通知面板(alt+T)打开/关闭」,是把第三方库
        # `solid-sonner` 的 Toaster 无障碍标签「Notifications (alt+T)」当成了产品功能
        # (§1.2 枚举 aria-label 时误收)。实际它是 **toast 容器**,alt+T 的作用是
        # 把焦点移到 toast 列表,没有「面板」可开;零条 toast 时 height=0 属正常。
        # 因此改为验真正该验的:容器在正确位置待命,而 toast 本身的弹出在第 3 组 #23 验。
        region = ui.ev("""
        (() => { const e = [...document.querySelectorAll('[aria-label]')]
          .find(x => /Notif/i.test(x.getAttribute('aria-label')||''));
          if (!e) return null; const r = e.getBoundingClientRect();
          return { label: e.getAttribute('aria-label'), x: Math.round(r.x), y: Math.round(r.y),
                   w: Math.round(r.width), h: Math.round(r.height),
                   vw: window.innerWidth, vh: window.innerHeight }; })()
        """)
        if region:
            # 容器该在视口内待命(sonner 默认右下角),宽度有效;高度 0 = 当前无 toast,正常
            placed = 0 <= region["x"] < region["vw"] and 0 <= region["y"] <= region["vh"] and region["w"] > 0
            record(21, "toast 通知区就位(alt+T 是它的无障碍热键,非面板)",
                   "ok" if placed else "fail",
                   "%s @ (%s,%s) %sx%s,视口 %sx%s"
                   % (region["label"], region["x"], region["y"], region["w"], region["h"],
                      region["vw"], region["vh"]))
        else:
            record(21, "toast 通知区", "fail", "DOM 中找不到 toast 容器")

    except ProbeError as e:
        print("\n中止:%s" % e)
        sys.exit(1)
    finally:
        ui.close()

    print()
    ok = [r for r in rows if r[2] == "ok"]
    skip = [r for r in rows if r[2] == "skip"]
    bad = [r for r in rows if r[2] == "fail"]
    print("第 2 组:共 %d 项 — 通过 %d,跳过 %d(环境前提不满足),待处理 %d"
          % (len(rows), len(ok), len(skip), len(bad)))
    for no, name, _, detail in skip:
        print("  跳过 #%s %s — %s" % (no, name, detail))
    for no, name, _, detail in bad:
        print("  待处理 #%s %s — %s" % (no, name, detail))


if __name__ == "__main__":
    main()
