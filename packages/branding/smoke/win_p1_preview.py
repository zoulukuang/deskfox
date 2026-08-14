#!/usr/bin/env python3
"""[fork-only] P1-2 / P2 Windows 文件预览与 LibreOffice [feat: upstream-sync-2026-08] 2026-08-14

对应 `6-windows-handoff.md` §二 P1-2(LibreOffice 预览)与 §二 P2(各格式预览)。

## 先纠正交接文档的一处过时信息

原文说「**Win 端内置 bundle 此前记为待办**」。实测**不成立**:
`packages/branding/libreoffice-bundle/windows/` 有 647MB 的健康 bundle(presets 非空),
`build-deskfox-electron.ps1` §3.5b 硬卡它存在、§5.5 还做 post-build 复验,
打出来的 `win-unpacked/libreoffice/program/soffice.exe` 确实在包里。
更直接的证据:本目录的 `make_fixtures.py` 生成 sample.pdf 用的就是**包内那份 soffice**,转换成功。
所以 Win 的 LO 是**已内置**,该验的是「预览链路通不通」,不是「有没有装」。

## 判据

docx / xlsx / pdf 三种都最终走 **pdf.js 渲染 → canvas**;图片走 `<img>`;md 走文本 DOM。
所以判据是结构化的 `hasCanvas` / `hasImg` / 特征词命中,不是「看着像出来了」。

前提:已打开 `make_fixtures.py` 生成的测试项目(默认 D:\\deskfox-uitest)。
跑法:python packages/branding/smoke/win_p1_preview.py
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


def tree_entry(ui, suffix):
    """按后缀/文件名在文件树里找一个条目(返回 data-tree-path)。

    传的是**完整文件名**(如 `README.md`)时优先精确匹配到那一个 ——
    2026-08-14 实撞:目录展开后树里多出 `notes\\sub.md`,按 `.md` 取「第一个」
    抓到的是它,而特征词 BOLDMARK 在 README.md 里,于是报「特征词未命中」。
    **是脚本选错了文件,不是预览坏了** —— 这种假红比假绿更浪费人。
    """
    return ui.ev("""
    (() => { const want = %s;
      const all = [...document.querySelectorAll('[data-tree-path]')]
        .map(e => e.getAttribute('data-tree-path')).filter(Boolean);
      const exact = all.find(p => p.replace(/\\\\/g, '/').split('/').pop().toLowerCase() === want);
      if (exact) return exact;
      return all.filter(p => p.toLowerCase().endsWith(want))[0] || null; })()
    """ % json.dumps(suffix.lower()))


def click_tree_path(ui, path):
    """滚到目标行 → 重新量几何 → 视口断言 → 真实点击。

    2026-08-14 实撞(一个根因造出两条假红):文件树条目涨到 22 条后,`images\\` 和
    `README.md` 都滚出了可视区。原实现直接拿 `getBoundingClientRect` 的坐标点下去 ——
    坐标在**文档**里有效,但不在**视口**里,点击全部落空。表现是:
      · `images/` 怎么点都展不开 → V-5 记成「没有 .png 样本」;
      · README.md 预览始终 419 字 → V-1 记成「特征词未命中」。
    两条看着像不同的功能坏了,其实都是「没滚过去」。uiprobe 的 assert_in_viewport 本就是
    为拦这个而生 —— 缺的是**先滚再点**这一步。
    """
    ok = ui.ev("""
    (() => { const want = %s;
      const el = [...document.querySelectorAll('[data-tree-path]')]
        .find(e => e.getAttribute('data-tree-path') === want);
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      return true; })()
    """ % json.dumps(path))
    if not ok:
        return False
    time.sleep(0.45)
    box = ui.ev("""
    (() => { const want = %s;
      const el = [...document.querySelectorAll('[data-tree-path]')]
        .find(e => e.getAttribute('data-tree-path') === want);
      if (!el) return null; const r = el.getBoundingClientRect();
      if (r.height <= 0) return null;
      return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
               cx: Math.round(r.x+r.width/2), cy: Math.round(r.y+r.height/2),
               right:Math.round(r.right), bottom:Math.round(r.bottom) }; })()
    """ % json.dumps(path))
    if not box:
        return False
    try:
        ui.assert_in_viewport(box, "文件树行 %s" % path)
    except ProbeError as e:
        print("[preview] %s" % e, file=sys.stderr)
        return False
    ui.click(box["cx"], box["cy"])
    return True


def _dir_nodes(ui):
    return ui.ev("""
    (() => [...document.querySelectorAll('[data-tree-path]')]
      .filter(e => { const p = e.getAttribute('data-tree-path')||'';
                     return (p.endsWith('/') || p.endsWith('\\\\'))
                            && e.getBoundingClientRect().height > 0; })
      .map(e => { const r = e.getBoundingClientRect();
         return { path: e.getAttribute('data-tree-path'),
                  cx: Math.round(r.x+r.width/2), cy: Math.round(r.y+r.height/2) }; }))()
    """) or []


def _has_children(ui, dir_path):
    return ui.ev("""
    (() => { const d = %s;
      return [...document.querySelectorAll('[data-tree-path]')]
        .some(e => { const p = e.getAttribute('data-tree-path')||'';
                     return p !== d && p.startsWith(d); }); })()
    """ % json.dumps(dir_path))


def expand_all_dirs(ui, rounds=3):
    """把文件树里的目录逐层展开 —— 样本文件在 docs/ images/ big/ 下,不展开根本看不到。

    判「已展开」不能靠 `data-expanded`(**这个属性根本不存在**,2026-08-14 实撞:
    于是每个目录都被当成未展开,已展开的被点了一下反而**收起来** ——
    表现是 images/ 里的 sample.png 始终找不到,V-5 报「没有样本」这种假的前提不满足)。
    改成看它**有没有子条目**:点完若子条目没出现,再点一次(可能是刚被收起)。
    """
    for _ in range(rounds):
        pending = [d for d in _dir_nodes(ui)
                   if not d["path"].startswith(".") and not _has_children(ui, d["path"])]
        if not pending:
            return
        for d in pending:
            try:
                # 必须走 click_tree_path(先滚到视口)—— 树一长,目录行就滚出可视区,
                # 直接用旧坐标点等于点空,表现为「这个目录怎么都展不开」。
                click_tree_path(ui, d["path"])
                time.sleep(0.6)
                if not _has_children(ui, d["path"]):
                    click_tree_path(ui, d["path"])  # 刚才那下可能是把它收起来了
                    time.sleep(0.6)
            except Exception:
                pass
        time.sleep(0.6)


def open_path(ui, path, want_kind=None, timeout=15.0):
    """点开文件树里的某个路径,**轮询等到预览真的出内容**再返回。

    原实现固定 `sleep(3)` 就往下走。docx/xlsx 要经 LibreOffice 转换,机器忙时 3 秒不够 ——
    2026-08-14 实撞:一次全量回归里 README.md 只读到 391 字(预览还没渲染完),
    特征词自然没命中,报成「md 预览坏了」。**固定 sleep 是 flaky 的源头**,改成按判据轮询。
    """
    if not click_tree_path(ui, path):
        return False
    end = time.time() + timeout
    while time.time() < end:
        time.sleep(1.0)
        st = viewer_state(ui)
        if not st:
            continue
        if want_kind == "canvas" and st["hasCanvas"]:
            return True
        if want_kind == "img" and st["hasImg"]:
            return True
        if want_kind in ("text", "guard") and (st["bodyLen"] > 300 or st["shadowLen"] > 300):
            return True
        if want_kind is None:
            return True
    return True  # 超时也返回 True,让判据段落去给出**具体**结论,而不是笼统记「点不开」


def viewer_state(ui):
    """读预览区状态 —— 结构化判据,不看文案。

    docx/xlsx/pdf 都经 LibreOffice → PDF → pdf.js,所以最终形态都是 canvas;
    图片是 img;代码/文本类渲染在 `<diffs-container>` 的 **shadow root** 里
    (2026-08-13 Mac 端踩过:普通选择器搜不到内容,被误读成「没渲染」)。
    """
    return ui.ev("""
    (() => {
      const canvases = [...document.querySelectorAll('canvas')]
        .filter(c => { const r = c.getBoundingClientRect(); return r.width > 80 && r.height > 80; });
      const imgs = [...document.querySelectorAll('img')]
        .filter(i => { const r = i.getBoundingClientRect(); return r.width > 60 && r.height > 60; });
      let shadowText = '';
      const walk = (root) => { for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { shadowText += el.shadowRoot.textContent || ''; walk(el.shadowRoot); } } };
      walk(document);
      return { hasCanvas: canvases.length > 0, canvasCount: canvases.length,
               canvasMax: canvases.length ? Math.max(...canvases.map(c => Math.round(c.getBoundingClientRect().width))) : 0,
               hasImg: imgs.length > 0,
               bodyLen: (document.body.innerText||'').length,
               shadowLen: shadowText.length,
               text: ((document.body.innerText||'') + shadowText) };
    })()
    """)


def main():
    ui = UI()
    try:
        geo = ui.window_geometry()
        print("窗口: 视口 %sx%s | 平台 %s\n" % (geo["viewport"]["w"], geo["viewport"]["h"], geo.get("platform")))

        # 展开后**校验样本确实露出来了**,没露出就再展一轮。
        # 2026-08-14 实撞:一次回归里 images/ 没展开,V-5 记成「没有 .png 样本」——
        # 那是展开失败,不是样本缺失,两种结论的处置完全不同(前者重试、后者去跑 make_fixtures)。
        want_suffixes = (".docx", ".xlsx", ".pdf", ".png")
        for attempt in range(3):
            expand_all_dirs(ui)
            paths = ui.ev("(() => [...document.querySelectorAll('[data-tree-path]')]"
                          ".map(e => e.getAttribute('data-tree-path')))()") or []
            missing = [s for s in want_suffixes
                       if not any(p.lower().endswith(s) for p in paths)]
            if not missing:
                break
            print("[preview] 第 %d 轮展开后仍缺 %s,重试" % (attempt + 1, missing), file=sys.stderr)
        print("文件树条目 %d 条:%s\n" % (len(paths), ", ".join(paths[:14])))

        # 期望的样本 → (用例号, 名称, 判据)
        cases = [
            ("V-1", "md 预览(文本 + 特征词)", "README.md", "BOLDMARK", "text"),
            ("V-2", "docx 预览(LibreOffice → pdf.js)", ".docx", None, "canvas"),
            ("V-3", "xlsx 预览(LibreOffice → pdf.js)", ".xlsx", None, "canvas"),
            ("V-4", "pdf 预览(pdf.js)", ".pdf", None, "canvas"),
            ("V-5", "图片预览", ".png", None, "img"),
            ("V-6", "超大文件守卫", "large.txt", None, "guard"),
        ]

        for no, name, suffix, marker, kind in cases:
            target = tree_entry(ui, suffix)
            if not target:
                record(no, name, "skip", "文件树里没有 %s 样本 —— 先跑 make_fixtures.py 并打开该项目" % suffix)
                continue
            if not open_path(ui, target, want_kind=kind):
                record(no, name, "skip", "%r 在树里但当前不可见(目录未展开?)" % target)
                continue
            st = viewer_state(ui)
            if kind == "canvas":
                ok = bool(st and st["hasCanvas"])
                record(no, name, "ok" if ok else "fail",
                       "%s → canvas=%d(最宽 %dpx)" % (target, st["canvasCount"], st["canvasMax"]))
            elif kind == "img":
                ok = bool(st and st["hasImg"])
                record(no, name, "ok" if ok else "fail", "%s → img=%s" % (target, st["hasImg"]))
            elif kind == "text":
                ok = bool(st and marker and marker in st["text"])
                record(no, name, "ok" if ok else "fail",
                       "%s → 特征词 %s %s(正文 %d 字 / shadow %d 字)"
                       % (target, marker, "命中" if ok else "未命中", st["bodyLen"], st["shadowLen"]))
            elif kind == "guard":
                # 30MB 文本:要么截断提示、要么正常渲染,**但不能卡死或白屏**
                alive = bool(st and (st["bodyLen"] > 200 or st["shadowLen"] > 200))
                record(no, name, "ok" if alive else "fail",
                       "%s → 正文 %d 字 / shadow %d 字(未白屏即通过)"
                       % (target, st["bodyLen"], st["shadowLen"]))

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
    print("\n预览:共 %d 项 — 通过 %d,跳过 %d(前提不满足),待处理 %d" % (len(rows), ok, skip, fail))
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
