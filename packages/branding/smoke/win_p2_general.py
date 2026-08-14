#!/usr/bin/env python3
"""[fork-only] P2 通用抽验 + 更新器 + WSL [feat: upstream-sync-2026-08] 2026-08-14

对应 `6-windows-handoff.md` §二 P1-3(更新器)/ §二 P2(抽验)/ §二 P2-2(WSL)。

Mac 端已全绿的通用功能不重跑,只挑**最容易被平台差异打到**的:
本轮修过的两个回归点(文件树焦点 / 查找框关闭键)、fork 最核心定制点(GetBot 排首位)、
设置持久化,以及 Win 上必须单独确认的更新器置灰与 WSL 不阻塞。

跑法:python packages/branding/smoke/win_p2_general.py
"""
import json
import sys
import time

from uiprobe import UI, ProbeError

rows = []


def record(no, name, status, detail=""):
    rows.append((no, name, status, detail))
    print("  [%s] %s %s %s" % ({"ok": "OK  ", "skip": "SKIP", "fail": "FAIL"}[status],
                               no, name, ("— " + detail) if detail else ""))


def modal_count(ui):
    """当前开着几个模态弹窗。

    模态遮罩会吃掉所有点击 —— 任何「点了没反应 / 焦点跑到 body」的结论,
    在弹窗开着时都不成立。凡是靠点击的用例,跑之前都得先问这一句。
    """
    return ui.ev("""
    (() => [...document.querySelectorAll('[role=dialog],[data-slot=dialog-content]')]
      .filter(e => e.getBoundingClientRect().height > 0).length)()
    """) or 0


def reset_ui(ui, tries=3):
    """把界面复位到无弹窗态。复位不掉就明说,而不是硬着头皮往下跑。"""
    for _ in range(tries):
        if not modal_count(ui):
            return True
        ui.key("Escape", "Escape", 27)
        time.sleep(0.6)
    left = modal_count(ui)
    if left:
        print("[warn] 仍有 %d 个弹窗关不掉 —— 后续点击类用例的结论都不可信" % left, file=sys.stderr)
    return not left


def main():
    ui = UI()
    try:
        geo = ui.window_geometry()
        print("窗口: 视口 %sx%s | 平台 %s\n" % (geo["viewport"]["w"], geo["viewport"]["h"], geo.get("platform")))

        # 开跑前把界面复位到干净态。
        # 2026-08-14 实撞:上一个脚本收尾时留了个**模态弹窗**没关,本脚本 G-1 一上来点文件树,
        # 点击被遮罩吃掉 → activeElement=body → 报「焦点没落入文件树」FAIL。
        # 实测坐实(弹窗开着时 6/6 都是 body;关掉后 12/12 都在树内)—— 这是模态框的**正确**行为,
        # 不是缺陷。把复位 + 前提断言做进来,免得下一个人再排查一遍。
        reset_ui(ui)

        # ── G-1 文件树点文件后焦点真正落入文件树(本轮修过的回归点)──
        # 2026-08-13 Mac 端查出的根因:点完 activeElement 是 body,导致键盘作用域失效
        # (失焦后回车仍切预览)。修法在 file-tree-focus.ts,Win 上必须复验 ——
        # 焦点行为受平台原生焦点策略影响,不是纯 JS 逻辑。
        row = ui.ev("""
        (() => { const el = [...document.querySelectorAll('[data-tree-path]')]
            .find(e => { const p = e.getAttribute('data-tree-path')||'';
                         return !p.endsWith('/') && !p.endsWith('\\\\')
                                && e.getBoundingClientRect().height > 0; });
          if (!el) return null; const r = el.getBoundingClientRect();
          return { path: el.getAttribute('data-tree-path'),
                   cx: Math.round(r.x+r.width/2), cy: Math.round(r.y+r.height/2) }; })()
        """)
        if modal_count(ui):
            record("G-1", "点文件树后焦点落入文件树", "skip",
                   "有模态弹窗开着,点击会被遮罩吃掉 —— 前提不满足,不是缺陷")
            row = None
        if not row:
            if not any(r[0] == "G-1" for r in rows):
                record("G-1", "点文件树后焦点落入文件树", "skip", "文件树里没有可见的文件条目")
        else:
            ui.click(row["cx"], row["cy"])
            time.sleep(1.2)
            fs = ui.focus_state('[data-component="filetree"]')
            ok = bool(fs and fs.get("inContainer"))
            record("G-1", "点文件树后焦点落入文件树", "ok" if ok else "fail",
                   "点 %s → activeElement=%s(在文件树内=%s)"
                   % (row["path"], fs.get("tag"), fs.get("inContainer")))

        # ── G-2 会话内查找 Ctrl+F 的关闭键可点(本轮修过的回归点)──
        # 原缺陷:右侧面板盖住关闭按钮 → 点不到。判据用 is_occluded 做命中测试,
        # 不看「按钮存不存在」—— 它一直都存在,问题是被盖住。
        ui.key("Escape", "Escape", 27)
        time.sleep(0.3)
        ui.key("f", "KeyF", 70, ctrl=True)
        time.sleep(1.5)
        # 目标必须**精确锁定查找框的关闭键**。
        # 2026-08-14 实撞:第一版用 /关闭|close/ 泛匹配再取最后一个,终端开着时抓到的是
        # 「关闭终端」(y=823,已在视口 804 之外)→ elementFromPoint 三点全 null →
        # 报「被遮挡」FAIL。**遮挡检测对视口外的元素没有意义**,那是「没滚到/不在视口」,
        # 两种结论的处置完全不同。故:① 只认「关闭搜索」;② 测遮挡前先做视口断言。
        close_btn = ui.ev("""
        (() => { const cands = [...document.querySelectorAll('button,[role=button]')]
            .filter(e => { const r = e.getBoundingClientRect();
              const lb = (e.getAttribute('aria-label')||'') + (e.textContent||'');
              return r.height > 0 && r.width > 0 && /关闭搜索|close search/i.test(lb); });
          if (!cands.length) return null;
          const e = cands[0]; const r = e.getBoundingClientRect();
          return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
                   cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2),
                   right:Math.round(r.right), bottom:Math.round(r.bottom),
                   label: e.getAttribute('aria-label') }; })()
        """)
        if not close_btn:
            record("G-2", "查找框关闭键可点", "skip",
                   "Ctrl+F 后找不到「关闭搜索」按钮 —— 查找框可能没打开(需先有会话)")
        else:
            try:
                ui.assert_in_viewport(close_btn, "查找框关闭键")
            except ProbeError as e:
                record("G-2", "查找框关闭键可点", "skip", "目标不在视口内,遮挡检测无意义:%s" % e)
                close_btn = None
        if close_btn:
            occ = ui.is_occluded(close_btn)
            hit_self = [h for h in occ["hits"] if h.get("tag")]
            ok = bool(hit_self) and not occ["occluded"]
            record("G-2", "查找框关闭键可点(不被右侧面板盖住)", "ok" if ok else "fail",
                   "按钮 %s @(%s,%s) 命中 %s"
                   % (close_btn.get("label"), close_btn["cx"], close_btn["cy"],
                      json.dumps([h.get("tag") for h in occ["hits"]], ensure_ascii=False)))
            ui.key("Escape", "Escape", 27)
            time.sleep(0.4)

        # ── G-3 GetBot 排首位 + 推荐标(fork 最核心定制点)────────
        # 教训:上游大换代后 fork 定制会「代码还在、用户点不到」,必须真机点进去看。
        #
        # 入口选择有讲究:**设置→提供商页看不到这条** —— GetBot 一旦已连接就归入
        # 「已连接的提供商」区,不再出现在「热门提供商」里(本机实测如此)。
        # 要验「热门首位」必须打开**连接提供商弹窗**(dialog-connect-provider.tsx),
        # 它的 FORK 定制是 `featured = ["getbot", ...]` 强制置顶 + 推荐标。
        # 弹窗入口按钮在引导区、常态 height=0 点不到,所以走命令面板触发。
        ui.key("Escape", "Escape", 27)
        time.sleep(0.5)
        ui.key("k", "KeyK", 75, ctrl=True)
        time.sleep(1.5)
        ui.type_text("连接提供商")
        time.sleep(2.0)
        ui.key("Enter", "Enter", 13)
        time.sleep(3.0)
        provider_rows = ui.ev("""
        (() => { const items = [...document.querySelectorAll('[role=option],button,[role=menuitem]')]
            .filter(e => { const r = e.getBoundingClientRect(); return r.height > 30 && r.width > 200; })
            .map(e => (e.textContent||'').trim().replace(/\\s+/g,' ').slice(0, 70));
          return [...new Set(items)].filter(t => t.length > 1); })()
        """) or []
        # 只看**供应商条目**:带「推荐」标或已知供应商名的那些,过滤掉文件树/会话等背景项
        known = ("GetBot", "OpenCode Zen", "OpenCode Go", "Anthropic", "OpenAI", "Google")
        plist = [t for t in provider_rows if any(k in t for k in known)]
        if not plist:
            record("G-3", "GetBot 热门首位 + 推荐标", "skip",
                   "连接提供商弹窗没打开或列表为空 —— 命令面板入口可能改名")
        else:
            first_is_getbot = plist[0].startswith("GetBot")
            has_badge = "推荐" in plist[0]
            record("G-3", "GetBot 热门首位 + 推荐标",
                   "ok" if (first_is_getbot and has_badge) else "fail",
                   "第 1 位 = %r(推荐标=%s);后续:%s"
                   % (plist[0], has_badge, " | ".join(p[:24] for p in plist[1:4])))
        ui.key("Escape", "Escape", 27)
        time.sleep(0.5)

        # ── G-4 更新器:local 档应置灰 ──────────────────────────
        # UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev" && CHANNEL !== "local"。
        #
        # ⚠️ Windows 上「检查更新」**本来就不在菜单里**:它属于 DESKTOP_MENU 的 `app` 组,
        # 而该组标了 `platforms: ["macos"]`,`windows-app-menu.tsx` 会把整组过滤掉。
        # 已与合上游前的基线 e77443750e 比对过 —— 基线同样如此,**非本次同步的回归**。
        # 所以这条在 Win 上找不到菜单项是**预期**,记 SKIP 而不是缺陷。
        ui.key("Escape", "Escape", 27)
        time.sleep(0.4)
        trig = ui.find_element(label="菜单") or ui.find_element(selector='[aria-haspopup="menu"]')
        if not trig:
            record("G-4", "更新器菜单项在 local 下置灰", "skip", "找不到应用菜单入口")
        else:
            ui.click_element(trig, "应用菜单")
            time.sleep(1.0)
            found = None
            for _ in range(2):
                items = ui.ev("""
                (() => [...document.querySelectorAll('[role^="menuitem"]')]
                  .filter(e => e.getBoundingClientRect().height > 0)
                  .map(e => ({ text:(e.textContent||'').trim().slice(0,40),
                               disabled: e.getAttribute('aria-disabled') === 'true'
                                         || e.hasAttribute('data-disabled'),
                               cx: Math.round(e.getBoundingClientRect().x + e.getBoundingClientRect().width/2),
                               cy: Math.round(e.getBoundingClientRect().y + e.getBoundingClientRect().height/2) })))()
                """) or []
                found = next((i for i in items if "更新" in i["text"]), None)
                if found:
                    break
                # 更新项在子菜单里,把带子菜单的顶层项 hover 一遍
                for it in items:
                    ui.send("Input.dispatchMouseEvent",
                            {"type": "mouseMoved", "x": it["cx"], "y": it["cy"]})
                    time.sleep(0.6)
                    probe = ui.ev("""
                    (() => [...document.querySelectorAll('[role^="menuitem"]')]
                      .filter(e => e.getBoundingClientRect().height > 0)
                      .map(e => (e.textContent||'').trim()).filter(t => t.includes('更新')))()
                    """)
                    if probe:
                        break
            if not found:
                record("G-4", "更新器菜单项在 local 下置灰", "skip",
                       "菜单里找不到「检查更新」项 —— local 档可能整条隐藏(也算合理)")
            else:
                record("G-4", "更新器菜单项在 local 下置灰",
                       "ok" if found["disabled"] else "fail",
                       "「%s」disabled=%s" % (found["text"], found["disabled"]))
            ui.key("Escape", "Escape", 27)
            time.sleep(0.4)

        # ── G-5 WSL 检查不阻塞启动 ─────────────────────────────
        # 判据:应用已经跑起来并能响应 CDP —— 若 WSL 探测同步阻塞,渲染器压根不会就绪。
        alive = ui.ev("({ ready: document.readyState, hasTree: !!document.querySelector('[data-tree-path]') })")
        record("G-5", "WSL 检测不阻塞启动", "ok" if alive and alive["hasTree"] else "fail",
               json.dumps(alive, ensure_ascii=False))

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
    print("\nP2:共 %d 项 — 通过 %d,跳过 %d(前提不满足),待处理 %d" % (len(rows), ok, skip, fail))
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
