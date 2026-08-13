#!/usr/bin/env python3
"""[fork-only] CHECKLIST 第 3 组(会话与聊天)自动化执行 [feat: ui-probe-toolkit] 2026-08-13

覆盖 #23~#39。三态结果(OK / SKIP 环境前提不满足 / FAIL 需处理),沿用 run_group2.py 的约定。

## 三条本组特有的纪律

1. **只在自建测试项目里跑**。本组含归档 / 删除 / 分享,在 user 真实项目里跑等于拿真实数据练手,
   「分享」还会把内容发到站外。脚本开头硬断言当前项目路径,不符就整体中止。
2. **不烧额度也要有真实内容**。#39 用 **Shell 模式**跑 `sleep` 产生真实的「执行中」状态,
   不依赖 LLM;顺带把 #29(Shell 模式切换)本身验了。
3. **取材要对得上被测功能的实现**。2026-08-13 实撞:先用一条 shell 命令当语料去验 ⌘F,
   得到 0/0,差点报成缺陷 —— 读源码才知道会话内查找(REQ-097)**只索引 user/assistant 的
   text part**,不含工具/shell part,0/0 是**正确行为**。所以本脚本会确保会话里有真正的散文消息。
   教训:功能「没反应」时,先确认**喂给它的输入在它的定义域内**。

跑法:
    python3 packages/branding/smoke/make_fixtures.py
    python3 packages/branding/smoke/open_project.py /Volumes/ExtSSD/deskfox-uitest
    python3 packages/branding/smoke/run_group3.py
"""
import json
import sys
import time

from uiprobe import UI, ProbeError

TEST_PROJECT = "/Volumes/ExtSSD/deskfox-uitest"
NEEDLE = "ZEBRAMARK"          # 散文语料里的特征词,供 ⌘F / ⌘K 定位
SEED_PROMPT = "请重复这个词三次:%s %s %s" % (NEEDLE, NEEDLE, NEEDLE)

# 分享会把会话内容**发布到站外**,默认关。
# user 2026-08-13 授权过一次(在自建测试项目的样本会话上),已验完:
# 分享能生成链接、取消分享后 curl 实测链接失效。授权是**一次性、针对样本数据**的,
# 不固化成 True —— 否则以后每跑一次全组测试都会自动往站外发一次内容。
# 需要重验时手动改 True,并确认当前项目是自建测试项目。
ALLOW_SHARE = False

rows = []
_t0 = time.time()


def record(no, name, status, detail=""):
    rows.append((no, name, status, detail))
    tag = {"ok": "OK  ", "skip": "SKIP", "fail": "FAIL"}[status]
    # 带经过秒数:排查「跑到哪一步时环境出现异常」时,没有时间戳就只能靠猜
    # (2026-08-13 查「窗口反复缩放」时就卡在这上面 —— 有日志却对不上是哪一项)
    print("  [%s] %6.1fs #%s %s %s" % (tag, time.time() - _t0, no, name,
                                       ("— " + detail) if detail else ""))


# ── 通用小工具 ───────────────────────────────────────────────
BOX_JS = """
(() => { const e = (() => %s)(); if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
           cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2),
           right:Math.round(r.right), bottom:Math.round(r.bottom),
           text:(e.textContent||'').trim().slice(0,40),
           label:e.getAttribute('aria-label') }; })()
"""


def box_of(ui, js_find):
    """把一段「找元素」的 JS 包成带完整几何的 box,供 click_element 用(自带视口断言)。"""
    return ui.ev(BOX_JS % js_find)


def click_scrolled(ui, js_find, what):
    """找到 → 若在视口外先滚进来 → 再点。

    长会话里目标常常滚出视口(实撞 y=1076 / y=-372),`assert_in_viewport` 会正确拦下,
    但那只是不给假绿,不解决问题 —— 得先滚过去。
    """
    box = box_of(ui, js_find)
    if not box:
        return None
    vp = ui.ev("({w:window.innerWidth,h:window.innerHeight})")
    if not (0 <= box["cy"] < vp["h"] and 0 <= box["cx"] < vp["w"]):
        box = ui.scroll_into_view(js_find, lambda: box_of(ui, js_find), what)
    ui.click_element(box, what)
    return box


def wait_until(ui, js_cond, timeout=10.0, interval=0.4):
    """轮询等待页面状态,不用固定 sleep —— 固定 sleep 是本工具包最常见的假绿来源。"""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = ui.ev(js_cond)
        if last:
            return last
        time.sleep(interval)
    return last


def esc(ui, n=3):
    for _ in range(n):
        ui.key("Escape", "Escape", vk=27)
        time.sleep(0.3)


def composer(ui):
    return ui.find_element(selector="[contenteditable=true]")


def placeholder(ui):
    return ui.ev("(() => { const e=document.querySelector('[contenteditable=true]');"
                 " return e ? (e.getAttribute('aria-label')||'') : ''; })()")


def type_into_composer(ui, text):
    """点进输入框再逐字符真实输入,并**断言字真的进去了**才返回。"""
    ce = composer(ui)
    ui.require(ce, "找不到输入框")
    ui.click_element(ce, "输入框")
    time.sleep(0.4)
    ui.type_text(text)
    time.sleep(0.5)
    got = ui.ev("(() => { const e=document.querySelector('[contenteditable=true]');"
                " return e ? (e.textContent||'').trim() : ''; })()")
    ui.require(text[:6] in got, "输入框内容是 %r,没收到键入" % got[:60])
    return got


def set_shell_mode(ui, want: bool):
    """切到 / 切出 shell 模式。

    2026-08-13 实撞:**它不是一个开关**。源码里 `mod+shift+x` 是 `prompt.mode.shell`
    且 `disabled: store.mode === "shell"`,退出走的是另一个命令 `mod+shift+e`
    (`prompt.mode.normal`)。按「同一个键来回按」写,进得去出不来,
    第一版据此把 #29 判成 FAIL —— 又一次「想当然」被源码推翻。
    另:切换会重建输入框元素、焦点随之丢失,所以每次按键前都重新点一次输入框。
    """
    for _ in range(3):
        if ("shell" in placeholder(ui).lower()) == want:
            return True
        ce = composer(ui)
        if not ce:
            return False
        ui.click_element(ce, "输入框")
        time.sleep(0.3)
        if want:
            ui.key("x", "KeyX", vk=88, cmd=True, shift=True)
        else:
            ui.key("e", "KeyE", vk=69, cmd=True, shift=True)
        time.sleep(1.0)
    return ("shell" in placeholder(ui).lower()) == want


def sessions(ui):
    """会话列表条目。

    条目是 `<a href=".../session/ses_xxx">` —— **id 从 href 取**,不能拿标题当身份
    (标题会重名,而且会被自动改名)。第一版按 `[data-session-id]` 找,该属性不在列表项上,
    于是列表恒为空,「新建会话」被判成没生效。
    """
    return ui.ev("""
    (() => { const p = document.querySelector('[data-component="sidebar-session-panel"]');
      if (!p) return [];
      return [...p.querySelectorAll('a[href*="/session/"]')].map(e => {
        const r = e.getBoundingClientRect();
        const m = (e.getAttribute('href')||'').match(/\\/session\\/([^/?#]+)/);
        return { id: m ? m[1] : null, t:(e.textContent||'').trim().slice(0,30),
                 x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
                 cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2),
                 right:Math.round(r.right), bottom:Math.round(r.bottom) }; }); })()
    """) or []


def session_count(ui):
    return len(sessions(ui))


def session_open(ui):
    """当前是否真的打开着一个会话。

    这是本组**最容易塌又最容易忽略的前提**:`session.undo/redo/compact/fork/export`
    在源码里都带 `disabled: !params.id`,没有打开的会话时它们在命令面板里根本不出现。
    第一版没验这个前提,前面某一步把会话关掉后,后面一连串命令全报「找不到」——
    看起来像五个功能坏了,其实是一个前提没了。
    """
    return ui.ev("(() => !!document.querySelector('[data-message-id]'))()")


def message_area_text(ui):
    """只取**消息区**的文字。

    不能用 `document.body.innerText` 判「会话里有没有某段语料」—— 侧栏的会话标题里
    也含那个词,于是空会话也被判成「已有语料」,后面 ⌘F 搜出 0/0 又被当成缺陷。
    这正是第二条硬规矩(可靠指标,不用文案判定)在本组的具体形态。
    """
    return ui.ev("""
    (() => { const ms=[...document.querySelectorAll('[data-message-id]')];
      return ms.map(e => e.textContent||'').join('\\n'); })()
    """) or ""


# 语料会话只定位一次就记住 —— 每项检查前都把整个列表翻一遍会让界面疯狂重排,
# user 2026-08-13 反馈「窗口不停地放大缩小」正是这类高频切换造成的观感。
_corpus_session = {"id": None}


def ensure_session_open(ui, needle=None):
    """确保打开着一个会话;给了 needle 就必须打开**含该语料**的那一条。

    第一版只保证「有会话开着」,但列表里既有含语料的会话、也有只跑过 shell 的会话,
    随机开中后者时 ⌘F 搜不到词、分叉说「没有可用消息」—— 全是前提不对,却报成功能失败。
    """
    if needle is None:
        if session_open(ui):
            return True
        items = sessions(ui)
        if not items:
            return False
        ui.click_element(items[0], "会话列表首条")
        time.sleep(2.0)
        return bool(session_open(ui))

    if session_open(ui) and needle in message_area_text(ui):
        return True

    items = sessions(ui)
    # 先直奔记住的那条,命中就不用挨个试
    if _corpus_session["id"]:
        hit = next((s for s in items if s["id"] == _corpus_session["id"]), None)
        if hit:
            ui.click_element(hit, "语料会话")
            time.sleep(2.2)
            if needle in message_area_text(ui):
                return True
    for item in items:
        if item["id"] == _corpus_session["id"]:
            continue
        ui.click_element(item, "会话「%s」" % item["t"][:12])
        time.sleep(2.2)
        if needle in message_area_text(ui):
            _corpus_session["id"] = item["id"]
            return True
    return False


def generating(ui):
    """是否处于「执行中」—— 读驱动该状态的控件(停止键 / shimmer),不读文案。"""
    return ui.ev("""
    (() => !!document.querySelector('[data-component="text-shimmer"]')
        || [...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === '停止'))()
    """)


def palette(ui, query, pick_text=None, timeout=8):
    """⌘K 命令面板。session.undo/redo/compact/fork/export 都没有快捷键,只能走它。"""
    esc(ui)
    ui.key("k", "KeyK", vk=75, cmd=True)
    if not wait_until(ui, "(() => !!document.querySelector('[role=dialog] input'))()", 6):
        return None, None
    ui.type_text(query)
    time.sleep(1.2)
    # 面板结果是**普通 button**,没有 role=option/menuitem —— 第一版按 ARIA role 找,恒为空,
    # 于是「撤销/重做/压缩/分叉/导出」全被报成「命令不存在」。
    items = ui.ev("""
    (() => { const dlg=document.querySelector('[role=dialog]'); if(!dlg) return [];
      return [...dlg.querySelectorAll('button')]
        .filter(e => { const r=e.getBoundingClientRect();
          return r.height>16 && r.width>120 && (e.textContent||'').trim(); })
        .slice(0,10).map(e => { const r=e.getBoundingClientRect();
          return { t:(e.textContent||'').trim().slice(0,44), x:Math.round(r.x), y:Math.round(r.y),
                   w:Math.round(r.width), h:Math.round(r.height),
                   cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2),
                   right:Math.round(r.right), bottom:Math.round(r.bottom) }; }); })()
    """) or []
    target = None
    if pick_text:
        target = next((i for i in items if pick_text in i["t"]), None)
    elif items:
        target = items[0]
    if target:
        ui.click_element(target, "命令面板项「%s」" % target["t"][:16])
        time.sleep(1.5)
    return items, target


# ── 各条目 ───────────────────────────────────────────────────
def check_24_find(ui):
    """#24 会话内查找 ⌘F。

    清单特别标了「**关闭按钮必须在可点区内**」—— 本次修过的回归点(右侧面板曾盖住它)。
    所以不止验功能:还要验**几何 + 遮挡**。光「Esc 能关」不算过,用户是用鼠标点那个 × 的。
    """
    esc(ui)
    ui.key("f", "KeyF", vk=70, cmd=True)
    if not wait_until(ui, FIND_INPUT, 6):
        record(24, "会话内查找 ⌘F", "fail", "⌘F 没有唤出查找框")
        return
    ui.type_text(NEEDLE)
    time.sleep(1.8)
    first = ui.ev(FIND_COUNT)
    nxt = box_of(ui, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='下一个')")
    cycled = None
    if nxt and first and first["total"] > 1:
        ui.click_element(nxt, "下一个")
        time.sleep(1.0)
        cycled = ui.ev(FIND_COUNT)

    close_btn = box_of(ui, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='关闭')")
    geom_ok = occl_ok = None
    if close_btn:
        vp = ui.ev("({w:window.innerWidth,h:window.innerHeight})")
        geom_ok = 0 <= close_btn["cx"] < vp["w"] and 0 <= close_btn["cy"] < vp["h"]
        # 遮挡判定:中心点必须命中关闭键自己或其子元素(命中别的容器 = 被盖住,点不到)
        occl_ok = ui.ev("""
        (() => { const b=[...document.querySelectorAll('button')]
            .find(x=>x.getAttribute('aria-label')==='关闭');
          if(!b) return null; const r=b.getBoundingClientRect();
          const hit=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
          return !!(hit && (hit===b || b.contains(hit))); })()
        """)
        ui.zoom_shot("g3-24-find-close", max(close_btn["x"] - 40, 0), max(close_btn["y"] - 14, 0),
                     110, 52, scale=6.0)
        ui.click_element(close_btn, "查找框关闭键")   # 用**点击**关,而不是 Esc —— 验的就是它可点
        time.sleep(0.8)
    closed_by_click = not ui.ev(FIND_INPUT)

    ok = bool(first and first["total"] >= 1 and geom_ok and occl_ok and closed_by_click
              and (cycled is None or cycled["cur"] != first["cur"]))
    record(24, "会话内查找 ⌘F(计数/循环/关闭键可点)", "ok" if ok else "fail",
           "计数 %s→%s | 关闭键 视口内=%s 未被遮挡=%s 点击可关=%s"
           % (first, cycled, geom_ok, occl_ok, closed_by_click))


FIND_INPUT = """
(() => { const i=[...document.querySelectorAll('input')]
    .find(e=>/查找|find in/i.test(e.getAttribute('placeholder')||''));
  return i ? true : false; })()
"""

FIND_COUNT = """
(() => { const m=(document.body.innerText||'').match(/(\\d+)\\s*\\/\\s*(\\d+)/);
  return m ? { cur:+m[1], total:+m[2] } : null; })()
"""


def check_25_global_search(ui):
    """#25 全局搜索 ⌘K —— 期望能同时给出**文件 / 命令 / 会话内容**三类结果。"""
    esc(ui)
    ui.key("k", "KeyK", vk=75, cmd=True)
    if not wait_until(ui, "(() => !!document.querySelector('[role=dialog] input'))()", 6):
        record(25, "全局搜索 ⌘K", "fail", "⌘K 没有唤出面板")
        return
    esc(ui)
    kinds = {}
    for term, key in ((NEEDLE, "会话内容"), ("sample.py", "文件"), ("新建会话", "命令")):
        # **每个词都重开一次面板**。清空输入试过两种都不行:
        #   JS 置 value + dispatch input → 合成事件,受控输入不认;
        #   ⌘A + Backspace → 实撞只删掉一个字符(输入框变成 'ZEBRAMARsample.py'),
        #   后两轮搜的是拼接出来的乱串,于是「文件」「命令」双双 0 条 → 差点报成缺陷。
        # 重开面板是唯一确定能拿到干净输入的方式。
        esc(ui)
        ui.key("k", "KeyK", vk=75, cmd=True)
        if not wait_until(ui, "(() => !!document.querySelector('[role=dialog] input'))()", 6):
            kinds[key] = 0
            continue
        ui.type_text(term)
        time.sleep(1.8)
        typed = ui.ev("(() => { const i=document.querySelector('[role=dialog] input');"
                      " return i ? i.value : null; })()")
        # 前提断言:输入框里就是这个词,不是上一轮的残留拼接
        if typed != term:
            kinds[key] = "输入串了(%r)" % typed
            continue
        kinds[key] = ui.ev("""
        (() => { const dlg=document.querySelector('[role=dialog]'); if(!dlg) return 0;
          return [...dlg.querySelectorAll('button')].filter(e => {
            const r=e.getBoundingClientRect();
            return r.height>16 && r.width>120 && (e.textContent||'').trim()
                   && !/在所有项目中搜索/.test(e.textContent||''); }).length; })()
        """)
    esc(ui)
    ok = all(isinstance(v, int) and v > 0 for v in kinds.values())
    record(25, "全局搜索 ⌘K(文件/命令/会话内容)", "ok" if ok else "fail",
           " ".join("%s=%s 条" % (k, v) for k, v in kinds.items()))


def check_29_shell_mode(ui):
    """#29 Shell 模式切换。指标是 placeholder(驱动行为的属性),不是按钮文案。"""
    esc(ui)
    set_shell_mode(ui, False)
    before = placeholder(ui)
    on = set_shell_mode(ui, True)
    mid = placeholder(ui)
    off = set_shell_mode(ui, False)
    after = placeholder(ui)
    ok = on and off and "shell" in mid.lower() and "shell" not in after.lower()
    record(29, "Shell 模式切换(mod+shift+x)", "ok" if ok else "fail",
           "placeholder %r → %r → %r" % (before[:12], mid[:12], after[:12]))


def check_39_abort(ui):
    """#39 中断生成 —— 用 shell `sleep` 造出真实的执行中状态,不烧 LLM 额度。"""
    esc(ui)
    if not set_shell_mode(ui, True):
        record(39, "中断生成", "skip", "进不了 shell 模式,无法构造执行中状态")
        return
    # 判据用**磁盘上的哨兵文件**,不用页面文案:
    # 第一版查「NEVER_REACHED 是否出现在页面里」,但**命令原文本身就显示在消息里**,
    # 必然命中 → 恒判失败。这类「指标被自己的输入污染」正是三条硬规矩里第二条针对的情形。
    import os
    sentinel = os.path.join(TEST_PROJECT, ".abort-sentinel")
    if os.path.exists(sentinel):
        os.remove(sentinel)
    type_into_composer(ui, "sleep 40 && touch %s" % sentinel)
    ui.key("Enter", "Enter", vk=13)
    started = wait_until(ui, "(() => [...document.querySelectorAll('button')]"
                             ".some(b=>b.getAttribute('aria-label')==='停止'))()", 15)
    if not started:
        record(39, "中断生成", "fail", "命令发出后没有出现「停止」控件")
        set_shell_mode(ui, False)
        return
    stop = box_of(ui, "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='停止')")
    ui.click_element(stop, "停止")
    stopped = wait_until(ui, "(() => ![...document.querySelectorAll('button')]"
                             ".some(b=>b.getAttribute('aria-label')==='停止'))()", 15)
    time.sleep(3.0)   # 留出窗口:若中断没生效,sleep 之后的 touch 会在这段时间落盘
    leaked = os.path.exists(sentinel)
    if leaked:
        os.remove(sentinel)
    set_shell_mode(ui, False)
    record(39, "中断生成", "ok" if (stopped and not leaked) else "fail",
           "停止控件 出现→消失=%s;哨兵文件未生成=%s" % (bool(stopped), not leaked))


def check_35_context_usage(ui):
    """#35 查看上下文用量。

    2026-08-13 实撞:先按「弹层」写判定(role=dialog / popover),得 0→0 报 FAIL;
    实际它是**在中栏新开一个标签页**。指标改为 tab 出现 + 面板里有 token 统计。
    """
    esc(ui)
    btn = ui.find_element(label="查看上下文用量")
    if not btn:
        record(35, "查看上下文用量", "fail", "找不到入口")
        return
    # 它是**开关**:已经开着时再点会关掉。先读当前态,只在没开时才点 ——
    # 第一版没管这点,上一轮遗留的已开状态被这一次点击关掉,判成「打不开」。
    already = ui.ev(CONTEXT_PANEL)
    if not already:
        ui.click_element(btn, "查看上下文用量")
    panel = wait_until(ui, CONTEXT_STATS, 8)
    if not panel:
        # 它是开关,上一步可能把已开的关掉了;再点一次并复核,避免把「切错方向」当成「打不开」
        btn = ui.find_element(label="查看上下文用量")
        if btn:
            ui.click_element(btn, "查看上下文用量(再次)")
            panel = wait_until(ui, CONTEXT_STATS, 8)
    shot = ui.shot("g3-35-context-usage")
    record(35, "查看上下文用量", "ok" if panel else "fail",
           "面板显示消息数=%s,含 token 统计;进入前已打开=%s(截图 %s)"
           % ((panel or {}).get("msgs"), bool(already), shot.rsplit("/", 1)[-1]))


CONTEXT_PANEL = """
(() => { const t = document.body.innerText||'';
  return /消息数/.test(t) && /总\\s*token|上下文限制/.test(t); })()
"""

CONTEXT_STATS = """
(() => { const t = document.body.innerText||'';
  const m = t.match(/消息数[\\s\\n]*(\\d+)/);
  const tok = /总\\s*token|上下文限制|使用率/.test(t);
  return (m && tok) ? { msgs:+m[1] } : null; })()
"""


def check_36_jump_latest(ui):
    """#36 跳转到最新。

    判定「滚动容器真的到底」,不看按钮有没有响应。容器要**按是否装着消息**来找,
    不能按「谁能滚」随便挑一个 —— 第一版就是挑错了容器,量出距底 266px 报 FAIL。
    """
    esc(ui)
    btn = ui.find_element(label="跳转到最新")
    if not btn:
        record(36, "跳转到最新", "skip", "内容未超出一屏时按钮不出现(属正常)")
        return
    ui.click_element(btn, "跳转到最新")
    time.sleep(1.5)
    gap = ui.ev("""
    (() => { const msg = document.querySelector('[data-message-id]');
      if (!msg) return null;
      let c = msg.parentElement;
      while (c && c !== document.body) {
        const s = getComputedStyle(c);
        if (/auto|scroll/.test(s.overflowY) && c.scrollHeight - c.clientHeight > 20)
          return { gap: Math.round(c.scrollHeight - c.clientHeight - c.scrollTop) };
        c = c.parentElement;
      }
      return { gap: 0, note: '消息区没有可滚动祖先(内容未超一屏)' }; })()
    """)
    ok = gap is not None and gap["gap"] <= 8
    record(36, "跳转到最新", "ok" if ok else "fail", "距底 %s px" % (gap or {}).get("gap"))


def check_37_step_toggle(ui):
    """#37 步骤展开/收起 —— 用**容器高度**判定,不用文案(折叠态文案也在 DOM 里)。"""
    esc(ui)
    # 必须取**当前可见**的那个触发器。消息列表是虚拟列表(virtua),
    # 滚出屏的行会被回收,`scrollIntoView` 到不了它 —— 实撞坐标 y=-1944,
    # 视口断言正确拦下,但这次靠「先滚过去」解决不了,只能换一个在屏的目标。
    # 先锁定「第几个」触发器,之后一直操作**同一个**。
    # 实撞:每次都取「当前第一个可见的」,展开后布局变了,第二次点到的是另一个,
    # 于是收起没发生 → 高度 32→199→199,被判成「收不起来」。
    idx = ui.ev("""
    (() => { const all=[...document.querySelectorAll('[data-component="tool-trigger"]')];
      return all.findIndex(e => { const r=e.getBoundingClientRect();
        return r.height>0 && r.y>=0 && r.bottom<=window.innerHeight; }); })()
    """)
    if idx is None or idx < 0:
        record(37, "步骤展开/收起", "skip",
               "当前视口内没有工具步骤(全被虚拟列表回收了)—— 需先滚到有步骤的位置")
        return
    TRIG = ("(() => document.querySelectorAll('[data-component=\"tool-trigger\"]')[%d] || null)()" % idx)
    # 高度要量**被点击的那个步骤所属的容器**,不能量 DOM 里第一个 tool-part-wrapper：
    # 页面上有多个步骤,量错对象就会看到「点了但高度没变」(实撞 32→32→32)。
    h = lambda: ui.ev("""
    (() => { const t = (() => %s)(); if (!t) return null;
      const w = t.closest('[data-component="tool-part-wrapper"]') || t.parentElement;
      return w ? Math.round(w.getBoundingClientRect().height) : null; })()
    """ % TRIG.strip())
    h0 = h()
    click_scrolled(ui, TRIG, "步骤触发器"); time.sleep(1.2)
    h1 = h()
    click_scrolled(ui, TRIG, "步骤触发器"); time.sleep(1.2)
    h2 = h()
    ok = h0 is not None and h1 is not None and h1 != h0 and abs((h2 or 0) - h0) <= 4
    record(37, "步骤展开/收起", "ok" if ok else "fail", "高度 %s → %s → %s" % (h0, h1, h2))


def check_33_message_nav(ui):
    """#33 消息间导航(mod+alt+[ / ])—— 判定滚动位置真的变了。"""
    esc(ui)
    pos = lambda: ui.ev("""
    (() => { const msg=document.querySelector('[data-message-id]'); if(!msg) return null;
      let c=msg.parentElement;
      while (c && c!==document.body) { const s=getComputedStyle(c);
        if (/auto|scroll/.test(s.overflowY) && c.scrollHeight-c.clientHeight>20) return Math.round(c.scrollTop);
        c=c.parentElement; }
      return null; })()
    """)
    p0 = pos()
    if p0 is None:
        record(33, "消息间导航", "skip", "消息区不可滚动(内容未超一屏)")
        return
    ui.key("[", "BracketLeft", vk=219, cmd=True, alt=True)
    time.sleep(1.2)
    p1 = pos()
    ui.key("]", "BracketRight", vk=221, cmd=True, alt=True)
    time.sleep(1.2)
    p2 = pos()
    ok = p1 is not None and p1 != p0
    record(33, "消息间导航(mod+alt+[ / ])", "ok" if ok else "fail",
           "scrollTop %s → 上一条 %s → 下一条 %s" % (p0, p1, p2))


def check_34_copy(ui):
    """#34 复制消息 / 复制回复。

    判据走 **AppleScript 读系统剪贴板**(OS 层真相)。两条弯路都实撞过:
      1. `navigator.clipboard.readText()` —— 受权限/焦点限制,直接抛异常;
      2. 复制后用 CDP 按 ⌘V 粘回输入框 —— **CDP 的合成按键触发不了浏览器的粘贴命令**,
         粘出 0 字,看起来像「复制没生效」,其实复制一直是好的。
    先写入哨兵值再复制,能确认剪贴板**确实被这次操作改写**,而不是读到上一轮的残留。
    """
    esc(ui)
    # 页面上同时存在多个「复制回复」按钮(每条回复一个),其中不少已滚出视口。
    # 必须挑**当前可见**的那个:`.find()` 取 DOM 序第一个,实撞取到 y=-600 的那颗。
    COPY_JS = """
      (() => { const all=[...document.querySelectorAll('button,[role=menuitem]')]
          .filter(e => /^复制(消息|回复)?$/.test((e.textContent||'').trim())
                    || /复制/.test(e.getAttribute('aria-label')||''));
        const vis = all.find(e => { const r=e.getBoundingClientRect();
          return r.height>0 && r.y>=0 && r.bottom<=window.innerHeight; });
        return vis || all[0] || null; })()
    """
    item = box_of(ui, COPY_JS)
    if not item:
        # 复制入口多挂在消息的「更多」菜单里,先把菜单打开再找
        more = box_of(ui, """
          (() => { const m=document.querySelector('[data-message-id]'); if(!m) return null;
            return [...m.querySelectorAll('button')].find(b=>/更多|more/i.test(
              (b.getAttribute('aria-label')||'')+(b.textContent||''))); })()
        """)
        if more:
            ui.click_element(more, "消息更多菜单")
            time.sleep(1.0)
            item = box_of(ui, """
              (() => [...document.querySelectorAll('[role=menuitem],button')]
                .find(e => /复制/.test((e.textContent||'').trim())))()
            """)
    if not item:
        record(34, "复制消息 / 复制回复", "skip", "当前视图没有暴露复制入口(需悬停消息才出现)")
        return
    set_clipboard("__UITEST_SENTINEL__")
    # `navigator.clipboard.writeText` 要求 **document 有焦点**,否则静默拒绝。
    # 用 CDP 的 Page.bringToFront 让页面拿回焦点 —— 比 osascript 抢前台可靠,
    # 因为 osascript 自己就会先把前台抢走一下。
    ui.send("Page.bringToFront")
    time.sleep(0.5)
    # 写哨兵值是通过 osascript 做的,会把前台短暂让给 System Events;
    # 而 `navigator.clipboard.writeText` **在页面失焦时会被拒绝且不报错**,
    # 表现为「点了复制但剪贴板没变」。所以先把应用抢回前台再点。
    focus_app()
    click_scrolled(ui, COPY_JS, "复制")
    time.sleep(1.5)
    got = get_clipboard()
    esc(ui)
    ok = bool(got) and got != "__UITEST_SENTINEL__" and len(got) > 3
    record(34, "复制消息 / 复制回复(系统剪贴板回读)", "ok" if ok else "fail",
           "剪贴板 %d 字,前 30 字 %r" % (len(got or ""), (got or "")[:30]))


def share_url_live(url, marker=NEEDLE):
    """站外实测:分享链接还能不能取到会话内容。

    这是判断「分享是否已收回」的**唯一可信判据** —— 应用内的菜单/命令状态只反映
    当前打开的那条会话,两次都据此误报「已收回」,而链接其实还活着。
    """
    import subprocess
    try:
        out = subprocess.run(["curl", "-s", "--max-time", "20", url],
                             capture_output=True, text=True, timeout=30).stdout or ""
    except Exception:
        return None      # 网络问题 → 未知,不能当作「已收回」
    return marker in out


def focus_app():
    import subprocess
    subprocess.run(["osascript", "-e",
                    'tell application "System Events" to set frontmost of process "DeskFox 本地版" to true'],
                   capture_output=True, timeout=10)
    time.sleep(0.8)


def set_clipboard(text):
    import subprocess
    subprocess.run(["osascript", "-e", 'set the clipboard to "%s"' % text],
                   capture_output=True, timeout=10)


def get_clipboard():
    import subprocess
    r = subprocess.run(["osascript", "-e", "the clipboard"], capture_output=True, text=True, timeout=10)
    return (r.stdout or "").strip()


def check_30_undo_redo(ui):
    """#30 会话撤销/重做 —— 无快捷键,走命令面板;判定消息数真的变了。"""
    esc(ui)
    count = lambda: ui.ev("(() => [...new Set([...document.querySelectorAll('[data-message-id]')]"
                          ".map(e=>e.getAttribute('data-message-id')))].length)()")
    c0 = count()
    items, picked = palette(ui, "撤销", pick_text="撤销")
    if not picked:
        record(30, "会话撤销/重做", "fail", "命令面板里找不到「撤销」(候选:%s)"
               % [i["t"][:14] for i in (items or [])][:4])
        return
    time.sleep(2.0)
    c1 = count()
    items2, picked2 = palette(ui, "重做", pick_text="重做")
    # 等消息数真的回到原值,而不是固定 sleep 后直接读 —— 重做是异步的,读早了必然判错
    for _ in range(15):
        time.sleep(1.0)
        if count() == c0:
            break
    c2 = count()
    ok = c1 != c0 and c2 == c0
    record(30, "会话撤销/重做", "ok" if ok else "fail",
           "消息数 %s → 撤销后 %s → 重做后 %s;重做命令%s(候选:%s)"
           % (c0, c1, c2, "已点" if picked2 else "未找到",
              [i["t"][:12] for i in (items2 or [])][:3]))


def check_31_compact_fork(ui):
    """#31 会话压缩 / 分叉。

    压缩会真的调用 LLM(花钱),这里**只验命令存在且可执行**;
    分叉不花钱,验它是否真生成了一个新会话。
    """
    esc(ui)
    items, _ = palette(ui, "压缩会话", pick_text=None)
    has_compact = any("压缩" in i["t"] for i in (items or []))
    esc(ui)
    n0 = session_count(ui)
    # 「分叉」在界面上的命令名是**「从消息创建新会话」**(i18n `command.session.fork`),
    # 按「分叉」搜一无所获 —— 拿内部概念名去搜界面,是清单与实现脱节的典型。
    items2, picked2 = palette(ui, "从消息创建新会话", pick_text="从消息创建")
    time.sleep(2.0)
    # 它**先开一个选消息的对话框**,不是直接建会话。第一版直接断言「会话数 +1」,
    # 对象就找错了 —— 而对话框当时其实正常弹出。
    dlg = ui.ev("""
    (() => { const d=[...document.querySelectorAll('[role=dialog]')]
        .find(e=>e.getBoundingClientRect().height>0 && /创建新会话/.test(e.textContent||''));
      if(!d) return null;
      const opts=[...d.querySelectorAll('button')].filter(b=>{const r=b.getBoundingClientRect();
        return r.height>16 && (b.textContent||'').trim();});
      return { empty: /没有可用于创建新会话的消息/.test(d.textContent||''),
               count: opts.length,
               first: opts.length ? (() => { const r=opts[0].getBoundingClientRect();
                 return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
                         cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2),
                         right:Math.round(r.right),bottom:Math.round(r.bottom)}; })() : null }; })()
    """)
    forked = None
    if dlg and not dlg["empty"] and dlg["first"]:
        ui.click_element(dlg["first"], "分叉:选第一条消息")
        time.sleep(3.0)
        forked = session_count(ui) > n0
    esc(ui)
    if dlg and dlg["empty"]:
        record(31, "会话压缩(入口)/ 分叉", "skip",
               "压缩命令存在=%s;分叉对话框正常弹出,但当前会话没有可分叉的消息"
               "(打开的是空会话)—— 属前提不满足,非缺陷" % has_compact)
        return
    ok = has_compact and dlg is not None and forked
    record(31, "会话压缩(入口)/ 分叉(生成新会话)", "ok" if ok else "fail",
           "压缩命令存在=%s;分叉对话框=%s;会话数 %s → %s"
           % (has_compact, "已弹出" if dlg else "未弹出", n0, session_count(ui)))


def check_32_session_nav(ui):
    """#32 会话间导航(next / previous / unseen)。"""
    esc(ui)
    if session_count(ui) < 2:
        record(32, "会话间导航", "skip", "会话数不足 2,无法验证跳转")
        return
    cur = lambda: ui.ev("""
    (() => { const p=document.querySelector('[data-component="sidebar-session-panel"]');
      if(!p) return null;
      const a=[...p.querySelectorAll('[data-session-id]')]
        .find(e => e.getAttribute('aria-current') || /bg-|active/.test(e.className||''));
      return a ? a.getAttribute('data-session-id') : null; })()
    """)
    names = []
    for q in ("下一个会话", "上一个会话", "未读"):
        items, _ = palette(ui, q, pick_text=None)
        names.append((q, [i["t"][:16] for i in (items or [])][:3]))
        esc(ui)
    found = sum(1 for _, v in names if v)
    record(32, "会话间导航(next/previous/unseen 命令存在)",
           "ok" if found >= 2 else "fail", json.dumps(names, ensure_ascii=False)[:150])


def check_38_export(ui):
    """#38 导出会话 —— 判据是成功 toast(源码里它走下载,不开原生保存面板)。"""
    esc(ui)
    items, picked = palette(ui, "导出会话", pick_text="导出会话")
    if not picked:
        record(38, "导出会话", "fail", "命令面板里找不到「导出会话」(候选:%s)"
               % [i["t"][:14] for i in (items or [])][:4])
        return
    # 判据是**成功 toast**:源码里导出 = 取数据 → 触发下载 → `showToast(variant:"success")`,
    # 根本不开原生保存面板。
    # 2026-08-13 实撞:第一版判「有没有多出原生窗口」,而当时恰好挂着一个之前留下的
    # 「关于 DeskFox」对话框(AXDialog 284x191),被当成保存面板 → **报了假绿**。
    # 教训:判据必须锚在被测功能自己的产物上,不能锚在「环境里多了点什么」。
    toast = wait_until(ui, """
    (() => { const r = [...document.querySelectorAll('[aria-label]')]
        .find(e => /Notif/i.test(e.getAttribute('aria-label')||''));
      if (!r) return null;
      const t = (r.textContent||'').trim();
      return t ? { text: t.slice(0, 60) } : null; })()
    """, 10)
    record(38, "导出会话(成功 toast)", "ok" if toast else "fail",
           "toast=%r" % ((toast or {}).get("text")))


def check_23_session_list(ui):
    """#23 会话列表:新建 / 切换 / 重命名 / 归档+撤销 / 删除确认。

    **分享 / 取消分享不在这里跑** —— 那是把会话内容发到站外的不可逆动作,需 user 明确授权,
    脚本只验入口存在,绝不点下去。
    """
    esc(ui)
    n0 = session_count(ui)
    # 新建:判据是**进入了一个空白会话视图**(没有消息),不是「列表 +1」——
    # 实测空会话在有内容之前不进列表,按 +1 断言会把正常行为判成失败。
    nb = ui.find_element(label="新建会话")
    if not nb:
        record(23, "会话列表", "fail", "找不到「新建会话」")
        return
    ui.click_element(nb, "新建会话")
    time.sleep(2.5)
    created = not session_open(ui)      # 新会话没有任何消息
    n1 = session_count(ui)

    # 切换:点列表里另一条,判定**消息集合真的换了一批**
    # (标题会重名也会被自动改名,不能当身份;高亮 class 是实现细节,也不可靠)
    items = sessions(ui)
    switched = None
    if len(items) >= 2:
        msgs = lambda: set(ui.ev("(() => [...new Set([...document.querySelectorAll('[data-message-id]')]"
                                 ".map(e=>e.getAttribute('data-message-id')))])()") or [])
        ui.click_element(items[0], "列表首条会话")
        time.sleep(2.2)
        m0 = msgs()
        ui.click_element(items[-1], "列表末条会话")
        time.sleep(2.2)
        m1 = msgs()
        switched = bool(m0) and bool(m1) and m0 != m1

    # 重命名
    renamed = None
    items = sessions(ui)
    if items:
        menu = open_session_menu(ui, items[0])
        ren = menu_item(ui, "重命名") if menu else None
        if ren:
            old = items[0]["t"]
            ui.click_element(ren, "重命名")
            time.sleep(1.2)
            ui.clear_input()   # 不能用 ⌘A,见 uiprobe.clear_input 注释
            ui.type_text("UITEST_RENAMED")
            ui.key("Enter", "Enter", vk=13)
            time.sleep(2.0)
            renamed = any("UITEST_RENAMED" in s["t"] for s in sessions(ui))
        else:
            esc(ui)

    # 归档 + 撤销 toast(这也兑现了 #21 里说的「toast 真正弹出」的验证)
    archived = restored = toast_text = None
    items = sessions(ui)
    if items:
        menu = open_session_menu(ui, items[0])
        arch = menu_item(ui, "归档") if menu else None
        if arch:
            before_ids = {s["id"] for s in sessions(ui)}
            ui.click_element(arch, "归档")
            time.sleep(2.0)
            archived = {s["id"] for s in sessions(ui)} < before_ids
            toast_text = ui.ev("""
            (() => { const r=[...document.querySelectorAll('[aria-label]')]
                .find(e=>/Notif/i.test(e.getAttribute('aria-label')||''));
              const t = r ? (r.textContent||'').trim() : ''; return t ? t.slice(0,40) : null; })()
            """)
            undo = box_of(ui, "[...document.querySelectorAll('button,[role=button]')]"
                              ".find(e=>/撤销|撤消/.test((e.textContent||'').trim()))")
            if undo:
                ui.click_element(undo, "撤销归档")
                time.sleep(2.5)
                restored = before_ids <= {s["id"] for s in sessions(ui)}
        else:
            esc(ui)

    # 删除确认:只验确认框出现,随即取消 —— **不真删**
    delete_confirms = None
    items = sessions(ui)
    if items:
        menu = open_session_menu(ui, items[0])
        dele = menu_item(ui, "删除") if menu else None
        if dele:
            ui.click_element(dele, "删除")
            time.sleep(1.5)
            delete_confirms = ui.ev("""
            (() => [...document.querySelectorAll('[role=dialog],[role=alertdialog]')]
              .some(e => e.getBoundingClientRect().height > 0
                      && /删除|确认|撤销|无法/.test(e.textContent||'')))()
            """)
        esc(ui)

    ok = bool(created and switched and renamed and archived and restored and delete_confirms)
    record(23, "会话列表:新建/切换/重命名/归档+撤销/删除确认",
           "ok" if ok else "fail",
           "新建=进入空白会话 %s(列表 %s→%s,空会话不入列表属正常)| 切换=%s | 重命名=%s | "
           "归档=%s 撤销恢复=%s(toast=%r)| 删除确认框=%s"
           % (created, n0, n1, switched, renamed, archived, restored, toast_text, delete_confirms))


def check_23b_share(ui):
    """#23b 分享 / 取消分享。

    这是**把会话内容发布到站外**的动作,默认不跑。
    user 于 2026-08-13 明确授权:可在自建测试项目(`/Volumes/ExtSSD/deskfox-uitest`)的
    样本会话上跑一次 —— 那些内容是脚本自己生成的,无隐私。
    跑完**必须取消分享**把链接收回,这是本条的一部分,不是收尾动作。
    未授权时(`ALLOW_SHARE=False`)只确认入口存在。
    """
    esc(ui)
    if not ensure_session_open(ui):
        record("23b", "分享 / 取消分享", "skip", "没有可用会话")
        return
    entries, _ = palette(ui, "分享", pick_text=None)
    esc(ui)
    has_entry = any("分享会话" in i["t"] for i in (entries or []))
    if not ALLOW_SHARE:
        record("23b", "分享 / 取消分享", "skip",
               "发布到站外的动作,未获授权不代按(入口存在=%s)" % has_entry)
        return
    if not has_entry:
        record("23b", "分享 / 取消分享", "fail",
               "命令面板里没有「分享会话」(候选:%s)" % [i["t"][:14] for i in (entries or [])])
        return

    set_clipboard("__UITEST_SENTINEL__")
    focus_app()
    _, picked = palette(ui, "分享会话", pick_text="分享会话")
    # 主判据是**状态真的变了**:分享后命令面板必须开始提供「取消分享」。
    # 不拿「有没有 URL」当主判据 —— URL 走 toast/剪贴板,受时序与焦点影响,
    # 抓不到只说明取证失败,不代表没分享成功(实撞过一次 url=None 但确实已分享)。
    became_shared = wait_until(ui, None, 0) if False else None
    for _ in range(8):
        time.sleep(1.5)
        probe, _ = palette(ui, "取消分享", pick_text=None)
        esc(ui)
        if any("取消分享" in i["t"] for i in (probe or [])):
            became_shared = True
            break
    body_url = ui.ev("""
    (() => { const m=(document.body.innerText||'').match(/https?:\\/\\/[^\\s"']+/);
      return m ? m[0].slice(0,80) : null; })()
    """)
    clip = get_clipboard()
    url = body_url or (clip if clip.startswith("http") else None)

    # 收回链接。两次血泪,判据换了两轮:
    #   ① 第一版用右键菜单收回,而当时会话列表被挤到视口外(x=2337),菜单压根没打开,
    #      脚本只记了个 None 就过去了 —— **一条公开链接留在了站外**;
    #   ② 第二版改走命令面板,并用「面板里不再有取消分享」当判据 —— 它只反映**当前打开的
    #      那条会话**,而此时打开的未必是刚分享的那条,于是又报了「已收回」,
    #      **curl 一测链接还是活的**(页面里赫然是测试语料)。
    # 所以判据只认**站外实测**:curl 拿不到内容才算收回。收不回就大声报错。
    unshared = None
    for attempt in range(4):
        palette(ui, "取消分享", pick_text="取消分享")
        time.sleep(2.5)
        esc(ui)
        if not url:
            break
        if not share_url_live(url):
            unshared = True
            break
        unshared = False
        # 还活着说明刚才取消的不是这条 —— 换一条会话再试
        items = sessions(ui)
        if attempt < len(items):
            ui.click_element(items[attempt], "换一条会话再试收回")
            time.sleep(2.0)

    ok = bool(became_shared and url and unshared)
    record("23b", "分享 → 取消分享(站外实测链接失效)", "ok" if ok else "fail",
           "分享生效=%s;链接=%r;curl 实测已失效=%s%s"
           % (became_shared, url, unshared,
              "  ⚠️⚠️ 链接仍可从站外访问,必须立刻人工收回!" if unshared is False else ""))


def open_session_menu(ui, item):
    """打开某条会话的上下文菜单 —— 是**右键**,不是悬停出来的「更多」按钮。

    第一版按「悬停 → 取面板里第一个可见 button」找,取到的是「新建会话」,
    于是归档/删除全程没跑起来却只报了 None。右键菜单里是:
    重命名 / 分享 / 复制链接 / 归档 / 删除。
    """
    ui.assert_in_viewport(item, "会话行")
    ui.click(item["cx"], item["cy"], button="right")
    time.sleep(1.2)
    return ui.ev("(() => [...document.querySelectorAll('[role=menuitem]')]"
                 ".map(e=>(e.textContent||'').trim()))()") or []


def menu_item(ui, pattern):
    return box_of(ui, """
      (() => [...document.querySelectorAll('[role=menuitem]')]
        .find(e => /%s/.test((e.textContent||'').trim())))()
    """ % pattern)


def check_28_agent(ui):
    """#28 agent 切换(composer 的 Build 下拉)。"""
    esc(ui)
    btn = box_of(ui, """
      (() => { const d=document.querySelector('[data-component="prompt-agent-control"]')
                 || document.querySelector('[data-component="session-prompt-dock"]');
        return d ? [...d.querySelectorAll('button')]
          .find(b=>/^(build|plan|imbot)$/i.test((b.textContent||'').trim())) : null; })()
    """)
    if not btn:
        record(28, "agent 切换", "fail", "找不到 agent 下拉")
        return
    ui.click_element(btn, "agent 下拉")
    time.sleep(1.2)
    opts = ui.ev("""
    (() => [...document.querySelectorAll('[role=option],[role=menuitem]')]
      .map(e=>(e.textContent||'').trim()).filter(Boolean).slice(0,10))()
    """)
    esc(ui)
    ok = bool(opts) and len(opts) >= 2
    record(28, "agent 切换(Build 下拉)", "ok" if ok else "fail", "选项:%s" % json.dumps(opts, ensure_ascii=False))


def seed_session(ui):
    """确保**当前打开的会话**里既有散文消息(⌘F/⌘K 的定义域)又有工具步骤(#37 的对象)。"""
    ensure_session_open(ui, NEEDLE)
    have_prose = NEEDLE in message_area_text(ui)
    have_tool = ui.ev("(() => !!document.querySelector('[data-component=\"tool-trigger\"]'))()")
    if have_prose and have_tool:
        return "已有语料"
    if not have_tool:
        set_shell_mode(ui, True)
        type_into_composer(ui, "echo HELLO_FROM_UITEST && ls -1 %s" % TEST_PROJECT)
        ui.key("Enter", "Enter", vk=13)
        wait_until(ui, "(() => !!document.querySelector('[data-component=\"tool-trigger\"]'))()", 30)
        set_shell_mode(ui, False)
    if not have_prose:
        # 唯一会调用 LLM 的一步:一句极短的提示,拿到可搜索的散文语料
        type_into_composer(ui, SEED_PROMPT)
        ui.key("Enter", "Enter", vk=13)
        for _ in range(40):
            time.sleep(2.0)
            if NEEDLE in message_area_text(ui):
                break
    return "已种入语料"


# ── 主流程 ───────────────────────────────────────────────────
def main():
    ui = UI()
    try:
        geo = ui.window_geometry()
        print("窗口: 视口 %sx%s | 屏幕坐标 x=%s | 在屏幕外=%s"
              % (geo["viewport"]["w"], geo["viewport"]["h"],
                 (geo.get("window") or {}).get("x"), geo.get("offscreen")))
        if geo.get("window_untrusted"):
            print("  ! %s" % geo["window_untrusted"])

        # 硬前提:必须在自建测试项目里。本组含归档/删除/分享,
        # 在 user 真实项目里跑等于拿真实数据练手 —— 不符就整体中止,不给「跑一半」的机会。
        cur = ui.ev("(() => { const t=document.body.innerText||'';"
                    " const m=t.match(/\\/Volumes\\/[^\\n]+/); return m?m[0].trim():null; })()")
        if cur != TEST_PROJECT:
            raise ProbeError(
                "当前项目是 %r,不是测试项目 %r。本组含归档/删除/分享,不在自建项目里跑。"
                "先执行:python3 open_project.py %s" % (cur, TEST_PROJECT, TEST_PROJECT))
        print("项目: %s ✓" % cur)
        print("语料: %s\n" % seed_session(ui))

        for fn in (check_24_find, check_25_global_search, check_28_agent, check_29_shell_mode,
                   check_30_undo_redo, check_31_compact_fork, check_32_session_nav,
                   check_33_message_nav, check_34_copy, check_35_context_usage,
                   check_36_jump_latest, check_37_step_toggle, check_38_export,
                   check_39_abort, check_23_session_list, check_23b_share):
            # 每项开跑前都把前提补回来:上一项可能把它弄没了(分叉会切走、撤销可能清空、
            # 重命名/切换会换到另一条会话),而 session.* 命令一律 `disabled: !params.id`
            # —— 前提没了会让五六个功能一起看起来是坏的。
            # 依赖语料的几项额外要求「打开的是含语料的那条会话」。
            healed = ui.heal_window()
            if healed:
                print("      (窗口自愈:%s)" % healed)
            needs_corpus = fn in (check_24_find, check_31_compact_fork, check_33_message_nav,
                                  check_34_copy, check_35_context_usage, check_37_step_toggle)
            if fn not in (check_23_session_list, check_23b_share):
                if not ensure_session_open(ui, NEEDLE if needs_corpus else None):
                    record(fn.__name__.split("_")[1], fn.__doc__.split("\n")[0][:30], "skip",
                           "找不到%s会话,前提不满足" % ("含语料的" if needs_corpus else "可打开的"))
                    continue
            try:
                fn(ui)
            except ProbeError as e:
                record(fn.__name__.split("_")[1], fn.__doc__.split("\n")[0][:30], "fail",
                       "探针中止:%s" % str(e)[:90])
            esc(ui)

    except ProbeError as e:
        print("\n中止:%s" % e)
        sys.exit(1)
    finally:
        ui.close()

    print()
    ok = [r for r in rows if r[2] == "ok"]
    skip = [r for r in rows if r[2] == "skip"]
    bad = [r for r in rows if r[2] == "fail"]
    print("第 3 组:共 %d 项 — 通过 %d,跳过 %d,待处理 %d" % (len(rows), len(ok), len(skip), len(bad)))
    for no, name, _, detail in skip:
        print("  跳过 #%s %s — %s" % (no, name, detail))
    for no, name, _, detail in bad:
        print("  待处理 #%s %s — %s" % (no, name, detail))


if __name__ == "__main__":
    main()
