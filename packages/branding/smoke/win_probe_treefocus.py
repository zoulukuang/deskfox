#!/usr/bin/env python3
"""[fork-only] 文件树点击后焦点归属的复现率实测 [feat: upstream-sync-2026-08] 2026-08-14

起因:`win_p2_general.py` 的 G-1 两次跑出**相反结论**(一次 activeElement=button 在树内、
一次 =body 不在树内)。R5 不允许对 flaky 用 retry 掩盖,所以先把复现率量出来,再谈修不修。

量法:连点 N 个文件行,每次读 `document.activeElement` 是否落在文件树容器内。
同时记录**该行是否本来就是 active**(已打开的文件再点一次,走的分支不同)。

跑法:python packages/branding/smoke/win_probe_treefocus.py [次数]
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


def main():
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    ui = UI()
    try:
        ui.key("Escape", "Escape", 27)
        time.sleep(0.5)
        files = ui.ev(LIST_FILES) or []
        if not files:
            print("文件树里没有可见的文件行 —— 先打开一个项目并展开目录")
            return 2
        print("可点文件 %d 个,跑 %d 轮\n" % (len(files), rounds))

        results = []
        for i in range(rounds):
            f = files[i % len(files)]
            was_active = ui.ev("""
            (() => { const want = %s;
              const el = [...document.querySelectorAll('[data-tree-path]')]
                .find(e => e.getAttribute('data-tree-path') === want);
              if (!el) return null;
              return el.className.toString().includes('bg-surface-base-active'); })()
            """ % json.dumps(f["p"]))
            ui.click(f["cx"], f["cy"])
            time.sleep(1.3)
            fs = ui.focus_state('[data-component="filetree"]')
            in_tree = bool(fs and fs.get("inContainer"))
            results.append({"path": f["p"], "wasActive": was_active,
                            "tag": fs.get("tag"), "inTree": in_tree})
            print("  %-26s 点前已选=%-5s → activeElement=%-8s 在树内=%s"
                  % (f["p"][:26], was_active, fs.get("tag"), in_tree))

        ok = sum(1 for r in results if r["inTree"])
        print("\n焦点落入文件树:%d/%d" % (ok, len(results)))

        # 按「点前是否已是 active」分组 —— 这是最可能的分野:
        # 已 active 的行再点,不会触发 Tooltip 包裹分支的重挂,补焦点逻辑走的路不同。
        for flag in (True, False):
            grp = [r for r in results if r["wasActive"] is flag]
            if grp:
                g_ok = sum(1 for r in grp if r["inTree"])
                print("  点前%s已选中:%d/%d 落入树内"
                      % ("" if flag else "未", g_ok, len(grp)))
        return 0 if ok == len(results) else 1
    finally:
        ui.close()


if __name__ == "__main__":
    sys.exit(main())
