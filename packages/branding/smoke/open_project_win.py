#!/usr/bin/env python3
"""[fork-only] Windows 版「打开项目」—— 驱动原生文件夹对话框 [feat: upstream-sync-2026-08] 2026-08-14

`open_project.py` 是 macOS 版(12 处 AppleScript 驱动 NSOpenPanel),Win 上完全跑不了。
交接文档把它列为「🔴 要重写」。这就是重写版。

## 与 Mac 版的关键差别(不是照抄换 API)

| | macOS | Windows |
|---|---|---|
| 对话框形态 | NSOpenPanel,**独立窗口**,窗口名「打开项目」 | IFileDialog,窗口类 `#32770` |
| 定位路径输入 | ⌘⇧G 呼出「前往文件夹」sheet | 对话框自带 Edit 控件,无需呼出 |
| 填路径 | AppleScript keystroke(要等自动补全收起) | **UIA ValuePattern.SetValue**,一次到位 |
| 确认 | 敲回车,次数不固定(补全展开时要多敲一次) | Invoke 确认按钮,确定性 |

Mac 版在「敲几次回车」上翻过车(见其 `press_until` 注释)。Win 版**直接把这个不确定性消掉**:
设值 + 点按钮,没有键盘、没有补全、没有时序猜测。

跑法:python packages/branding/smoke/open_project_win.py D:\\deskfox-uitest
"""
import sys
import time

from uiprobe import UI, ProbeError

APP_PROCESS = "DeskFox 本地版"


def wait_for(pred, timeout: float, step: float = 0.5) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(step)
    return False


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "D:\\deskfox-uitest"
    ui = UI()
    native = ui.native
    try:
        # 前提断言 0:开工前不能已经挂着对话框 —— 同 Mac 版的教训,
        # 有重名/多个对话框时「读到的」和「操作的」可能不是同一个。
        stale = native.dialogs(APP_PROCESS)
        if stale:
            raise ProbeError("已有 %d 个原生对话框挂着(多半是上一轮失败留下的),"
                             "请先关掉再跑" % len(stale))

        btn = ui.find_element(label="打开项目")
        ui.require(btn, "找不到「打开项目」入口")
        print("入口: %s @ (%s,%s)" % (btn.get("label"), btn["cx"], btn["cy"]))

        before_title = ui.ev("document.title")
        ui.click_element(btn, "打开项目")

        # 前提断言 1:对话框真的出来了才动手 —— 没出来就设值,等于对着空气操作
        if not wait_for(lambda: bool(native.dialogs(APP_PROCESS)), 10):
            raise ProbeError("点了「打开项目」但没有出现原生对话框,已中止")
        dlgs = native.dialogs(APP_PROCESS)
        if len(dlgs) != 1:
            raise ProbeError("出现 %d 个原生对话框,指代不清,已中止" % len(dlgs))
        print("原生对话框已出现: %s" % (dlgs[0].get("title") or "(无标题)"))

        r = native.open_path_in_dialog(APP_PROCESS, target)
        if not r or not r.get("ok"):
            controls = native.dialog_controls(APP_PROCESS)
            print("对话框控件清单(供排障):")
            for c in (controls[0].get("controls") if controls else [])[:25]:
                print("   %-28s %s" % (c.get("type", "?").split(".")[-1], c.get("name")))
            raise ProbeError("填路径/确认失败:%s" % (r or {}).get("reason", "未知"))
        print("已填入路径并点击「%s」" % r.get("button"))

        if not wait_for(lambda: not native.dialogs(APP_PROCESS), 10):
            raise ProbeError("确认后对话框仍在 —— 路径可能无效(检查目录是否存在)")
        print("对话框已关闭")

        # 结果判定:读**结构化的项目路径**,不用 innerText 泛匹配。
        # Win 路径形如 D:\xxx,与 Mac 的 /Volumes/... 不同,这里按盘符匹配。
        leaf = target.rstrip("\\/").rsplit("\\", 1)[-1].rsplit("/", 1)[-1]
        for _ in range(15):
            time.sleep(1.0)
            shown = ui.ev("""
            (() => { const t = document.body.innerText || '';
              const m = t.match(/[A-Za-z]:\\\\[^\\n]{1,120}/);
              return m ? m[0].trim() : null; })()
            """)
            if shown and leaf in shown:
                print("当前项目路径: %s" % shown)
                print("OK 已打开 %s" % target)
                return 0
        print("未能确认项目已切换(before title=%r)" % before_title)
        print(ui.shot("open-project-win-unconfirmed"))
        return 1
    except ProbeError as e:
        print("中止:%s" % e)
        return 1
    finally:
        ui.close()


if __name__ == "__main__":
    sys.exit(main())
