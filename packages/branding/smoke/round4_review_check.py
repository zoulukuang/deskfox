# [fork-only] 第四轮 code-review 修复的真产物验证(CDP 驱动)
#
# 对应 docs/features/release-closeout-2026-09/3-changelog.md §十一。
#
# ## 本脚本验什么 / 不验什么(边界写死,免得下次把绿灯读成"三条都真机过了")
#
# 验(GUI 可达):
#   A. 引用卡的**历史往返保真** —— 加卡 → 发送 → ↑ 翻历史 → 卡片原样回来、卡面文字不变。
#      这条是本批改动最大的回归面:`PromptHistoryComment.id` 从必填改成可选、
#      两处回填侧新增 `item.id` 判据,一旦写错,**正常的引用卡会在翻历史后丢失或变形**。
#   B. 点历史找回的卡不崩、不无故多开空白 tab。
#
# 不验(GUI 不可达,由单测 / 结构闸覆盖):
#   · 无 commentID 卡的去重(现象 A):唯一产生它的真实入口是命令「将所选内容添加到上下文」,
#     而它 gated on `file.selectedLines` —— 需要代码/diff 视图的行选区 UI(markdown 预览区的
#     纯文本选中不设这个状态);另一入口「附加文件」走 native 文件选择框,CDP 不能驱动。
#     该现象由 context/prompt-state.test.ts 的端到端闸覆盖(加卡 → 快照 → 回填 → 再加同一选区)。
#   · 反向对账(②):触发条件是"后端半死 + 停止兜底写 idle + 会话被 LRU 挤出",GUI 造不出来;
#     由 global-sync/stale-busy.test.ts 的两段式闭环 + server-sync 结构闸覆盖。
#   · 队列 toast 文案(③):要后端半死并等满 120s;由 pages/session-queued-toast.test.ts 的
#     结构闸 + 字典不变量覆盖,产物侧另有 bundle 扫描。
#
# 前置:本地版带 --remote-debugging-port=9222 在跑,已打开项目、选好模型。
# 用法:python3 packages/branding/smoke/round4_review_check.py
#
# [feat: release-closeout-2026-09] 2026-09-19

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from uiprobe import UI  # noqa: E402

RESULTS = []


def record(no, name, status, detail=""):
    RESULTS.append({"no": no, "name": name, "status": status, "detail": detail})
    print("  [%s] %s %s" % ({"ok": "PASS", "fail": "FAIL", "skip": "SKIP"}[status], name, ("— " + detail) if detail else ""))


def esc(ui, n=3):
    for _ in range(n):
        ui.key("Escape", "Escape", vk=27)
        time.sleep(0.25)


def wait_until(ui, js_cond, timeout=10.0, interval=0.4):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if ui.ev(js_cond):
            return True
        time.sleep(interval)
    return False


def box_of(ui, js_find):
    return ui.ev(
        """
    (() => { const e = %s; if(!e) return null; const r=e.getBoundingClientRect();
      return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
               cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2) }; })()
    """
        % js_find
    )


# 卡片容器没有 data-component,靠 context-items.tsx 的稳定 class 组合锚定
# (flex-wrap + max-h-[180px],见该文件 FORK 注释)。
CARD_CONTAINER_JS = (
    "[...document.querySelectorAll('div')].find(e => typeof e.className === 'string'"
    " && e.className.includes('flex-wrap') && e.className.includes('max-h-[180px]'))"
)


def card_count(ui):
    return ui.ev("(() => { const c = %s; return c ? c.children.length : 0; })()" % CARD_CONTAINER_JS)


def card_labels(ui):
    return (
        ui.ev(
            "(() => { const c = %s; return c ? [...c.children].map(e => (e.textContent||'').trim().slice(0,60)) : []; })()"
            % CARD_CONTAINER_JS
        )
        or []
    )


def composer_box(ui):
    return box_of(ui, "document.querySelector('[data-component=\"prompt-input\"]')")


# markdown 预览区不是 CodeMirror(`.cm-line` 恒为 0),行是 `[data-markdown-block]` 里的普通元素。
TARGET_LINE_JS = (
    "(() => {"
    " const v = document.querySelector('[data-component=\"file-viewer\"]'); if (!v) return null;"
    " const cands = [...v.querySelectorAll('[data-markdown-block] p, [data-markdown-block] li')];"
    " return cands.find(e => { const r = e.getBoundingClientRect();"
    "   return r.height > 8 && r.width > 120 && r.top > 120 && r.bottom < innerHeight - 160"
    "     && (e.textContent||'').trim().length > 24; }) || null; })()"
)


def select_text_in_viewer(ui):
    line = box_of(ui, TARGET_LINE_JS)
    if not line:
        return False
    y = line["y"] + line["h"] // 2
    ui.drag(line["x"] + 4, y, line["x"] + max(100, int(line["w"] * 0.6)), y)
    time.sleep(0.9)
    return bool(ui.selection_text())


def add_quote_card(ui):
    """预览区选中 → 右键「添加到聊天窗口」→ 浮层「加入聊天」(不填注释)。

    两步路径,与 run_group3.check_26_quote 验过的一致:第一步只弹浮层。
    """
    line = box_of(ui, TARGET_LINE_JS)
    if not line:
        return False
    ui.click(line["x"] + max(60, int(line["w"] * 0.4)), line["y"] + line["h"] // 2, button="right")
    time.sleep(1.4)
    item = box_of(
        ui,
        "[...document.querySelectorAll('button,[role=menuitem]')]"
        ".find(e=>/添加到聊天|加入聊天/.test((e.textContent||'').trim()))",
    )
    if not item:
        return False
    ui.click_element(item, "添加到聊天窗口")
    time.sleep(1.8)
    confirm = box_of(
        ui, "[...document.querySelectorAll('button')].find(e=>/^加入聊天$/.test((e.textContent||'').trim()))"
    )
    if confirm:
        ui.click_element(confirm, "加入聊天")
        time.sleep(2.0)
    return card_count(ui) > 0


def open_a_markdown(ui):
    node_js = (
        "[...document.querySelectorAll('[data-component=\"filetree\"] *')]"
        ".find(e => e.children.length===0 && /\\.md$/.test((e.textContent||'').trim()))"
    )
    node = box_of(ui, node_js)
    if not node:
        return False
    if node["y"] < 100 or node["y"] > 1000:
        node = ui.scroll_into_view(node_js, lambda: box_of(ui, node_js), "md 节点")
    ui.click_element(node, "文件树 .md 节点")
    time.sleep(3.0)
    return bool(box_of(ui, TARGET_LINE_JS))


# ── A. 引用卡历史往返保真 ─────────────────────────────────────
def check_history_roundtrip(ui):
    esc(ui)
    if not open_a_markdown(ui):
        record(1, "引用卡历史往返保真", "skip", "打不开 .md 或预览区没有可选文本块")
        return
    if not select_text_in_viewer(ui):
        record(1, "引用卡历史往返保真", "skip", "预览区没能拖选出文本")
        return
    if not add_quote_card(ui):
        record(1, "引用卡历史往返保真", "skip", "右键 → 加入聊天 没能把卡片加进输入区")
        return

    n1, labels1 = card_count(ui), card_labels(ui)
    if n1 != 1:
        record(1, "引用卡历史往返保真", "skip", "加卡后卡片数 = %s(期望 1),前置没成立" % n1)
        return

    # 发送:history.add 发生在网络请求**之前**(submit.ts:531),这一步一定写进历史
    ui.click_element(composer_box(ui), "输入框")
    ui.type_text(".")
    time.sleep(0.4)
    ui.key("Enter", "Enter", vk=13)
    if not wait_until(ui, "(() => { const c = %s; return !c || c.children.length===0; })()" % CARD_CONTAINER_JS, 25):
        record(1, "引用卡历史往返保真", "skip", "发送后卡片没被清空(发送可能没成功)")
        return

    ui.click_element(composer_box(ui), "输入框")
    time.sleep(0.4)
    ui.key("ArrowUp", "ArrowUp", vk=38)
    time.sleep(2.0)
    n2, labels2 = card_count(ui), card_labels(ui)

    same = n2 == 1 and labels2 == labels1
    record(
        1,
        "引用卡历史往返保真(↑ 翻历史后原样回来)",
        "ok" if same else "fail",
        "发送前 %s 张 %s → 翻历史后 %s 张 %s"
        % (n1, json.dumps(labels1, ensure_ascii=False), n2, json.dumps(labels2, ensure_ascii=False)),
    )


def check_history_card_click(ui):
    """点历史找回的卡:不崩、不无故多开空白 tab。"""
    before = ui.ev(
        """
    (() => ({ tabs: [...document.querySelectorAll('[role=tab]')].filter(e=>e.getBoundingClientRect().height>0)
                       .map(e=>(e.textContent||'').trim()) }))()
    """
    )
    card = box_of(ui, "(() => { const c = %s; return c && c.children[0]; })()" % CARD_CONTAINER_JS)
    if not card:
        record(2, "点历史找回的卡不崩 / 不开空白页", "skip", "输入区没有卡片可点")
        return
    ui.click_element(card, "历史找回的引用卡")
    time.sleep(2.5)
    after = ui.ev(
        """
    (() => ({ tabs: [...document.querySelectorAll('[role=tab]')].filter(e=>e.getBoundingClientRect().height>0)
                       .map(e=>(e.textContent||'').trim()),
              blank: [...document.querySelectorAll('[role=tab]')].filter(e=>e.getBoundingClientRect().height>0
                       && !(e.textContent||'').trim()).length,
              crashed: !!document.querySelector('[data-component="error-page"]') }))()
    """
    )
    ok = (not after.get("crashed")) and after.get("blank", 0) == 0 and len(after["tabs"]) <= len(before["tabs"]) + 1
    record(
        2,
        "点历史找回的卡不崩 / 不开空白页",
        "ok" if ok else "fail",
        "tabs %s → %s,空白 tab=%s,崩溃=%s"
        % (len(before["tabs"]), len(after["tabs"]), after.get("blank"), after.get("crashed")),
    )


def cleanup(ui):
    cb = composer_box(ui)
    if cb:
        ui.click_element(cb, "输入框")
        ui.clear_input()
    esc(ui)


def main():
    ui = UI()
    print("已连接 DeskFox CDP。第四轮 review 真产物验证(范围见文件头)。\n")
    try:
        check_history_roundtrip(ui)
        check_history_card_click(ui)
    finally:
        try:
            cleanup(ui)
        finally:
            ui.close()

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "round4-report.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(RESULTS, fh, ensure_ascii=False, indent=2)
    print("\n报告:%s" % out)
    bad = [r for r in RESULTS if r["status"] == "fail"]
    print(
        "通过 %d / 失败 %d / 跳过 %d"
        % (len([r for r in RESULTS if r["status"] == "ok"]), len(bad), len([r for r in RESULTS if r["status"] == "skip"]))
    )
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
