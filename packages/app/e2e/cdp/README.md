# CDP 真机 harness(L3)

连「真·本地版 Electron app」的渲染进程,用 Playwright `connectOverCDP` 驱动 DOM。
**零 TCC、真实数据/真实文件树**,跑 mock harness 难造的场景(文件树多选、原生对话框旁路)。

> 与 L2(`e2e/regression/` 的 mock harness)互补:L2 进 CI、确定性;L3 不进 CI、真机冒烟。
> 方法论见 OPENCODE-PLAN `协作方案/前端自动化测试-工具与方法论.md`。

## 1. 起带调试端口的本地版

```bash
# 退掉已开的本地版,再带 --remote-debugging-port 起
pkill -f "MacOS/DeskFox 本地版" 2>/dev/null; sleep 2
"/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app/Contents/MacOS/DeskFox 本地版" \
  --remote-debugging-port=9222 &
```

确认端口:`curl -s http://127.0.0.1:9222/json/version | python3 -m json.tool`

## 2. 在 app 里准备场景

桌面端用 MemoryRouter,**不能 `page.goto`**,只能 DOM 点击导航。先在 app 里打开一个项目(含文件夹),再跑脚本。

## 3. 跑脚本

```bash
node packages/app/e2e/cdp/folder-selection.cdp.mjs   # U4 REQ-062 文件夹选中态
```

## 写新 L3 脚本

```js
import { connectApp, modifierClick } from "./connect.mjs"
const { browser, page } = await connectApp()      // 默认端口 9222,可用 CDP_PORT 覆盖
// ... page.locator("[data-tree-path]") / modifierClick(page, locator) / page.screenshot(...) ...
await browser.close()
```

要点:断言优先 data-*(如 `[data-tree-path]`、`[data-action="project-switch"]`);真 app 是中文 locale(与 L2 mock 的英文不同)。
