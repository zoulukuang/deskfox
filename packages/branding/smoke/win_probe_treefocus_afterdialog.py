#!/usr/bin/env python3
"""[fork-only] 「关弹窗后第一次点文件树」的焦点归属 [feat: upstream-sync-2026-08] 2026-08-14

`win_probe_treefocus.py` 连点 12 次全部落入树内(12/12),但 `win_p2_general.py` 的 G-1
曾单次报出 activeElement=body。两者唯一的环境差别:那次 G-1 之前刚**打开又 Escape 关掉**
一个模态弹窗(连接提供商)。

假设:Kobalte 的 Dialog 关闭时会把焦点**还给触发器**,这个还原是异步的,
可能晚于文件树行的 `requestAnimationFrame` 补焦点,于是把刚补好的焦点又抢走。

本脚本就验这一条:开弹窗 → Escape → 立刻点文件树行 → 看焦点在哪。
跑 N 轮取复现率 —— 一次现象说明不了问题,R5 要的是「修或移除」的判断依据。

跑法:python packages/branding/smoke/win_probe_treefocus_afterdialog.py [轮数]
"""
import json
import sys
import time

from uiprobe import UI

LIST_FILES = """
(() => [...document.querySelectorAll('[data-tree-path]')]
  .filter(e => {
    const p = e.getAttribute('data-tree-path') || '';
    const isDir = p.endsWith('/') || p.endsWith('\\\\');
    return !isDir && e.getBoundingClientRect().height > 0;
  })
  .map(e => {
    const r = e.getBoundingClientRect();
    return { p: e.getAttribute('data-tree-path'),
             cx: Math.round(r.x + r.width / 2),
             cy: Math.round(r.y + r.height / 2) };
  }))()
"""


def open_and_close_dialog(ui):
    """走命令面板开「连接提供商」弹窗,再 Escape 关掉 —— 复刻 G-1 失败那次的前置状态。"""
    ui.key("Escape", "Escape", 27)
    time.sleep(0.4)
    ui.key("k", "KeyK", 75, ctrl=True)
    time.sleep(1.2)
    ui.type_text("连接提供商")
    time.sleep(1.5)
    ui.key("Enter", "Enter", 13)
    time.sleep(2.5)
    opened = bool(ui.ev("""
    (() => [...document.querySelectorAll('[role=dialog],[data-slot=dialog-content]')]
      .some(e => e.getBoundingClientRect().height > 0))()
    """))
    ui.key("Escape", "Escape", 27)
    time.sleep(0.8)
    return opened


def main():
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    delay = float(sys.argv[2]) if len(sys.argv) > 2 else 0.6
    ui = UI()
    try:
        files = ui.ev(LIST_FILES) or []
        if not files:
            print("文件树里没有可见文件行 —— 先打开项目并展开目录")
            return 2
        print("跑 %d 轮:开弹窗 → Escape → 等 %.1fs → 点文件树\n" % (rounds, delay))

        rows = []
        for i in range(rounds):
            opened = open_and_close_dialog(ui)
            time.sleep(delay)
            f = files[i % len(files)]
            ui.click(f["cx"], f["cy"])
            time.sleep(1.3)
            fs = ui.focus_state('[data-component="filetree"]')
            in_tree = bool(fs and fs.get("inContainer"))
            rows.append(in_tree)
            print("  轮 %d 弹窗开过=%-5s 点 %-22s → activeElement=%-8s 在树内=%s"
                  % (i + 1, opened, f["p"][:22], fs.get("tag"), in_tree))

        ok = sum(1 for r in rows if r)
        print("\n关弹窗后点文件树,焦点落入树内:%d/%d" % (ok, len(rows)))
        return 0 if ok == len(rows) else 1
    finally:
        ui.close()


if __name__ == "__main__":
    sys.exit(main())
