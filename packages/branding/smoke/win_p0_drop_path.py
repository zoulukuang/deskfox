#!/usr/bin/env python3
"""[fork-only] P0-1 Windows 拖入路径写法验证 [feat: upstream-sync-2026-08] 2026-08-14

对应 `docs/features/upstream-sync-2026-08/6-windows-handoff.md` §二 P0-1。

## 这个脚本能验什么、不能验什么(先说清楚,免得当成全覆盖)

| 通道 | 能不能自动验 | 原因 |
|---|---|---|
| **文件树内拖 → 输入框** | ✅ 能 | 页内 HTML5 拖放,CDP 真实鼠标事件驱动得动 |
| **`@` 提及补全** | ✅ 能 | 纯页内交互 |
| **资源管理器拖入(外部)** | ❌ 不能 | 系统级拖放不经过 renderer,CDP 的 dispatchDragEvent
|   |   | 喂不进跨进程文件拖放(见 MANUAL-CHECKLIST #9a)。留人工验。 |

所以本脚本的定位是:**把「同一个文件的两种引用写法」这个不变式里能自动验的两条腿钉死**,
外部拖入那条腿由单测(external-drop.test.ts 的 W1–W5)+ 人工验收覆盖。

跑法:目标应用带 --remote-debugging-port 起着,且已打开一个含子目录文件的项目。
    python packages/branding/smoke/win_p0_drop_path.py                        # 默认本地版 9222
    python packages/branding/smoke/win_p0_drop_path.py 9224 "DeskFox 预览版"  # 换渠道/端口

支持指定渠道是刻意的:验安装包时要能对**装出来的那一档**跑同一套判据,
否则「修复有没有随包发出」只能靠翻 asar 猜,而 app.asar 是单一归档、grep 转义不可靠。
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


EDITOR = "[contenteditable=true]"


def editor_text(ui):
    return ui.ev("document.querySelector(%s)?.textContent" % json.dumps(EDITOR)) or ""


def reset_editor(ui):
    ed = ui.find_element(selector=EDITOR)
    ui.require(ed, "找不到聊天输入框(前提:已打开会话)")
    ui.click_element(ed, "聊天输入框")
    time.sleep(0.3)
    ui.clear_input(80)
    time.sleep(0.4)
    return ed


def nested_file_path(ui):
    """从文件树里挑一个**位于子目录下**的文件节点路径。

    必须是子目录下的 —— 根目录文件(`README.md`)不含分隔符,
    正/反斜杠之争在它身上根本看不出来,拿它验等于没验。
    """
    return ui.ev("""
    (() => [...document.querySelectorAll('[data-tree-path]')]
      .map(e => e.getAttribute('data-tree-path'))
      .filter(p => p && !p.endsWith('/') && !p.endsWith('\\\\') && /[\\\\/]/.test(p))
      [0] || null)()
    """)


def box_of_tree_path(ui, path):
    """按 data-tree-path 取几何 —— 用 JS 属性比对而不是拼 CSS 选择器。

    拼选择器要转义反斜杠和引号,经 shell → python → JS 三层后极易出错
    (2026-08-14 实撞:一路转义下来选择器压根没命中,还差点被当成「节点不存在」)。
    """
    return ui.ev("""
    (() => { const want = %s;
      const el = [...document.querySelectorAll('[data-tree-path]')]
        .find(e => e.getAttribute('data-tree-path') === want);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
               cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2),
               right:Math.round(r.right), bottom:Math.round(r.bottom) }; })()
    """ % json.dumps(path))


def main():
    port = sys.argv[1] if len(sys.argv) > 1 else "9222"
    process = sys.argv[2] if len(sys.argv) > 2 else "DeskFox 本地版"
    ui = UI(host="127.0.0.1:%s" % port, process_name=process)
    try:
        print("目标: %s @ 端口 %s" % (process, port))
        geo = ui.window_geometry()
        print("窗口: 视口 %sx%s | 平台 %s | 在屏幕外=%s\n"
              % (geo["viewport"]["w"], geo["viewport"]["h"], geo.get("platform"), geo.get("offscreen")))

        # ── W-A 文件树里子目录文件的路径写法 ────────────────────
        path = nested_file_path(ui)
        if not path:
            record("W-A", "文件树子目录文件路径写法", "skip",
                   "当前项目文件树里没有展开的子目录文件 —— 请先展开一个目录")
            return finish()
        # W-A 是**背景信息,不是判据**。
        # `data-tree-path` = `node.path`,是给 fs 操作用的 **OS 原生路径**,
        # Windows 上带反斜杠是设计如此(它要拿去读写文件),不该、也不能强行改成正斜杠。
        # 真正该守的不变式是「**进入 @-mention 时**统一成正斜杠」,由 W-C / W-D 判定。
        # 第一版把 W-A 也当判据 → 报了一条永远修不掉的 FAIL,反而淹没真问题。
        has_backslash = "\\" in path
        record("W-A", "文件树节点路径(OS 原生写法,仅背景信息)", "ok",
               "data-tree-path = %r(%s;归一化应发生在 mention 边界,见 W-C)"
               % (path, "反斜杠" if has_backslash else "正斜杠"))

        # ── W-B `@` 提及补全给出的规范写法 ──────────────────────
        # 这条是**基准**:补全是产品自己认可的引用写法,别的通道都该与它一致。
        reset_editor(ui)
        stem = path.replace("\\", "/").rsplit("/", 1)[-1].rsplit(".", 1)[0][:6]
        ui.type_text("@" + stem)
        time.sleep(2.0)
        # 候选必须**限定在补全弹层内**用结构锚点取,不能靠文本特征或几何邻近。
        #
        # 2026-08-14 连撞两次,都是同一类错误的两个版本:
        #   ① 全文档扫「含分隔符的文本」→ 抓到右侧栏的项目路径 `D:\\Test Question Identification`;
        #   ② 改成「输入框上方 320px 内」→ 抓到聊天记录里的一条 shell 命令
        #      `Get-Content "D:\\...\\README.md"`。
        # 两次都把一条本该通过的用例判成 FAIL,还连累后面的一致性比对拿垃圾去比。
        # **几何邻近不是锚点** —— 输入框上方本来就是消息流,里面什么文本都可能有。
        #
        # 实测校准的结构锚点:弹层是 `div[class*="translate-y-full"]`(相对输入框上翻),
        # 每条候选是它里面的 `button`。取不到就 SKIP,绝不退化成文本猜测。
        suggestions = ui.ev("""
        (() => {
          const pop = [...document.querySelectorAll('div[class*="translate-y-full"]')]
            .find(e => e.getBoundingClientRect().height > 0);
          if (!pop) return [];
          return [...pop.querySelectorAll('button')]
            .map(b => (b.textContent||'').trim())
            .filter(t => t && t.length < 120);
        })()
        """) or []
        canon = next((s for s in suggestions if "/" in s or "\\" in s), None)
        if not canon:
            record("W-B", "@ 提及补全的规范写法", "skip",
                   "补全没有出候选 —— 换个更常见的关键词,或该项目无匹配文件")
        else:
            record("W-B", "@ 提及补全的规范写法", "ok" if "\\" not in canon else "fail",
                   "候选 %r(%s)" % (canon, "反斜杠" if "\\" in canon else "正斜杠"))

        # ── W-C 文件树拖入输入框,插入的写法 ────────────────────
        reset_editor(ui)
        src = box_of_tree_path(ui, path)
        ui.require(src, "拖动源节点 %r 取不到几何" % path)
        ed = ui.find_element(selector=EDITOR)
        ui.assert_in_viewport(src, "拖动源")
        ui.assert_in_viewport(ed, "输入框")
        ui.drag(src["cx"], src["cy"], ed["cx"], ed["cy"], steps=25)
        time.sleep(1.5)
        inserted = editor_text(ui).strip()
        if not inserted:
            record("W-C", "文件树拖入输入框", "skip",
                   "拖动后输入框为空 —— CDP 合成鼠标可能没驱动起 HTML5 dragstart,需人工验")
        else:
            record("W-C", "文件树拖入插入的路径写法",
                   "ok" if "\\" not in inserted else "fail",
                   "插入 %r(%s)" % (inserted, "反斜杠" if "\\" in inserted else "正斜杠"))

        # ── W-D 三通道一致性(本分支 feat 明确宣称的不变式)──────
        # [feat: external-drop-path-ref] 的 bug-repro 原文:
        # 「同一个文件出现两种引用写法」。这条就是验它在 Windows 上到底成立没有。
        forms = {k: v for k, v in {
            "@提及补全": canon,
            "文件树拖入": inserted or None,
        }.items() if v}
        seps = {("反斜杠" if "\\" in v else "正斜杠") for v in forms.values()}
        if len(forms) < 2:
            record("W-D", "多通道路径写法一致", "skip",
                   "只取到 %d 条通道的写法,无法比对" % len(forms))
        else:
            record("W-D", "多通道路径写法一致", "ok" if len(seps) == 1 else "fail",
                   " / ".join("%s=%r" % (k, v) for k, v in forms.items()))

        reset_editor(ui)
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
    print("\nP0-1:共 %d 项 — 通过 %d,跳过 %d(环境前提不满足),待处理 %d" % (len(rows), ok, skip, fail))
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
