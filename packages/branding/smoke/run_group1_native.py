#!/usr/bin/env python3
"""[fork-only] CHECKLIST 第 1 组 原生层可自动化项 [feat: ui-probe-toolkit] 2026-08-14

覆盖 #10 首启引导 / #11 更新器 UI / #12 崩溃自愈 —— 这三条**曾被我判为「机器做不到」**,
user 2026-08-14 质疑后重新评估,结论是三条都能自动化,判错了:

- #10:当时的理由是「判定点在冷启动最初几秒」。但**结果是持久的** ——
  目录建没建、文档在不在、开的是哪个工作区,事后都查得到。清标记 → 重启 → 断言即可。
- #11:菜单项与原生对话框 AppleScript 都能操作和读文案(第 1 组菜单验收本就是这么做的)。
- #12:`pkill` 确实不算「可数崩溃」(它是 killed),但 **CDP 有 `Page.crash()`**,
  产生的正是 `crashed` 这个可数原因,两次 <120s 就能触发隔离。

教训:「机器做不到」这句话本身也要**先验证再下**,否则就是用一句断言把活推给人。

跑法:
    python3 packages/branding/smoke/run_group1_native.py
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import time

from uiprobe import UI, ProbeError

APP_PATH = ("/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/"
            "DeskFox 本地版.app")
APP_PROCESS = "DeskFox 本地版"
USER_DATA = os.path.expanduser("~/Library/Application Support/ai.deskfox.app.local")
SETTINGS = os.path.join(USER_DATA, "opencode.settings")
ONBOARD_DIR = os.path.expanduser("~/Documents/New DeskFox")
ONBOARD_DOC = "关于 DeskFox 你该知道的几件事.md"

rows = []
_t0 = time.time()


def record(no, name, status, detail=""):
    rows.append((no, name, status, detail))
    tag = {"ok": "OK  ", "skip": "SKIP", "fail": "FAIL"}[status]
    print("  [%s] %6.1fs #%s %s %s" % (tag, time.time() - _t0, no, name,
                                       ("— " + detail) if detail else ""))


def osa(script, timeout=25):
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
    return (r.stdout or "").strip(), (r.stderr or "").strip()


def kill_local():
    """只杀 local 档 —— 绝不碰 user 正在用的正式版(CLAUDE.md 硬规则)。"""
    subprocess.run(["pkill", "-f", "%s/Contents/" % APP_PATH], capture_output=True)
    time.sleep(3)


def launch_local():
    subprocess.run(["open", "-a", APP_PATH, "--args", "--remote-debugging-port=9222"],
                   capture_output=True)


def wait_cdp(timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            ui = UI()
            ui.ev("1")
            return ui
        except Exception:
            time.sleep(2)
    return None


def restart_local():
    kill_local()
    launch_local()
    return wait_cdp()


def current_project(ui):
    """读界面上的当前项目路径。

    正则不能写死 `/Users|/Volumes` —— 首启测试模式下工作区在 `/private/var/folders/...`
    (临时根),用窄正则会返回 None,把「引导其实成功了」误判成「没触发」。
    """
    return ui.ev("(() => { const t=document.body.innerText||'';"
                 " const m=t.match(/\\/[A-Za-z0-9._\\-\\/ ]{6,}/); return m?m[0].trim():null; })()")


def open_tabs(ui):
    return ui.ev("(() => [...document.querySelectorAll('[role=tab]')]"
                 ".filter(e=>e.getBoundingClientRect().height>0)"
                 ".map(e=>(e.textContent||'').trim()))()") or []


# ── #10 首启引导(REQ-083)────────────────────────────────────
def check_10_onboarding():
    """#10 首启引导:**真·首次启动**用一个干净的 user-data-dir 跑,不碰现有档案。

    第一版直接清 local 档的标记后重启,结果没触发 —— 不是功能坏了:
    源码里对**有历史数据的老用户**只建 `New DeskFox` + 介绍文档、**不自动打开**
    (`onboarding.ts` 注释写明)。而 local 档早已一堆历史数据,判定成老用户,
    所以「自动打开引导工作区」这条本就不该发生。
    要验新用户路径,必须给一个**干净档案**:`--user-data-dir` 指向临时目录即可,
    全程不动 user 的真实档案,也不动 `~/Documents/New DeskFox`(那是文稿目录,可能是正式版建的)。
    """
    kill_local()
    proc = None
    try:
        # 产品自带首启测试钩子:`OPENCODE_TEST_ONBOARDING=1` 会把 userData / sessionData /
        # XDG_* 全指到临时目录、DB 用 `:memory:`(index.ts 的 onboardingTestRoot)——
        # 正是「全新安装」语义,且**完全不碰 user 的真实档案**。
        # 第一版自己传 `--user-data-dir`,但应用启动时用 `app.setPath("userData", ...)`
        # 覆盖了它,那个参数根本没生效 —— 用产品自己的钩子才对。
        # `open -a` 传不了环境变量,所以直接起可执行文件。
        env = dict(os.environ, OPENCODE_TEST_ONBOARDING="1")
        proc = subprocess.Popen(
            [os.path.join(APP_PATH, "Contents", "MacOS", APP_PROCESS),
             "--remote-debugging-port=9222"],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        ui = wait_cdp(120)
        if not ui:
            record(10, "首启引导", "fail", "干净档案下应用起不来")
            return
        try:
            time.sleep(10)     # 建目录 / 拷文件 / 切工作区
            proj = current_project(ui)
            tabs = open_tabs(ui)
            body = ui.ev("(() => (document.body.innerText||'').slice(0,200))()")
            shot = ui.shot("g1-10-onboarding")
        finally:
            ui.close()
        # 断言要落在**实际打开的那个工作区**上,不是写死的 ~/Documents ——
        # 首启测试模式把目录重定向到了临时根,写死路径会验错对象。
        opened_here = bool(proj) and "New DeskFox" in proj
        dir_ok = bool(proj) and os.path.isdir(proj)
        doc_ok = bool(proj) and os.path.exists(os.path.join(proj, ONBOARD_DOC))
        doc_tab = any("关于 DeskFox" in t or "你该知道" in t for t in tabs)
        ok = dir_ok and doc_ok and opened_here
        record(10, "首启引导(干净档案 → 建目录 + 自动打开引导工作区)", "ok" if ok else "fail",
               "目录=%s 文档=%s 工作区=%r tab含介绍文档=%s;页面首屏=%r"
               % (dir_ok, doc_ok, proj, doc_tab, (body or "")[:90].replace("\n", " ")))
    finally:
        if proc:
            proc.terminate()
        kill_local()
        launch_local()          # 把 user 的正常 local 档跑回来
        wait_cdp(120)


# ── #11 更新器 UI ────────────────────────────────────────────
def native_dialog():
    """读原生对话框的文案与按钮。

    **两种形态都要认**:`dialog.showMessageBox(win, ...)` 带父窗口时是**挂在窗口上的 sheet**,
    不带父窗口才是独立的 AXDialog 窗口。第一版只查 AXDialog,崩溃恢复对话框(有父窗口)
    永远查不到,被记成「没有出现对话框」—— 与之前 NSOpenPanel 那次恰好相反,
    所以两种都得试,别再按单一形态写死。
    """
    for target in ('(first window whose subrole is "AXDialog")',
                   '(sheet 1 of window 1)'):
        t, _ = osa('tell application "System Events" to tell process "%s" to '
                   'return value of every static text of %s' % (APP_PROCESS, target))
        if t:
            b, _ = osa('tell application "System Events" to tell process "%s" to '
                       'return name of every button of %s' % (APP_PROCESS, target))
            return t, b, target
    return None, None, None


def dismiss_native_dialog(target, button=1):
    if not target:
        return
    osa('tell application "System Events" to tell process "%s" to click button %d of %s'
        % (APP_PROCESS, button, target))
    time.sleep(1.0)


def app_menu_index():
    """DeskFox 自己的应用菜单是 menu bar item **2**,第 1 个是苹果菜单。

    实撞:按 1 取,读到的是「关于本机 / 系统设置… / 强制退出…」,
    于是「检查更新...」永远点不到,被记成「更新器坏了」。
    这里按名字定位,不写死序号。
    """
    out, _ = osa('tell application "System Events" to tell process "%s" to '
                 'return name of every menu bar item of menu bar 1' % APP_PROCESS)
    names = [n.strip() for n in out.split(",")]
    for i, n in enumerate(names, start=1):
        if "DeskFox" in n:
            return i
    return 2 if len(names) > 1 else 1


def check_11_updater():
    """#11 更新器 —— 本地版上**按设计验不了对话框**,能验的是「菜单项存在且置灰」。

    实测根因(不是「机器做不到」,是渠道设计):
        UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev" && CHANNEL !== "local"
    本地版 / 预览版**关闭更新器**,`controller.check()` 直接返回 `disabled`,
    而 `showUpdaterDialog` 只处理 error / up-to-date / ready 三态 → 什么都不弹;
    菜单项本身也被 `menu.ts` 置为 disabled(实测 `enabled = false`)。
    第一版死等 60s 对话框,当然等不到 —— 那不是缺陷,是本地版就不该有。

    所以本条在本地版上的正确判据是:**菜单项在、且是灰的**。
    完整的「点开 → 对话框 → 中文文案」需要 **prod / beta 包**,留人工验收单。
    """
    osa('tell application "System Events" to set frontmost of process "%s" to true' % APP_PROCESS)
    time.sleep(0.6)
    idx = app_menu_index()
    # 菜单项写的是「检查更新…」—— **单字符省略号 U+2026**,不是三个点。
    # 第一版按 "检查更新..." 匹配,永远点不到,被记成「更新器坏了」。
    exists, err = osa('tell application "System Events" to tell process "%s" to '
                      'return name of menu item "检查更新\u2026" of menu 1 of menu bar item %d of menu bar 1'
                      % (APP_PROCESS, idx))
    if err or not exists:
        record(11, "更新器菜单项", "fail", "应用菜单(第 %d 项)里找不到「检查更新…」:%s" % (idx, err[:60]))
        return
    enabled, _ = osa('tell application "System Events" to tell process "%s" to '
                     'return enabled of menu item "检查更新\u2026" of menu 1 of menu bar item %d of menu bar 1'
                     % (APP_PROCESS, idx))
    # 本地版:必须置灰(UPDATER_ENABLED 为 false)
    ok = enabled.lower() == "false"
    record(11, "更新器菜单项(本地版应置灰;对话框需 prod/beta 包)",
           "ok" if ok else "fail",
           "菜单项=%r enabled=%r(本地版期望 false)" % (exists, enabled))


# ── #12 崩溃自愈(REQ-087)────────────────────────────────────
def snapshot_backups():
    return set(glob.glob(os.path.join(USER_DATA, "*.dat.bak-*")))


def check_12_crash_recovery():
    """#12 崩溃恢复对话框 —— ⚠️ 我此前把这条判错过,这里记下更正依据。

    我一度断言「没有对话框,是静默自愈」,依据只有 `renderer-crash-guard.ts`。
    **看漏了 `windows.ts` 的 `wireWindowRecovery`**:它在 `render-process-gone` 与
    `unresponsive` 时都会 `dialog.showMessageBox`,按钮为
    「重新启动 / 导出日志 / 退出」(未响应时第三项是「继续等待」)。
    所以总清单原文「崩溃/无响应恢复对话框 —— 出现且按钮可用」**是对的**,是我凭局部证据下了全局结论。

    真实行为是**两层**:
      ① 恢复对话框(用户可见,主路径);
      ② 连崩隔离(REQ-087,120s 内第二次可数崩溃 → 隔离 .dat 快照)。
    ② 在实践中很难触发 —— 因为 ① 的默认按钮就是「重新启动」,应用一重启,
    主进程里的连崩计数器就清零了。这一点如实记录,不当缺陷报。

    本条验 ①:用 CDP `Page.crash()` 造一次真崩溃(reason=`crashed`),
    断言对话框出现、文案中文、三个按钮齐,然后点「重新启动」让应用回来。
    """
    before = snapshot_backups()
    ui = wait_cdp(60)
    if not ui:
        record(12, "崩溃恢复对话框", "fail", "崩溃前连不上 CDP")
        return
    try:
        try:
            ui.send("Page.crash")     # 立刻断链,收不到响应属正常
        except Exception:
            pass
    finally:
        try:
            ui.close()
        except Exception:
            pass

    texts = buttons = target = None
    for _ in range(25):
        time.sleep(1.0)
        texts, buttons, target = native_dialog()
        if texts:
            break

    if not texts:
        record(12, "崩溃恢复对话框", "fail",
               "崩溃后 25s 内没有出现恢复对话框(窗口与 sheet 两种形态都查过)")
        return
    btn_list = [b.strip() for b in (buttons or "").split(",") if b.strip()]
    has_cjk = any("一" <= ch <= "鿿" for ch in texts)
    expected = {"重新启动", "导出日志", "退出"}
    btn_ok = expected.issubset(set(btn_list))

    dismiss_native_dialog(target)      # 第 1 个按钮就是「重新启动」
    ui2 = wait_cdp(120)
    alive = False
    if ui2:
        try:
            alive = ui2.ev("(() => 1)()") == 1
        finally:
            ui2.close()
    isolated = sorted(os.path.basename(x) for x in (snapshot_backups() - before))

    ok = bool(has_cjk and btn_ok and alive)
    record(12, "崩溃恢复对话框(出现 + 中文 + 按钮可用 + 重启后恢复)", "ok" if ok else "fail",
           "文案=%r;按钮=%s;重启后可用=%s;连崩隔离(第二层,通常不触发)=%s"
           % (texts[:50], btn_list, alive, isolated or "无"))


def main():
    print("第 1 组原生层(#10 / #11 / #12)—— 只操作 local 档\n")
    for fn in (check_11_updater, check_12_crash_recovery, check_10_onboarding):
        try:
            fn()
        except ProbeError as e:
            record(fn.__name__.split("_")[1], fn.__doc__.split("\n")[0][:30], "fail", str(e)[:90])
        except Exception as e:
            record(fn.__name__.split("_")[1], fn.__doc__.split("\n")[0][:30], "fail",
                   "%s: %s" % (type(e).__name__, str(e)[:80]))

    print()
    ok = [r for r in rows if r[2] == "ok"]
    skip = [r for r in rows if r[2] == "skip"]
    bad = [r for r in rows if r[2] == "fail"]
    print("第 1 组原生层:共 %d 项 — 通过 %d,跳过 %d,待处理 %d" % (len(rows), len(ok), len(skip), len(bad)))
    for no, name, _, detail in skip + bad:
        print("  #%s %s — %s" % (no, name, detail))


if __name__ == "__main__":
    main()
