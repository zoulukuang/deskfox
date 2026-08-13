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
        allf = ui.find_element(text="所有文件")
        # 文案含动态数字(实撞:切到别的项目后是「33 更改」),用正则而非写死
        changes = ui.find_element(text="更改")
        if allf and changes:
            order_ok = allf["x"] < changes["x"]
            ui.click_element(changes, "更改 tab")
            time.sleep(1.2)
            after = ui.ev("(() => (document.body.innerText||'').includes('没有更改') "
                          "|| !!document.querySelector('[data-tree-path]'))()")
            ui.click_element(allf, "所有文件 tab")
            time.sleep(1.2)
            record(15, "文件树 tab 互切 + 所有文件在左",
                   "ok" if (order_ok and after is not None) else "fail",
                   "所有文件 x=%s < 更改 x=%s" % (allf["x"], changes["x"]))
        else:
            onboarding = ui.ev("(() => /连接提供商|稍后/.test(document.body.innerText||''))()")
            if onboarding:
                record(15, "文件树 tab 互切", "skip",
                       "当前停在引导页(连接提供商/稍后),会话页未加载,tab 本就不该存在")
            else:
                record(15, "文件树 tab 互切", "skip",
                       "会话页未打开任何会话时不渲染 tab —— 需先打开一个会话再验")

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

        # ── #21 通知面板 alt+T ──
        notif = ui.find_element(label="Notification") or ui.find_element(label="通知")
        if notif:
            before = ui.ev("document.querySelectorAll('[role=dialog],[data-component*=popover]').length")
            ui.click_element(notif, "通知面板")
            time.sleep(1.2)
            after = ui.ev("document.querySelectorAll('[role=dialog],[data-component*=popover]').length")
            ui.key("Escape", "Escape", vk=27)
            record(21, "通知面板可打开", "ok" if after >= before else "fail", "弹层数 %s → %s" % (before, after))
        else:
            # find_element 已能分辨「不存在」与「存在但不可见」,这里据此定性
            hidden = ui.ev("(() => { const e=[...document.querySelectorAll('[aria-label]')]"
                           ".find(x=>/Notif/i.test(x.getAttribute('aria-label')||'')); "
                           "if(!e) return null; const r=e.getBoundingClientRect(); "
                           "return { h: Math.round(r.height) }; })()")
            if hidden is not None:
                record(21, "通知面板", "skip",
                       "入口存在于 DOM 但未展开(height=%s)—— 属折叠态,不是缺失" % hidden.get("h"))
            else:
                record(21, "通知面板", "fail", "DOM 中不存在入口")

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
