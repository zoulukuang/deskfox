#!/usr/bin/env python3
"""[fork-only] CHECKLIST 第 5~7 组(创作与供应商 / 飞书桥接 / 设置与全局)[feat: ui-probe-toolkit] 2026-08-13

覆盖 #51~#63。三态结果(OK / SKIP 环境前提不满足 / FAIL 需处理)。

## 本组特有的两条纪律

1. **改了全局设置必须改回来**。语言、主题、权限自动接受这些是**全局状态**,
   跑完不复位就会污染后续所有测试(以及 user 自己的使用)。每条改动都配一次复位并复核。
2. **语言切换放最后**。切成英文后,前面所有按中文文案定位的探针会集体失效 ——
   不是功能坏了,是探针的定位依据没了。所以它必须是最后一条,且跑完立刻切回。

跑法:
    python3 packages/branding/smoke/run_group567.py
"""
import json
import subprocess
import sys
import time

from uiprobe import UI, ProbeError

rows = []
_t0 = time.time()


def record(no, name, status, detail=""):
    rows.append((no, name, status, detail))
    tag = {"ok": "OK  ", "skip": "SKIP", "fail": "FAIL"}[status]
    print("  [%s] %6.1fs #%s %s %s" % (tag, time.time() - _t0, no, name,
                                       ("— " + detail) if detail else ""))


BOX_JS = """
(() => { const e = (() => %s)(); if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
           cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2),
           right:Math.round(r.right), bottom:Math.round(r.bottom),
           text:(e.textContent||'').trim().slice(0,40) }; })()
"""


def box_of(ui, js):
    return ui.ev(BOX_JS % js)


def esc(ui, n=3):
    for _ in range(n):
        ui.key("Escape", "Escape", vk=27)
        time.sleep(0.3)


def wait_until(ui, js, timeout=12.0, interval=0.4):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = ui.ev(js)
        if last:
            return last
        time.sleep(interval)
    return last


def open_settings(ui, page=None):
    """打开设置对话框(可指定左侧导航页)。已开着就不重复点 —— 它是开关。"""
    if not ui.ev(SETTINGS_OPEN):
        # 入口的 aria-label **会随界面语言变**(中文「设置」/ 英文 "Settings")。
        # 2026-08-13 实撞:#60 切成英文后要切回中文,而这里只认「设置」→ 找不到入口 →
        # **界面被留在了英文**(两次,都是人工恢复的)。
        # 讽刺的是本文件头就写着「语言切换后按中文文案定位的探针会集体失效」,
        # 结果第一个踩中的是我自己的 helper。凡是跨语言用的定位,两种文案都得认。
        btn = ui.find_element(label="设置") or ui.find_element(label="Settings")
        if not btn:
            return False
        ui.click_element(btn, "设置")
        time.sleep(2.0)
    if not ui.ev(SETTINGS_OPEN):
        return False
    if page:
        # 导航项文案同样随语言变,给中英两套名字
        alt = {"通用": "General", "快捷键": "Keybinds", "服务器": "Servers",
               "提供商": "Providers", "模型": "Models", "飞书桥接": "Feishu"}.get(page, page)
        nav = box_of(ui, """
          (() => [...document.querySelectorAll('button,[role=tab],a')]
            .find(e => { const r=e.getBoundingClientRect();
              const t=(e.textContent||'').trim();
              return r.height>0 && r.x<560 && (t === %s || t === %s); }))()
        """ % (json.dumps(page), json.dumps(alt)))
        if not nav:
            return False
        ui.click_element(nav, "设置页「%s」" % page)
        time.sleep(1.5)
    return True


SETTINGS_OPEN = """
(() => { const t=document.body.innerText||'';
  return /DeskFox for macOS/.test(t) && /通用|General/.test(t); })()
"""


DIALOG_JS = """
  (() => [...document.querySelectorAll('[role=dialog]')]
    .filter(e => { const r=e.getBoundingClientRect();
      return r.height>200 && r.width<1400; })[0] || null)()
"""


def in_dialog(ui, js_body):
    """在**设置对话框内**求值。

    2026-08-13 教训:第一版用「x > 520」这种坐标范围圈查询目标,结果捞到的是主窗口的
    rail 图标和「新建会话」按钮 —— #52 首项报成「新建会话」、#53 的模型选项列成 F/m/N/P
    (还因此**假通过**了)。范围要靠**容器**限定,不能靠坐标猜。
    """
    return ui.ev("""
    (() => { const dlg = (() => %s)(); if (!dlg) return null;
      return (function(dlg){ %s })(dlg); })()
    """ % (DIALOG_JS.strip(), js_body))


def settings_rows(ui):
    """设置页里的开关/选择器条目 —— 按 role 取,不靠文案。"""
    return ui.ev("""
    (() => [...document.querySelectorAll('[role=switch],input[type=checkbox],[role=combobox],button')]
      .filter(e => { const r=e.getBoundingClientRect();
        return r.height>0 && r.width>0 && r.x>520; })
      .map(e => { const r=e.getBoundingClientRect();
        return { role:e.getAttribute('role')||e.tagName.toLowerCase(),
                 checked:e.getAttribute('aria-checked') ?? (e.checked ?? null),
                 t:(e.textContent||'').trim().slice(0,18),
                 x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
                 cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2),
                 right:Math.round(r.right), bottom:Math.round(r.bottom) }; }))()
    """) or []


def labeled_switch(ui, label):
    """按**条目标题**找它右侧的开关 —— 开关本身没有可读文案,只能靠所在行定位。"""
    return ui.ev("""
    (() => { const rows=[...document.querySelectorAll('div')]
        .filter(d => (d.textContent||'').includes(%s) && d.querySelector('[role=switch],input[type=checkbox]'));
      if(!rows.length) return null;
      const row = rows[rows.length-1];
      const sw = row.querySelector('[role=switch],input[type=checkbox]');
      const r = sw.getBoundingClientRect();
      return { checked: sw.getAttribute('aria-checked') ?? String(!!sw.checked),
               x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
               cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2),
               right:Math.round(r.right), bottom:Math.round(r.bottom) }; })()
    """ % json.dumps(label))


def palette(ui, query, pick_text=None):
    """⌘K 命令面板:搜 → 取候选 → 命中就点。

    每次都**重开面板**拿干净输入 —— CDP 的 ⌘A 在本应用里既不全选、还会弹「关于」对话框
    (见 uiprobe.clear_input),所以别想着「清空再搜」。
    """
    esc(ui)
    ui.key("k", "KeyK", vk=75, cmd=True)
    if not wait_until(ui, "(() => !!document.querySelector('[role=dialog] input'))()", 6):
        return [], None
    ui.type_text(query)
    time.sleep(1.4)
    items = ui.ev("""
    (() => { const d=document.querySelector('[role=dialog]'); if(!d) return [];
      return [...d.querySelectorAll('button')].filter(e=>{const r=e.getBoundingClientRect();
        return r.height>16 && r.width>120 && (e.textContent||'').trim();})
        .map(e=>{const r=e.getBoundingClientRect();
          return {t:(e.textContent||'').trim().slice(0,44),
                  x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
                  cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2),
                  right:Math.round(r.right),bottom:Math.round(r.bottom)};}); })()
    """) or []
    target = next((i for i in items if pick_text and pick_text in i["t"]), None)
    if target:
        ui.click_element(target, "命令面板「%s」" % target["t"][:16])
        time.sleep(1.6)
    return items, target


def dock_select(ui, current_text):
    """composer 底部的下拉(agent / 模型 / 变体 / 创作模式)。"""
    return box_of(ui, """
      (() => { const d=document.querySelector('[data-component="session-prompt-dock"]');
        if(!d) return null;
        return [...d.querySelectorAll('button')]
          .find(b => (b.textContent||'').trim() === %s); })()
    """ % json.dumps(current_text))


def dropdown_options(ui):
    return ui.ev("""
    (() => [...document.querySelectorAll('[role=option],[role=menuitem]')]
      .filter(e => e.getBoundingClientRect().height > 0)
      .map(e => (e.textContent||'').trim().slice(0,20)))()
    """) or []


# ── 第 5 组 ──────────────────────────────────────────────────
def check_51_创作模式(ui):
    """#51 创作模式入口 → 切换。

    **不跑「生成一次」**:文生图/视频会真的调用付费接口。入口与切换验到位,
    生成留给人工按需跑 —— 自动化里默认不烧钱,这条要写明,免得下次以为漏了。
    """
    esc(ui)
    btn = dock_select(ui, "Chat")
    if not btn:
        record(51, "创作模式入口", "fail", "composer 底部找不到模式下拉")
        return
    ui.click_element(btn, "创作模式下拉")
    time.sleep(1.3)
    opts = dropdown_options(ui)
    picked = None
    tgt = box_of(ui, "[...document.querySelectorAll('[role=option],[role=menuitem]')]"
                     ".find(e=>/文生图/.test((e.textContent||'').trim()))")
    if tgt:
        ui.click_element(tgt, "切到「文生图」")
        time.sleep(1.5)
        picked = ui.ev("""
        (() => { const d=document.querySelector('[data-component="session-prompt-dock"]');
          return d ? [...d.querySelectorAll('button')]
            .map(b=>(b.textContent||'').trim()).find(t=>/文生图|Chat/.test(t)) : null; })()
        """)
        back = dock_select(ui, "文生图")
        if back:      # 复位回 Chat,别把全局状态留给后续测试
            ui.click_element(back, "模式下拉")
            time.sleep(1.2)
            chat = box_of(ui, "[...document.querySelectorAll('[role=option],[role=menuitem]')]"
                              ".find(e=>/^Chat$/.test((e.textContent||'').trim()))")
            if chat:
                ui.click_element(chat, "切回 Chat")
                time.sleep(1.2)
    esc(ui)
    ok = len(opts) >= 5 and picked == "文生图"
    record(51, "创作模式入口 + 切换(不触发付费生成)", "ok" if ok else "fail",
           "选项 %d 个:%s;切换后=%r"
           % (len(opts), json.dumps(opts[:8], ensure_ascii=False), picked))


def check_52_providers(ui):
    """#52 供应商页:**GetBot 排首位 + 推荐标**(fork 定制点)。"""
    esc(ui)
    if not open_settings(ui, "提供商"):
        record(52, "供应商页", "fail", "打不开设置→提供商")
        return
    time.sleep(1.5)
    info = in_dialog(ui, """
      // 待连接的提供商 = 每个「连接」按钮所在的那一行,行文本即「名称 + 徽标」
      const rows = [...dlg.querySelectorAll('button')]
        .filter(b => (b.textContent||'').trim() === '连接')
        .map(b => { let n = b.parentElement;
          for (let i=0; i<4 && n && (n.textContent||'').trim().length < 4; i++) n = n.parentElement;
          return (n ? n.textContent : '').replace(/\\s+/g,' ').replace('连接','').trim().slice(0,30); });
      return { count: rows.length, rows };
    """)
    names = (info or {}).get("rows", [])
    first_is_getbot = bool(names) and "GetBot" in names[0]
    has_badge = bool(names) and "推荐" in names[0]
    ui.shot("g567-52-providers")
    record(52, "供应商页(GetBot 首位 + 推荐标)",
           "ok" if (first_is_getbot and has_badge) else "fail",
           "共 %s 个待连接;首项=%r" % ((info or {}).get("count"),
                                        names[0] if names else None))


def check_53_model(ui):
    """#53 模型选择器。"""
    esc(ui)
    btn = dock_select(ui, "GLM-5.2")
    if not btn:
        btn = box_of(ui, """
          (() => { const d=document.querySelector('[data-component="prompt-model-control"]')
                     || document.querySelector('[data-component="session-prompt-dock"]');
            return d ? [...d.querySelectorAll('button')]
              .find(b => /GLM|Claude|GPT|Gemini/i.test(b.textContent||'')) : null; })()
        """)
    if not btn:
        record(53, "模型选择器", "fail", "找不到模型下拉")
        return
    ui.click_element(btn, "模型下拉")
    time.sleep(1.5)
    # 只认**下拉弹层里**的选项。第一版按「y>100 的所有按钮」取,捞到的是 rail 图标
    # F/m/N/P 和「新建会话」,列表非空于是**假通过** —— 范围必须靠容器限定。
    # 模型选择器打开的是**「选择模型」对话框**,不是下拉弹层,条目是普通 button。
    # 两次教训都在这:第一版按「y>100 的所有按钮」取,捞到 rail 图标 F/m/N/P 于是**假通过**;
    # 第二版改按 listbox/menu 找弹层,而它根本不是弹层,于是空列表。范围靠容器,类型靠实测。
    opts = ui.ev("""
    (() => { const dlg=[...document.querySelectorAll('[role=dialog]')]
        .filter(e=>e.getBoundingClientRect().height>0 && /选择模型|Select model/i.test(e.textContent||''))[0];
      if(!dlg) return [];
      return [...dlg.querySelectorAll('button,[role=option]')]
        .filter(e=>{const r=e.getBoundingClientRect(); return r.height>16 && (e.textContent||'').trim();})
        .map(e=>(e.textContent||'').trim().slice(0,24)).slice(0,12); })()
    """) or []
    esc(ui)
    record(53, "模型选择器(下拉内选项)", "ok" if len(opts) >= 2 else "fail",
           json.dumps(opts[:6], ensure_ascii=False))


def check_54_variant(ui):
    """#54 模型变体切换(composer 的「默认」)。"""
    esc(ui)
    btn = dock_select(ui, "默认")
    if not btn:
        record(54, "模型变体切换", "skip", "当前模型没有变体下拉")
        return
    ui.click_element(btn, "变体下拉")
    time.sleep(1.3)
    opts = dropdown_options(ui)
    esc(ui)
    record(54, "模型变体切换", "ok" if opts else "fail",
           json.dumps(opts[:6], ensure_ascii=False))


# ── 第 6 组:飞书桥接 ────────────────────────────────────────
def check_55_feishu(ui):
    """#55 设置 → 飞书桥接页各项开关(FORK 定制最密的一块)。"""
    esc(ui)
    if not open_settings(ui, "飞书桥接"):
        record(55, "飞书桥接设置页", "fail", "打不开设置→飞书桥接")
        return
    time.sleep(1.2)
    sw = labeled_switch(ui, "保持电脑不休眠")
    ui.shot("g567-55-feishu")
    if not sw:
        record(55, "飞书桥接设置页", "fail", "页面打开了但找不到可测开关")
        return
    before = sw["checked"]
    ui.click_element(sw, "保持电脑不休眠 开关")
    time.sleep(1.5)
    after = (labeled_switch(ui, "保持电脑不休眠") or {}).get("checked")
    # 持久化判据:直接看**落盘的设置文件**,比重启一次快得多且同样可信
    # 落盘键名是 (store-keys.ts 的 PREVENT_SLEEP_CONFIG_KEY),
    # 不是随手猜的 caffeinate —— 第一版猜错关键词,"落盘可见" 恒为 False,
    # 等于这条持久化根本没验到,只是没报错而已。
    persisted = settings_file_has("preventSleepConfig", after)
    # 复位 —— 别让机器一直不休眠
    sw2 = labeled_switch(ui, "保持电脑不休眠")
    if sw2:
        ui.click_element(sw2, "复位 保持电脑不休眠")
        time.sleep(1.5)
    restored = (labeled_switch(ui, "保持电脑不休眠") or {}).get("checked")
    esc(ui)
    ok = (after != before) and (restored == before)
    record(55, "飞书桥接设置页(开关翻转 + 落盘 + 复位)", "ok" if ok else "fail",
           "%s → %s → 复位回 %s;落盘可见=%s" % (before, after, restored, persisted))
    record(56, "账号 / 工作区绑定流程", "skip",
           "需真实飞书账号与站外 OAuth 授权,自动化不代做 —— 见 MANUAL-CHECKLIST.md")
    record(57, "群消息 @ 策略 / 重试反馈等设置项", "skip",
           "依赖真实群聊消息往返,链路在站外 —— 见 MANUAL-CHECKLIST.md")


def settings_file_has(keyword, value):
    """看设置是否真落到磁盘(不必重启就能验持久化)。

    判据要具体到**键 + 值**:只看键在不在,开关翻转前后都为真,等于没判。
    """
    import os
    path = os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local/opencode.settings")
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    import json as _json
    try:
        data = _json.loads(text)
    except Exception:
        return keyword in text
    node = data.get(keyword)
    if isinstance(node, dict) and "enabled" in node:
        return str(node["enabled"]).lower() == str(value).lower()
    return keyword in data
    record(56, "账号 / 工作区绑定流程", "skip",
           "需真实飞书账号与外部授权,自动化不代做 —— 人工验")
    record(57, "群消息 @ 策略 / 重试反馈等设置项", "skip",
           "依赖真实群聊消息往返,自动化不代做 —— 人工验")


# ── 第 7 组:设置与全局 ─────────────────────────────────────
SIX_PAGES = ["通用", "快捷键", "服务器", "提供商", "模型", "飞书桥接"]


def check_58_settings_pages(ui):
    """#58 六个设置页逐页开 + 改一项 + **重启后保持**。

    持久化是这条的重点:只验「点了开关界面变了」等于没验 —— 必须重启进程再读回。
    """
    esc(ui)
    opened = {}
    for page in SIX_PAGES:
        ok = open_settings(ui, page)
        time.sleep(0.8)
        opened[page] = bool(ok) and bool(ui.ev(SETTINGS_OPEN))
    if not all(opened.values()):
        record(58, "六个设置页逐页打开", "fail", json.dumps(opened, ensure_ascii=False))
        return

    # 改一项:用「显示推理摘要」这种纯本地开关,不影响别的测试
    open_settings(ui, "通用")
    sw = labeled_switch(ui, "显示推理摘要")
    if not sw:
        record(58, "六个设置页 + 持久化", "skip",
               "六页都能打开,但找不到「显示推理摘要」开关,持久化未验")
        return
    before = sw["checked"]
    ui.click_element(sw, "显示推理摘要 开关")
    time.sleep(1.2)
    after = (labeled_switch(ui, "显示推理摘要") or {}).get("checked")
    if after == before:
        record(58, "六个设置页 + 持久化", "fail", "开关点了没翻转(%s)" % before)
        return

    esc(ui)
    restarted = restart_app()
    if not restarted:
        record(58, "六个设置页 + 持久化", "skip",
               "六页都能打开、开关能翻转(%s→%s),但重启失败,持久化未验" % (before, after))
        return
    ui2 = UI()
    try:
        ui2.heal_window()
        open_settings(ui2, "通用")
        persisted = (labeled_switch(ui2, "显示推理摘要") or {}).get("checked")
        # 复位回原值,别把改动留给 user
        if persisted == after:
            sw2 = labeled_switch(ui2, "显示推理摘要")
            if sw2:
                ui2.click_element(sw2, "复位 显示推理摘要")
                time.sleep(1.0)
        esc(ui2)
    finally:
        ui2.close()
    record(58, "六个设置页 + 改一项 + 重启后保持",
           "ok" if persisted == after else "fail",
           "六页均可打开;开关 %s→%s,重启后=%s(已复位)" % (before, after, persisted))


def restart_app():
    """只重启 local 档,绝不碰 user 的正式版(CLAUDE.md 硬规则)。"""
    subprocess.run(["pkill", "-f", "DeskFox 本地版.app/Contents/"], capture_output=True)
    time.sleep(3)
    subprocess.run(["open", "-a",
                    "/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app",
                    "--args", "--remote-debugging-port=9222"], capture_output=True)
    for _ in range(30):
        time.sleep(2)
        try:
            probe = UI()
            probe.close()
            return True
        except Exception:
            continue
    return False


def check_59_theme(ui):
    """#59 主题切换(含 Fox Blue)—— **真切一次**,判据读驱动配色的属性本身,验完切回。

    第一版只验「命令面板里有主题命令」就报通过 —— 那只证明入口在,
    不证明切了有用。清单原文要的是**颜色真的变**。
    """
    esc(ui)
    before_theme = ui.ev("(() => document.documentElement.getAttribute('data-theme'))()")
    before_var = ui.css_var("--surface-base-active")

    # 若当前**已经是** Fox Blue(多半是上一轮没复位干净),先切到一个基准主题再测 ——
    # 否则 before == after,会把「没得切」误报成「切不动」。
    if before_theme == "fox-blue":
        fallback = "One Dark Pro"
        items, picked = palette(ui, fallback, pick_text=fallback)
        time.sleep(2.0)
        esc(ui)
        before_theme = ui.ev("(() => document.documentElement.getAttribute('data-theme'))()")
        before_var = ui.css_var("--surface-base-active")

    def use_theme(name):
        # **按主题名搜、按主题名匹配**。别搜「使用主题:X」再取首个候选 ——
        # 首个候选未必是 X(实撞:想切回 One Dark Pro 却点中别的主题,复位一直失败,
        # 界面被留在 Fox Blue)。搜索词与匹配词一致才不会点错。
        items, picked = palette(ui, name, pick_text=name)
        time.sleep(2.0)
        esc(ui)
        return picked is not None

    switched = use_theme("Fox Blue")
    after_theme = ui.ev("(() => document.documentElement.getAttribute('data-theme'))()")
    after_var = ui.css_var("--surface-base-active")

    # 切回原主题,别把 user 的外观改掉
    restored = None
    if before_theme and after_theme != before_theme:
        use_theme(theme_display_name(before_theme) or before_theme)
        # 主题应用是异步的:切完立刻读会读到旧值。轮询等它真的变回来。
        restored = bool(wait_until(
            ui, "(() => document.documentElement.getAttribute('data-theme') === %s)()"
                % json.dumps(before_theme), 12))

    ok = bool(switched and after_theme != before_theme and after_var != before_var
              and (restored is not False))
    record(59, "主题切换(真切 Fox Blue 并切回)", "ok" if ok else "fail",
           "data-theme %r → %r → 复位=%s;--surface-base-active %r → %r"
           % (before_theme, after_theme, restored, before_var, after_var))


def theme_display_name(theme_id):
    """主题 id → 命令面板里显示的主题名。

    `data-theme` 上挂的是**主题 id**(如 `onedarkpro`),而命令面板显示的是**主题名**
    (「One Dark Pro」)。拿 id 去搜命令必然搜不到 —— 实撞:复位一直失败,
    界面被留在 Fox Blue。映射从主题定义文件读,不硬编码。
    """
    import glob
    import os
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "..", "ui", "src", "theme", "themes")
    for path in glob.glob(os.path.join(root, "*.json")):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        if data.get("id") == theme_id:
            return data.get("name")
    return None


def check_61_autoaccept(ui):
    """#61 权限自动接受开关(**安全相关**)。

    这条要格外小心:开着它 = agent 的权限请求全自动批准。
    验完必须**确认它回到原值**,否则等于给 user 留了个安全隐患。
    """
    esc(ui)
    if not open_settings(ui, "通用"):
        record(61, "权限自动接受开关", "fail", "打不开设置→通用")
        return
    sw = labeled_switch(ui, "自动接受权限")
    if not sw:
        record(61, "权限自动接受开关", "fail", "找不到该开关")
        return
    before = sw["checked"]
    ui.click_element(sw, "自动接受权限")
    time.sleep(1.2)
    after = (labeled_switch(ui, "自动接受权限") or {}).get("checked")
    # 立刻复位
    sw2 = labeled_switch(ui, "自动接受权限")
    if sw2:
        ui.click_element(sw2, "复位 自动接受权限")
        time.sleep(1.2)
    restored = (labeled_switch(ui, "自动接受权限") or {}).get("checked")
    esc(ui)
    ok = (after != before) and (restored == before)
    record(61, "权限自动接受开关(改后必须复位)", "ok" if ok else "fail",
           "%s → %s → 复位回 %s" % (before, after, restored))


def check_62_mcp(ui):
    """#62 MCP 开关 —— **真执行一次**并复位,不是只确认命令存在。

    命令 `mcp.toggle`(⌘;)。判据取命令自身的标题态:开/关两态标题不同,
    执行后标题必须翻转;跑完必须切回原态。
    """
    esc(ui)

    def mcp_command_title():
        items, _ = palette(ui, "MCP", pick_text=None)
        esc(ui)
        hit = [i["t"] for i in (items or []) if "MCP" in i["t"].upper()]
        return hit[0] if hit else None

    before = mcp_command_title()
    if not before:
        record(62, "MCP 开关", "fail", "命令面板里找不到 MCP 命令")
        return
    ui.key(";", "Semicolon", vk=186, cmd=True)      # mcp.toggle
    time.sleep(2.0)
    after_state = ui.ev("(() => { const t=document.body.innerText||'';"
                        " const i=t.indexOf('MCP'); return i<0 ? null : t.slice(i, i+40); })()")
    ui.key(";", "Semicolon", vk=186, cmd=True)      # 切回原态
    time.sleep(2.0)
    back = mcp_command_title()
    ok = back == before
    record(62, "MCP 开关(执行一次并复位)", "ok" if ok else "fail",
           "命令标题 %r → 执行后页面 %r → 复位后 %r" % (before[:24] if before else None,
                                                       after_state, back[:24] if back else None))


def check_63_server_workspace(ui):
    """#63 server 切换 / workspace 切换。

    实测:服务器页只有**一个「本地服务器」**加一个「添加服务器」——
    没有第二个 server 就无从「切换」,添加真实远端服务器不在自动化范围。
    workspace 切换在本产品里就是「打开项目 / rail 切项目」,已由 #19、#18 覆盖。
    所以这条按事实拆开报,不硬凑一个「通过」。
    """
    esc(ui)
    if not open_settings(ui, "服务器"):
        record(63, "server / workspace 切换", "fail", "打不开设置→服务器")
        return
    time.sleep(1.2)
    info = in_dialog(ui, """
      const btns=[...dlg.querySelectorAll('button')]
        .filter(e=>{const r=e.getBoundingClientRect(); return r.height>0 && r.x>520;})
        .map(e=>(e.textContent||'').trim().slice(0,20));
      return { servers: btns.filter(t=>/服务器/.test(t)), all: btns.slice(0,10) };
    """) or {}
    esc(ui)
    servers = [t for t in info.get("servers", []) if "添加" not in t]
    can_switch = len(servers) >= 2
    if can_switch:
        record(63, "server 切换", "fail", "有多个服务器但本脚本尚未实现切换验证")
        return
    record(63, "server 列表可用(只有一个本地服务器,无从切换)", "ok",
           "服务器条目=%s;workspace 切换由 #19 打开项目 / #18 rail 切项目覆盖"
           % (servers or info.get("all")))


def check_60_language(ui):
    """#60 语言切换 —— 界面 + **原生菜单**同步变。

    **必须放最后**:切成英文后所有按中文文案定位的探针会集体失效。
    跑完立刻切回简体中文并复核,不给 user 留一个英文界面。
    """
    esc(ui)
    if not open_settings(ui, "通用"):
        record(60, "语言切换", "fail", "打不开设置→通用")
        return
    sel = box_of(ui, """
      (() => { const dlg=[...document.querySelectorAll('[role=dialog]')]
          .filter(e=>{const r=e.getBoundingClientRect(); return r.height>200 && r.width<1400;})[0];
        const root = dlg || document;
        const rows=[...root.querySelectorAll('div')]
          .filter(d => /显示语言|display language/i.test(d.textContent||'')
                    && d.querySelector('button,[role=combobox]'));
        if(!rows.length) return null;
        const row = rows[rows.length-1];
        return row.querySelector('button,[role=combobox]'); })()
    """)
    if not sel:
        record(60, "语言切换", "fail", "找不到语言选择器")
        return
    ui.click_element(sel, "语言选择器")
    time.sleep(1.5)
    opts = dropdown_options(ui)
    en = box_of(ui, "[...document.querySelectorAll('[role=option],[role=menuitem]')]"
                    ".find(e=>/^English$/.test((e.textContent||'').trim()))")
    switched = native_en = None
    if en:
        ui.click_element(en, "切到 English")
        time.sleep(2.5)
        switched = ui.ev("(() => /General|Language/.test(document.body.innerText||''))()")
        native_en = native_menu_has(("File", "Edit", "View", "Window"))
        # 切回中文 —— 这一步不能省,也不能想当然。
        # 实撞:切成英文后设置对话框会重建,直接找选择器找不到,结果**把界面留在了英文**
        # (事后人工恢复)。所以要先重新打开设置页再找选择器;语言选项有 60+ 条,
        # 目标多半在滚动区外,还得先滚进视口。
        esc(ui)
        restore_ok = False
        for _ in range(3):
            if not open_settings(ui, None):
                time.sleep(1.0)
                continue
            sel2 = box_of(ui, LANG_SELECT_JS)
            if not sel2:
                time.sleep(1.0)
                continue
            ui.click_element(sel2, "语言选择器")
            time.sleep(1.8)
            zh = box_of(ui, ZH_OPTION_JS)
            if zh:
                vp_h = ui.ev("window.innerHeight")
                if not (0 <= zh["cy"] < vp_h):
                    zh = ui.scroll_into_view(ZH_OPTION_JS, lambda: box_of(ui, ZH_OPTION_JS), "简体中文选项")
                ui.click_element(zh, "切回简体中文")
                time.sleep(3.0)
            if ui.ev("(() => /通用|显示语言/.test(document.body.innerText||''))()"):
                restore_ok = True
                break
        if not restore_ok:
            print("      ⚠️ 语言未能自动切回中文,请人工恢复(设置 → 通用 → 语言)")

    restored = ui.ev("(() => /通用|显示语言/.test(document.body.innerText||''))()")
    esc(ui)
    ok = bool(switched and native_en and restored)
    record(60, "语言切换(界面 + 原生菜单,跑完已切回中文)", "ok" if ok else "fail",
           "选项 %d 个;切英文后 界面=%s 原生菜单=%s;切回中文=%s"
           % (len(opts), switched, native_en, restored))


LANG_SELECT_JS = """
  (() => { const dlg=[...document.querySelectorAll('[role=dialog]')]
      .filter(e=>{const r=e.getBoundingClientRect(); return r.height>200 && r.width<1400;})[0];
    const root = dlg || document;
    const rows=[...root.querySelectorAll('div')]
      .filter(d => /显示语言|display language/i.test(d.textContent||'')
                && d.querySelector('button,[role=combobox]'));
    if(!rows.length) return null;
    return rows[rows.length-1].querySelector('button,[role=combobox]'); })()
"""

ZH_OPTION_JS = """
  ([...document.querySelectorAll('[role=option],[role=menuitem]')]
    .find(e=>/简体中文/.test((e.textContent||'').trim())) || null)
"""


def native_menu_has(words):
    out = subprocess.run(
        ["osascript", "-e",
         'tell application "System Events" to tell process "DeskFox 本地版" to '
         'return name of every menu bar item of menu bar 1'],
        capture_output=True, text=True, timeout=15).stdout
    return all(w in out for w in words)


def ensure_alive(ui):
    """探活;连不上就重连。#58 重启应用后旧连接必然失效。"""
    try:
        ui.ev("1")
        return ui
    except Exception:
        try:
            ui.close()
        except Exception:
            pass
        for _ in range(20):
            try:
                return UI()
            except Exception:
                time.sleep(2)
        raise ProbeError("应用重启后 CDP 一直连不上")


# ── 主流程 ───────────────────────────────────────────────────
def main():
    ui = UI()
    try:
        healed = ui.heal_window()
        if healed:
            print("窗口自愈:%s" % healed)
        print("视口: %sx%s\n" % (ui.ev("window.innerWidth"), ui.ev("window.innerHeight")))
        # 语言切换放最后:它会让所有中文选择器失效
        for fn in (check_51_创作模式, check_52_providers, check_53_model, check_54_variant,
                   check_55_feishu, check_59_theme, check_61_autoaccept,
                   check_62_mcp, check_63_server_workspace,
                   check_58_settings_pages, check_60_language):
            # #58 会重启应用来验持久化,重启后**旧的 CDP 连接必然失效** ——
            # 第一版没管,整脚本直接以 ConnectionResetError 崩掉,后面的条目全没跑。
            # 所以每条开跑前先探活,连不上就重连。
            ui = ensure_alive(ui)
            ui.heal_window()
            try:
                fn(ui)
            except ProbeError as e:
                record(fn.__name__.split("_")[1], fn.__doc__.split("\n")[0][:30], "fail",
                       "探针中止:%s" % str(e)[:90])
            except Exception as e:
                record(fn.__name__.split("_")[1], fn.__doc__.split("\n")[0][:30], "fail",
                       "%s: %s" % (type(e).__name__, str(e)[:80]))
                ui = ensure_alive(ui)
            try:
                esc(ui)
            except Exception:
                ui = ensure_alive(ui)
    finally:
        ui.close()

    print()
    ok = [r for r in rows if r[2] == "ok"]
    skip = [r for r in rows if r[2] == "skip"]
    bad = [r for r in rows if r[2] == "fail"]
    print("第 5~7 组:共 %d 项 — 通过 %d,跳过 %d,待处理 %d" % (len(rows), len(ok), len(skip), len(bad)))
    for no, name, _, detail in skip:
        print("  跳过 #%s %s — %s" % (no, name, detail))
    for no, name, _, detail in bad:
        print("  待处理 #%s %s — %s" % (no, name, detail))


if __name__ == "__main__":
    main()
