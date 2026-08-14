#!/usr/bin/env python3
"""[fork-only] 驱动原生「打开项目」面板打开指定目录 [feat: ui-probe-toolkit] 2026-08-13

对应 CHECKLIST #19(原标「手工」)。NSOpenPanel 是原生层,CDP 碰不到,只能 AppleScript。

**每步都断言前提**:面板没起来就敲键盘,按键会落到主窗口上乱触发快捷键 ——
这正是「点了个空还报绿」的同类失误,所以每一步先确认状态再动手。

跑法:python3 packages/branding/smoke/open_project.py /path/to/project
"""
import subprocess
import sys
import time

from uiprobe import UI, ProbeError

APP_PROCESS = "DeskFox 本地版"


def osa(script: str, timeout: int = 15) -> str:
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise ProbeError("AppleScript 失败:%s" % (r.stderr or "").strip()[:200])
    return (r.stdout or "").strip()


def panel_count() -> int:
    """当前有几个「打开项目」面板。

    2026-08-13 实撞:上一轮失败留下的面板没关,再跑一次就有**两个**同名面板 ——
    `first window whose name is "打开项目"` 读的是其中一个,而键盘事件去的是前台那个,
    于是「读到的 sheet 一直不消失」,被误判成「路径无效」。
    与 CDP 那个「两个 page target 连错窗口」是同一类问题:**有重名对象时,读的和操作的不是同一个。**
    """
    out = osa('tell application "System Events" to tell process "%s" to '
              'return name of every window' % APP_PROCESS)
    return sum(1 for n in out.split(",") if n.strip() == "打开项目")


def panel_present() -> bool:
    """打开面板是否已出现。

    2026-08-13 实撞:先按「sheet 挂在主窗口上」写,结果 `sheets of window 1` 恒为 0,
    误判成「面板没起来」。实测它是**独立窗口**,窗口名就是「打开项目」——
    又一次「按想当然写检测」栽跟头,所以改成按窗口名实测。
    """
    out = osa('tell application "System Events" to tell process "%s" to '
              'return name of every window' % APP_PROCESS)
    return any(n.strip() == "打开项目" for n in out.split(","))


def goto_sheet_count() -> int:
    """「前往文件夹」是挂在打开面板上的 sheet(面板自身才是独立窗口)。"""
    try:
        out = osa('tell application "System Events" to tell process "%s" to '
                  'return count of sheets of (first window whose name is "打开项目")' % APP_PROCESS)
        return int(out)
    except Exception:
        return 0


def goto_sheet_value() -> str | None:
    try:
        return osa('tell application "System Events" to tell process "%s" to '
                   'return value of text field 1 of sheet 1 of '
                   '(first window whose name is "打开项目")' % APP_PROCESS)
    except Exception:
        return None


def wait_for(cond, timeout_s: float, interval: float = 0.4) -> bool:
    """轮询等待,而不是固定 sleep —— 固定 sleep 是本脚本第一版失败的直接原因。"""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            if cond():
                return True
        except Exception:
            pass
        time.sleep(interval)
    return False


def press_until(cond, what: str, tries: int = 3, each_wait: float = 4.0) -> bool:
    """按回车直到状态真的变了 —— 「该按几次」不是常量,别写死。

    自动补全下拉展开时,第一次回车只是接受补全,得再按一次;不展开时一次就够。
    盲敲固定次数要么少按(卡住)要么多按(误触下一步),都会得出错误结论。
    """
    for i in range(tries):
        osa('tell application "System Events" to set frontmost of process "%s" to true' % APP_PROCESS)
        osa('tell application "System Events" to key code 36')
        if wait_for(cond, each_wait):
            if i:
                print("  (%s 用了 %d 次回车)" % (what, i + 1))
            return True
    return False


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "/Volumes/ExtSSD/deskfox-uitest"
    ui = UI()
    try:
        # 前提断言 0:开工前不能已经有面板挂着,否则同名窗口指代不清(见 panel_count 注释)
        stale = panel_count()
        if stale:
            raise ProbeError("已有 %d 个「打开项目」面板挂着(多半是上一轮失败留下的),"
                             "同名窗口会让读到的和操作的不是同一个 —— 请先按 Esc 关掉再跑" % stale)

        btn = ui.find_element(label="打开项目")
        ui.require(btn, "找不到「打开项目」入口")
        print("入口: %s @ (%s,%s)" % (btn.get("label"), btn["cx"], btn["cy"]))

        before = ui.ev("(() => document.body.innerText.slice(0,40))()")
        ui.click_element(btn, "打开项目")

        # 前提断言 1:面板真的出来了才继续敲键盘,且只能有一个
        if not wait_for(panel_present, 8):
            raise ProbeError("点了「打开项目」但没有出现原生面板 —— 后续按键会落到主窗口上乱触发,已中止")
        if panel_count() != 1:
            raise ProbeError("出现 %d 个「打开项目」面板,指代不清,已中止" % panel_count())
        osa('tell application "System Events" to set frontmost of process "%s" to true' % APP_PROCESS)
        time.sleep(0.4)
        print("原生打开面板已出现")

        # Cmd+Shift+G 呼出「前往文件夹」sheet
        osa('tell application "System Events" to keystroke "g" using {command down, shift down}')
        if not wait_for(lambda: goto_sheet_count() == 1, 8):
            raise ProbeError("Cmd+Shift+G 没有呼出「前往文件夹」输入框")

        osa('tell application "System Events" to keystroke %s' % _as_str(target))
        time.sleep(1.0)  # 等自动补全下拉收起:补全还展开时,第一次回车只是「接受补全」
        # 确认输入框里**真的**是目标路径,再按回车 —— 否则等于盲敲
        got = goto_sheet_value()
        if got != target:
            raise ProbeError("「前往文件夹」输入框内容是 %r,不是目标 %r" % (got, target))

        # 2026-08-13 实撞:原来固定 sleep 1.2s 就接着敲第二次回车,而 sheet 尚未处理完,
        # 第二次回车落空 → 面板不关 → 误判「路径没被接受」。
        # 且回车次数**本就不固定**:自动补全展开时要多按一次。改成「按一次、等状态、没变再按」。
        if not press_until(lambda: goto_sheet_count() == 0, "关闭「前往文件夹」"):
            raise ProbeError("「前往文件夹」输入框未消失,路径可能无效")

        if not press_until(lambda: not panel_present(), "确认打开"):
            raise ProbeError("面板仍在,路径可能没被接受 —— 未确认打开成功")
        print("面板已关闭")

        # 结果判定:读**项目路径**这类结构化信息,不用 innerText 泛匹配
        for _ in range(10):
            time.sleep(1.0)
            cur = ui.ev("(() => { const t = document.body.innerText||''; "
                        "const m = t.match(/\\/Volumes\\/[^\\n]+/); "
                        "return m ? m[0].trim() : null; })()")
            if cur and target in cur:
                print("当前项目路径: %s" % cur)
                print("OK 已打开 %s" % target)
                return 0
        print("未能确认项目已切换(before=%r)" % before)
        print(ui.shot("open-project-unconfirmed"))
        return 1
    except ProbeError as e:
        print("中止:%s" % e)
        return 1
    finally:
        ui.close()


def _as_str(s: str) -> str:
    return '"%s"' % s.replace("\\", "\\\\").replace('"', '\\"')


if __name__ == "__main__":
    sys.exit(main())
