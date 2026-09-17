#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Win 侧 S6.5 GUI 真机验证 — release-closeout-2026-09 回验。

[fork-only] 对照 spec §5.2 S6.5,在 Windows 真产物(local 档)上用 CDP 真实鼠标事件复验。
Mac 侧已验过同样条目;两份构建脚本与两套 native 行为历史上漂移过,故两平台都要验。

踩过的坑(留给下次):
  ① **文件 tab 条是横向滚动的**,目标 tab 常在视口外(实测 x = -1413),
     直接按 getBoundingClientRect 的坐标点会全部落空且毫无报错 —— 必须先 scrollIntoView
     再重读坐标,并断言坐标确实落在视口内。
  ② **点非激活 tab 的 × 必须先 hover 到 tab 本体**:直接把光标「瞬移」到 × 上再点,
     14→14 毫无反应、也不报错;先 mouseMoved 到 tab 本体、再 mouseMoved 到 ×、再点,才关得掉
     (三变体对照实测:JS 合成 click 不行、带 buttons 的完整按下不行、唯独「先过 tab 本体」行)。
     真人操作本来就会先划过 tab,所以这是**测试手法**问题不是缺陷 —— 但踩上去时表现为「功能坏了」,
     记死:凡 hover 才出现/才可点的控件,CDP 必须模拟真实移动路径,不能瞬移。
  ③ × 的 hover 反馈是 index.css 里挂在**属性选择器**上的规则,不是 Tailwind class ——
     读 className 验不出来,只能真 hover 后比对 getComputedStyle。

跑法:先用 --remote-debugging-port=9222 起「DeskFox 本地版.exe」,再 PYTHONUTF8=1 python win_s65_gui.py
"""
import json, sys, time, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import CDP  # 复用同目录 CDP 封装(只用真实 Input 事件,不合成键盘事件)

R = []
def rec(name, ok, detail=""):
    R.append({"name": name, "ok": ok, "detail": detail})
    print(("  [PASS] " if ok else "  [FAIL] ") + name + ("  " + detail if detail else ""))

FILE_TABS = ('[...document.querySelectorAll(\'[data-slot="tabs-trigger"]\')]'
             '.filter(t => (t.getAttribute("data-value")||"").startsWith("file://"))')

def point_of(cdp, expr, scroll=True):
    """把元素滚进视野后取中心坐标。

    三道校验缺一不可(全是实测踩出来的):
      · 元素存在且有尺寸
      · 中心点落在视口内           —— tab 条横向滚动,实测取到过 x = -1413(坑 ①)
      · 该点最顶层元素就是它(或其后代)—— tab 条左侧有 sticky 元素会盖住靠左的 tab,
        坐标合法但点下去打在遮挡物上,表现为「点了没反应」且零报错
    任一不满足返回 None,并把原因打出来,避免再把遮挡误判成功能缺陷。
    """
    if scroll:
        cdp.ev("(() => { const e = %s; if (e) e.scrollIntoView({block:'nearest', inline:'center'}); })()" % expr)
        time.sleep(0.4)
    r = cdp.ev("""(() => {
      const e = %s; if (!e) return {ok:false, why:'元素不存在'};
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return {ok:false, why:'尺寸为 0'};
      const x = r.left + r.width/2, y = r.top + r.height/2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight)
        return {ok:false, why:'中心点在视口外 (' + Math.round(x) + ',' + Math.round(y) + ')'};
      const top = document.elementFromPoint(x, y);
      if (!top || !(top === e || e.contains(top) || top.contains(e)))
        return {ok:false, why:'该点被遮挡,顶层是 ' + (top ? (top.getAttribute('data-slot') || top.tagName) : 'null')};
      return {ok:true, x, y};
    })()""" % expr)
    if not r or not r.get("ok"):
        print("     (取点失败:%s)" % (r or {}).get("why", "未知"))
        return None
    return r

def hover_click(cdp, pt, via=None):
    """真实移动路径 + 点击。via 给出必须先划过的中转点(坑 ②)。"""
    if via:
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": via["x"], "y": via["y"]})
        time.sleep(0.35)
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": pt["x"], "y": pt["y"]})
    time.sleep(0.3)
    cdp.click(pt["x"], pt["y"])
    time.sleep(1.0)

ACTIVE_TAB = ("(() => { const tabs = %s;"
              " return tabs.find(t => t.getAttribute('aria-selected')==='true' || t.getAttribute('data-state')==='active'); })()") % FILE_TABS
INACTIVE_TAB = ("(() => { const tabs = %s;"
                " return tabs.find(t => !(t.getAttribute('aria-selected')==='true' || t.getAttribute('data-state')==='active')); })()") % FILE_TABS

def ensure_tabs(cdp, want=4):
    """前置准备:真实点击文件树,确保预览区打开且至少有 want 个文件 tab。

    必须自带这一步 —— T-C(点 tab 本体收起预览区)会把 tab 清空,脚本不可依赖上一轮遗留状态。
    只点文件不点文件夹(路径以分隔符结尾的是文件夹)。
    """
    for _ in range(12):
        st = tab_state(cdp)
        if st and st["count"] >= want:
            return st
        opened = False
        names = cdp.ev("JSON.stringify([...document.querySelectorAll('[data-tree-path]')]"
                       ".map(e => e.getAttribute('data-tree-path'))"
                       ".filter(p => p && !/[\\/]$/.test(p)).slice(0, 30))")
        for name in json.loads(names or "[]"):
            cur = tab_state(cdp)
            if cur and cur["count"] >= want:
                return cur
            sel = ("[...document.querySelectorAll('[data-tree-path]')]"
                   ".find(e => e.getAttribute('data-tree-path') === %s)" % json.dumps(name))
            pt = point_of(cdp, sel)
            if not pt:
                continue
            hover_click(cdp, pt)
            opened = True
        if not opened:
            break
    return tab_state(cdp)

def tab_state(cdp):
    return cdp.ev("""(() => {
      const tabs = %s;
      const act = tabs.find(t => t.getAttribute('aria-selected') === 'true' || t.getAttribute('data-state') === 'active');
      const c = document.querySelector('[data-slot="tabs-content"][data-state="active"]')
             || document.querySelector('[data-slot="tabs-content"]');
      const r = c && c.getBoundingClientRect();
      return {
        count: tabs.length,
        texts: tabs.map(t => (t.textContent||'').trim().slice(0,22)),
        active: act ? (act.textContent||'').trim().slice(0,22) : null,
        panelH: r ? Math.round(r.height) : 0,
      };
    })()""" % FILE_TABS)

ACTIVE_CLOSE = ("(() => { const tabs = %s;"
                " const act = tabs.find(t => t.getAttribute('aria-selected')==='true' || t.getAttribute('data-state')==='active');"
                " return act && act.parentElement.querySelector('[data-slot=\"tabs-trigger-close-button\"]'); })()") % FILE_TABS
INACTIVE_CLOSE = ("(() => { const tabs = %s;"
                  " const non = tabs.find(t => !(t.getAttribute('aria-selected')==='true' || t.getAttribute('data-state')==='active'));"
                  " return non && non.parentElement.querySelector('[data-slot=\"tabs-trigger-close-button\"]'); })()") % FILE_TABS

def main():
    cdp = CDP(); cdp.connect(); cdp.clear_events()

    print("== 前置:确保预览区打开且有足够文件 tab ==")
    st0 = ensure_tabs(cdp, 4)
    print("   就绪:", json.dumps(st0, ensure_ascii=False))
    if not st0 or st0["count"] < 2:
        rec("前置准备", False, "开不出足够的文件 tab,后续条目无法验证")
        return finish(cdp)
    rec("前置准备", True, "%d 个文件 tab,激活 '%s'" % (st0["count"], st0["active"]))

    print("== T-A REQ-130:点【激活】tab 的 × —— 只关这一个,预览区不收 ==")
    before = tab_state(cdp)
    print("   关前:", json.dumps(before, ensure_ascii=False))
    via = point_of(cdp, ACTIVE_TAB)
    pt = point_of(cdp, ACTIVE_CLOSE, scroll=False)
    if not pt:
        rec("T-A REQ-130", False, "激活 tab 的 × 滚进视野后仍取不到可点坐标")
    else:
        hover_click(cdp, pt, via=via)
        after = tab_state(cdp)
        print("   关后:", json.dumps(after, ensure_ascii=False))
        rec("T-A 只关一个", after["count"] == before["count"] - 1, "%d → %d" % (before["count"], after["count"]))
        rec("T-A 关掉的确实是激活那个", before["active"] not in after["texts"], "'%s' 已不在" % before["active"])
        rec("T-A 预览区未被收起", after["panelH"] > 50, "content 高 %d(收起则为 0)" % after["panelH"])
        rec("T-A 递补到相邻 tab", after["active"] and after["active"] != before["active"], "新激活 '%s'" % after["active"])

    print("== T-B 回归锚:关【非激活】tab —— 本来就不该收起,也不该换激活项 ==")
    # ⚠️ 既有缺陷(非本批引入,详见 3-changelog「Win 侧另查出的既有问题」):
    #    按下【非激活】tab 的 × 时,tab 条会把该 tab 滚进视野(实测 scrollLeft 0→97、× 从 x=488 滑到 391),
    #    于是 mouseup 落在别的元素上,click 冒到 tabs-list —— 第一次点击整个丢失,要点第二次才关得掉。
    #    只要开 ≥3 个文件 tab(421px 侧栏里就会超宽)就必现,与是否人为滚动无关。
    #    这里用重试把它绕开,好让本条回归锚验的是「关非激活 tab 不会收起预览区」这件事本身。
    b2 = tab_state(cdp)
    closed, tries = False, 0
    for tries in range(1, 4):
        via2 = point_of(cdp, INACTIVE_TAB)
        pt2 = point_of(cdp, INACTIVE_CLOSE, scroll=False)
        if not pt2:
            break
        hover_click(cdp, pt2, via=via2)
        if tab_state(cdp)["count"] == b2["count"] - 1:
            closed = True
            break
    a2 = tab_state(cdp)
    rec("T-B 关非激活 tab 确实少一个", closed, "%d → %d(第 %d 次点击生效,见上方既有缺陷说明)" % (b2["count"], a2["count"], tries))
    rec("T-B 激活项不变、预览区仍开", a2["active"] == b2["active"] and a2["panelH"] > 50,
        "激活仍为 '%s',content 高 %d" % (a2["active"], a2["panelH"]))

    print("== T-D tab × 的 hover 反馈(本批新增,index.css 属性选择器规则)==")
    x_sel = "document.querySelector('[data-slot=\"tabs-trigger-close-button\"]')"
    ptx = point_of(cdp, x_sel)
    read = ("(() => { const b = %s; if (!b) return null; const cs = getComputedStyle(b);"
            " return {bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius,"
            " trans: cs.transitionProperty}; })()" % x_sel)
    if not ptx:
        rec("T-D × hover", False, "取不到 × 坐标")
    else:
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 3, "y": 3}); time.sleep(0.35)
        base = cdp.ev(read)
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": ptx["x"], "y": ptx["y"]}); time.sleep(0.5)
        hov = cdp.ev(read)
        if not base or not hov:
            rec("T-D × hover", False, "读不到计算样式")
        else:
            rec("T-D hover 时背景/前景真的变化", base["bg"] != hov["bg"] or base["color"] != hov["color"],
                "常态 bg=%s → hover bg=%s" % (base["bg"], hov["bg"]))
            rec("T-D 圆角与过渡已生效", hov["radius"] not in ("0px", "") and "background-color" in (hov["trans"] or ""),
                "radius=%s transition=%s" % (hov["radius"], hov["trans"]))

    print("== T-C REQ-111 回归锚:点【激活 tab 本体】仍应收起预览区 ==")
    b3 = tab_state(cdp)
    pt3 = point_of(cdp, ("(() => { const tabs = %s;"
                         " return tabs.find(t => t.getAttribute('aria-selected')==='true' || t.getAttribute('data-state')==='active'); })()") % FILE_TABS)
    if not pt3:
        rec("T-C REQ-111", False, "取不到激活 tab 本体坐标")
    else:
        hover_click(cdp, pt3); time.sleep(0.5)
        a3 = tab_state(cdp)
        rec("T-C 点 tab 本体 → 预览区收起(REQ-111 未被本批破坏)", a3["panelH"] <= 50 or a3["count"] == 0,
            "content 高 %d,tab 数 %d → %d" % (a3["panelH"], b3["count"], a3["count"]))
        # 复位:真实点击文件树里的文件重新打开预览区(JS 合成 .click() 在这套 UI 上不生效,见坑 ②)
        tree = point_of(cdp, "document.querySelector('[data-tree-path]:not([data-tree-path$=\"\\\\\"])')")
        if tree:
            hover_click(cdp, tree)

    ev = cdp.take_events()
    errs = [e for e in ev if e["kind"] in ("exception", "console.error")]
    rec("全程无渲染异常 / console.error", len(errs) == 0, json.dumps(errs, ensure_ascii=False)[:300] if errs else "")
    bad = [r for r in R if not r["ok"]]
    print("\n== 小结:%d/%d 通过 ==" % (len(R) - len(bad), len(R)))
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
