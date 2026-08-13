#!/usr/bin/env python3
"""[fork-only] uiprobe 工具包自检 [feat: ui-probe-toolkit] 2026-08-13

工具本身没验过就是新的假绿源。本脚本对每项能力做**正反两向**验证:
能力在该报警时报警(反向),在该通过时通过(正向)。

跑法:DeskFox 本地版带 --remote-debugging-port=9222 起着,然后
    python3 packages/branding/smoke/uiprobe_selftest.py
"""
import json
import sys

from uiprobe import UI, ProbeError

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name: str, ok: bool, detail: str = ""):
    results.append((PASS if ok else FAIL, name, detail))
    print("  [%s] %s %s" % (PASS if ok else FAIL, name, ("— " + detail) if detail else ""))


def main():
    ui = UI()
    try:
        print("== 1. 窗口/屏幕几何 ==")
        geo = ui.window_geometry()
        check("viewport 有效", bool(geo["viewport"]["w"] > 0 and geo["viewport"]["h"] > 0),
              "%sx%s dpr=%s" % (geo["viewport"]["w"], geo["viewport"]["h"], geo["viewport"]["dpr"]))
        check("能拿到窗口屏幕坐标", geo.get("window") is not None,
              json.dumps(geo.get("window"), ensure_ascii=False))
        check("能判断所在屏幕", geo.get("on_display") is not None,
              json.dumps(geo.get("on_display"), ensure_ascii=False))

        print("== 2. 元素定位(多策略)==")
        el = ui.find_element(label="切换文件树")
        check("按 aria-label 命中", el is not None, json.dumps(el, ensure_ascii=False)[:110] if el else "")
        miss = ui.find_element(label="绝不存在的按钮名字xyz", require_visible=False)
        check("未命中时返回 None(并已自动截图)", miss is None)

        print("== 3. 视口断言(反向验证:越界必须拦下)==")
        if el:
            try:
                ui.assert_in_viewport(el, "切换文件树")
                check("视口内元素通过断言", True)
            except ProbeError as e:
                check("视口内元素通过断言", False, str(e)[:80])
        bogus = {"cx": -1623, "cy": 65, "x": -1700, "y": 60, "right": -1500, "bottom": 80}
        try:
            ui.assert_in_viewport(bogus, "伪造的副屏坐标")
            check("越界坐标被拦下", False, "居然通过了 —— 断言失效")
        except ProbeError:
            check("越界坐标被拦下", True, "x=-1623 触发 ProbeError,正是三连假绿的元凶")

        print("== 4. 遮挡检测 ==")
        if el:
            occ = ui.is_occluded(el)
            hit_self = any((h.get("text") or "") or (h.get("cls") or "") for h in occ["hits"])
            check("能对元素做命中测试", hit_self, json.dumps(occ["hits"][0], ensure_ascii=False)[:90])

        print("== 5. 溢出检测 ==")
        ov = ui.overflow_of("main")
        check("能测容器溢出", ov is not None,
              ("overflowX=%s 越界子元素=%d" % (ov.get("overflowX"), len(ov.get("children") or []))) if ov else "")

        print("== 6. 焦点探测 ==")
        fs = ui.focus_state('[data-component="filetree"]')
        check("能读焦点位置", fs is not None, json.dumps(fs, ensure_ascii=False)[:100])

        print("== 7. CSS 变量读取(可靠指标)==")
        mr = ui.css_var("--main-right")
        check("能读 --main-right", mr is not None, "值=%s(>0 表示右侧栏展开)" % mr)

        print("== 8. 像素级验收 ==")
        p1 = ui.shot("selftest-full")
        check("整页截图", bool(p1), p1)
        p2 = ui.zoom_shot("selftest-zoom", 0, 0, 60, 120, scale=6)
        check("区域放大截图", bool(p2), p2)
        col = ui.sample_column(300, 120, 320, step=40)
        check("竖线采样", bool(col), "采样 %d 点" % len(col))

    finally:
        ui.close()

    print()
    failed = [r for r in results if r[0] == FAIL]
    print("总计 %d 项,通过 %d,失败 %d" % (len(results), len(results) - len(failed), len(failed)))
    if failed:
        for _, name, detail in failed:
            print("  FAIL: %s %s" % (name, detail))
        sys.exit(1)
    print("uiprobe 工具包自检通过")


if __name__ == "__main__":
    main()
