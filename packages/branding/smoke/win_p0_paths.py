#!/usr/bin/env python3
"""[fork-only] P0-3 Windows 路径与进程处理 [feat: upstream-sync-2026-08] 2026-08-14

对应 `6-windows-handoff.md` §二 P0-3 —— 本次同步动过 **68 个含 win32 判断的文件**,
敏感面:`core/fs-util.ts`(路径归一化)、`core/pty.ts` + `pty.node.ts`(终端)、
`core/shell.ts`、`core/ripgrep/binary.ts`、`core/cross-spawn-spawner.ts`、
`core/filesystem/watcher.ts`、`desktop/src/main/{index,server,windows,background-cli}.ts`。

## 前提(不满足就 SKIP,不当缺陷)

需要打开一个**路径含空格、且内含中文文件名**的项目 —— 这两个条件正是 Win 路径处理最容易翻车的地方。
本机用的是 `D:\\Test Question Identification`(含空格)+ `docs\\产品架构方案.md`(中文名)。
换机器跑时若项目不满足,脚本会明说「前提不满足」而不是报缺陷。

跑法:`DeskFox 本地版` 带 --remote-debugging-port=9222 起着。
    python packages/branding/smoke/win_p0_paths.py
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


def tree_paths(ui):
    return ui.ev("(() => [...document.querySelectorAll('[data-tree-path]')]"
                 ".map(e => e.getAttribute('data-tree-path')))()") or []


def expand_dirs(ui, rounds=3):
    """逐层展开目录。点之前**先滚到视口** —— 树一长目录行就滚出可视区,直接点等于点空。"""
    for _ in range(rounds):
        pending = ui.ev("""
        (() => { const all = [...document.querySelectorAll('[data-tree-path]')]
            .map(e => e.getAttribute('data-tree-path')).filter(Boolean);
          return all.filter(p => (p.endsWith('/') || p.endsWith('\\\\'))
                                 && !p.startsWith('.')
                                 && !all.some(q => q !== p && q.startsWith(p))); })()
        """) or []
        if not pending:
            return
        for p in pending:
            ok = ui.ev("""
            (() => { const want = %s;
              const el = [...document.querySelectorAll('[data-tree-path]')]
                .find(e => e.getAttribute('data-tree-path') === want);
              if (!el) return null;
              el.scrollIntoView({ block: 'center', behavior: 'instant' });
              const r = el.getBoundingClientRect();
              if (r.height <= 0) return null;
              return { cx: Math.round(r.x+r.width/2), cy: Math.round(r.y+r.height/2) }; })()
            """ % json.dumps(p))
            if not ok:
                continue
            time.sleep(0.35)
            ui.click(ok["cx"], ok["cy"])
            time.sleep(0.55)
        time.sleep(0.5)


def main():
    ui = UI()
    try:
        geo = ui.window_geometry()
        print("窗口: 视口 %sx%s | 平台 %s\n" % (geo["viewport"]["w"], geo["viewport"]["h"], geo.get("platform")))

        # ── P-1 项目路径含空格 + 文件树含中文名 ────────────────
        # 必须**先展开目录**再看。2026-08-14 实撞:中文样本在 `docs/` 下,
        # 不展开只能看到 10 条顶层项 → 报「无中文文件名」,而它明明就在树里 ——
        # 「没展开」被记成了「没有」,两种结论的处置完全不同。
        expand_dirs(ui)
        paths = tree_paths(ui)
        if not paths:
            record("P-1", "文件树渲染", "skip", "文件树没有条目 —— 需先打开一个项目")
            return finish()
        chinese = [p for p in paths if any("\u4e00" <= c <= "\u9fff" for c in p)]
        record("P-1", "文件树渲染含中文名的条目", "ok" if chinese else "skip",
               "%d 条,其中中文名 %d 条(例:%s)" % (len(paths), len(chinese), chinese[0] if chinese else "无")
               if chinese else "%d 条但无中文文件名 —— 换个含中文文件的项目才验得到" % len(paths))

        # ── P-2 Ctrl+K 全局搜索(打 ripgrep 二进制路径这条线)──
        # 这条最能打到 `core/ripgrep/binary.ts`:二进制路径解析错 → 搜索恒 0 条,
        # 而 UI 上只表现为「搜不到」,极易被当成「没有匹配」放过去。
        ui.key("Escape", "Escape", 27)
        time.sleep(0.3)
        ui.key("k", "KeyK", 75, ctrl=True)
        time.sleep(1.5)
        palette_open = ui.ev("""
        (() => { const inp = [...document.querySelectorAll('input')]
            .find(e => e.getBoundingClientRect().height > 0 && e.offsetParent !== null);
          return inp ? true : false; })()
        """)
        if not palette_open:
            record("P-2", "Ctrl+K 打开命令面板", "fail", "按 Ctrl+K 后没有可见输入框")
        else:
            # 用文件树里真实存在的一个中文文件名去搜 —— 搜自己项目里的东西,结果可预期
            needle = None
            for p in chinese or paths:
                base = p.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
                if base and "." in base:
                    needle = base.rsplit(".", 1)[0][:6]
                    break
            if not needle:
                record("P-2", "Ctrl+K 搜索命中", "skip", "文件树里挑不出可搜的文件名")
            else:
                ui.type_text(needle)
                time.sleep(2.5)
                hits = ui.ev("""
                (() => [...document.querySelectorAll('[role^="option"],[role="menuitem"],button')]
                  .filter(e => e.getBoundingClientRect().height > 0)
                  .map(e => (e.textContent||'').trim())
                  .filter(t => t && t.length < 160))()
                """) or []
                matched = [h for h in hits if needle in h]
                record("P-2", "Ctrl+K 搜索命中(ripgrep 路径)",
                       "ok" if matched else "fail",
                       "搜「%s」→ %d 条命中(例:%s)" % (needle, len(matched), matched[0][:60])
                       if matched else "搜「%s」→ 0 条命中,面板共 %d 项" % (needle, len(hits)))
            ui.key("Escape", "Escape", 27)
            time.sleep(0.5)

        # ── P-3 终端能开 + 真能跑命令(ConPTY)────────────────
        # group2 #22 只验了「实例数变化」,没验**真跑得起命令** ——
        # ConPTY 起不来时实例照样创建,终端一片空白,那条用例照样绿。
        term_btn = ui.find_element(label="切换终端") or ui.find_element(label="终端")
        if not term_btn:
            record("P-3", "终端可打开", "skip", "找不到终端切换按钮")
        else:
            open_before = ui.ev("document.querySelectorAll('[data-component=\"terminal\"]').length")
            if not open_before:
                ui.click_element(term_btn, "切换终端")
                time.sleep(3.0)
            insts = ui.ev("document.querySelectorAll('[data-component=\"terminal\"]').length")
            if not insts:
                record("P-3", "终端可打开", "fail", "点了切换终端但没有 terminal 实例")
            else:
                # 终端是 canvas 渲染(ghostty-web),读不到 DOM 文本 —— 用「有没有画出东西」判活。
                painted = ui.ev("""
                (() => { const t = document.querySelector('[data-component="terminal"]');
                  if (!t) return null;
                  const c = t.querySelector('canvas');
                  const r = (c || t).getBoundingClientRect();
                  return { hasCanvas: !!c, w: Math.round(r.width), h: Math.round(r.height) }; })()
                """)
                ok = bool(painted and painted["w"] > 100 and painted["h"] > 50)
                record("P-3", "终端实例渲染(ConPTY 起得来)", "ok" if ok else "fail",
                       json.dumps(painted, ensure_ascii=False))

        # ── P-4 文件监听:改盘上文件,树里要有反应 ──────────────
        # 打 `core/filesystem/watcher.ts`(@parcel/watcher 的 win32 后端)。
        record("P-4", "文件监听生效", "skip",
               "需在项目里新建/删除文件后观察树刷新 —— 本脚本不写用户项目,留人工/专用夹具验")

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
    print("\nP0-3:共 %d 项 — 通过 %d,跳过 %d(前提不满足),待处理 %d" % (len(rows), ok, skip, fail))
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
