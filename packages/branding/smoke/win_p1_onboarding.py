#!/usr/bin/env python3
"""[fork-only] P1-3 首启新手引导(Windows)[feat: upstream-sync-2026-08] 2026-08-14

对应 `6-windows-handoff.md` §二 P1-3 第一条。交接文档建议复用产品自带的
`OPENCODE_TEST_ONBOARDING=1` 钩子 —— 实测在 Windows 上同样可用,这里就是那条路。

## 钩子做了什么(读 `desktop/src/main/index.ts`)

置 1 后主进程会:
  · 在系统临时目录建 `opencode-onboarding-<uuid>/`,内含 data/config/cache/state/desktop/session;
  · 把 XDG_* 与 userData / sessionData 全指过去,`OPENCODE_DB=:memory:`;
  · 首启建 `<root>/documents/New DeskFox/` + 介绍文档,并发 deep link 让 renderer 自动打开。
于是整次运行**不碰任何真实档案** —— 这正是它比「手工清空配置目录」安全的地方。

⚠️ 会先杀掉正在跑的 `DeskFox 本地版`(单实例锁按 appId,不杀起不来第二个)。
   只动 local 档,**不碰**你正在用的正式版。

跑法:python packages/branding/smoke/win_p1_onboarding.py
"""
import glob
import os
import subprocess
import sys
import tempfile
import time

APP = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..",
    "desktop", "dist-deskfox", "win-unpacked", "DeskFox 本地版.exe"))
PORT = 9223
rows = []


def record(no, name, status, detail=""):
    rows.append((no, name, status, detail))
    print("  [%s] %s %s %s" % ({"ok": "OK  ", "skip": "SKIP", "fail": "FAIL"}[status],
                               no, name, ("— " + detail) if detail else ""))


def kill_local():
    subprocess.run(["powershell.exe", "-NoProfile", "-Command",
                    "Get-Process -Name 'DeskFox 本地版' -ErrorAction SilentlyContinue "
                    "| Stop-Process -Force -ErrorAction SilentlyContinue"],
                   capture_output=True)
    time.sleep(3)


def main():
    if not os.path.exists(APP):
        print("找不到本地版产物:%s\n先跑 build-deskfox-electron.ps1 -Env local" % APP)
        return 2

    before = set(glob.glob(os.path.join(tempfile.gettempdir(), "opencode-onboarding-*")))
    kill_local()

    env = dict(os.environ)
    env["OPENCODE_TEST_ONBOARDING"] = "1"
    subprocess.Popen([APP, "--remote-debugging-port=%d" % PORT], env=env,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # ── O-1 引导用的隔离档案目录被建出来 ──────────────────────
    root = None
    for _ in range(40):
        time.sleep(2)
        fresh = set(glob.glob(os.path.join(tempfile.gettempdir(), "opencode-onboarding-*"))) - before
        if fresh:
            root = sorted(fresh)[-1]
            break
    if not root:
        record("O-1", "首启建隔离档案目录", "fail",
               "80s 内 %%TEMP%% 下没出现 opencode-onboarding-* —— 钩子未生效" )
        return finish()
    record("O-1", "首启建隔离档案目录", "ok", root)

    # ── O-2 建 New DeskFox 工作区 + 介绍文档 ──────────────────
    docs = os.path.join(root, "documents")
    ws = None
    for _ in range(30):
        time.sleep(2)
        if os.path.isdir(docs):
            cands = [d for d in os.listdir(docs) if os.path.isdir(os.path.join(docs, d))]
            if cands:
                ws = os.path.join(docs, cands[0])
                break
    if not ws:
        record("O-2", "建 New DeskFox 工作区", "fail",
               "60s 内 %s 下没出现工作区目录" % docs)
        return finish()
    files = os.listdir(ws)
    record("O-2", "建工作区 + 介绍文档", "ok" if files else "fail",
           "%s → %s" % (os.path.basename(ws), files))

    # ── O-3 renderer 自动把它打开成当前项目 ────────────────────
    # 判据用**结构化的项目路径**,不用文案 —— 引导页文案两端不同,拿它判会误报。
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from uiprobe import UI  # noqa: E402

    opened = None
    for _ in range(20):
        time.sleep(3)
        try:
            ui = UI(host="127.0.0.1:%d" % PORT)
        except Exception:
            continue
        try:
            # 正则里匹配一个字面反斜杠:Python 源码写 4 个 → Python 字符串 2 个 →
            # JS 正则 `\\` → 匹配 1 个反斜杠。写 8 个会变成匹配**两个连续**反斜杠,
            # Windows 路径里没有,于是恒不命中 —— 2026-08-14 实撞,把一条本该通过的
            # O-3 报成 FAIL(界面其实早就打开了 New DeskFox)。
            opened = ui.ev("""
            (() => { const t = document.body.innerText || '';
              const m = t.match(/[A-Za-z]:\\\\[^\\n]{1,120}/);
              return m ? m[0].trim() : null; })()
            """)
            tree = ui.ev("document.querySelectorAll('[data-tree-path]').length")
        finally:
            ui.close()
        if opened:
            break
    leaf = os.path.basename(ws)
    ok = bool(opened and leaf in opened)
    record("O-3", "renderer 自动打开该工作区", "ok" if ok else "fail",
           "界面显示项目路径 %r(期望含 %r),文件树 %s 条" % (opened, leaf, tree if opened else "?"))
    return finish()


def finish():
    ok = sum(1 for r in rows if r[2] == "ok")
    fail = sum(1 for r in rows if r[2] == "fail")
    print("\nP1-3 首启引导:共 %d 项 — 通过 %d,待处理 %d" % (len(rows), ok, fail))
    for no, name, status, detail in rows:
        if status == "fail":
            print("  待处理 %s %s — %s" % (no, name, detail))
    print("\n提示:引导实例仍开着(端口 %d)。跑完常规用例前请杀掉它并用常规参数重启本地版。" % PORT)
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
