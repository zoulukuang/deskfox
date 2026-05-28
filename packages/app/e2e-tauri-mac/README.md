# Phase 2 真桌面 e2e — Mac 端(GUI 黑盒)

> Mac 平台 DeskFox 真桌面端到端测试基础设施。跟 [Win 端 `e2e-tauri/`](../e2e-tauri/) 平级 — 用例 / saveDialog 思路 / spec 流程对齐,**底层物理实现完全不同**(macOS WKWebView 不支持 CDP,改走 osascript + cliclick + screencapture GUI 黑盒)。
>
> **feat-id**: `e2e-tauri-phase2-mac`
> **生效日期**: 2026-05-28
> **依赖 feat**: [`e2e-tauri-phase2-real-desktop`](../../../docs/features/e2e-tauri-phase2-real-desktop/)(Win 端,已 done)

## 一句话

Mac 端 Phase 2 真桌面 e2e — 真启动 `DeskFox Dev.app`,真 Tauri / 真 WKWebView / 真 saveDialog(env mock),真 docx 落盘,osascript + cliclick + screencapture 模拟用户行为。

## 跟 Win 端的对位

| 维度 | Win(`e2e-tauri/`) | Mac(本目录 `e2e-tauri-mac/`) |
|---|---|---|
| WebView 引擎 | WebView2(Chromium) | WKWebView(WebKit) |
| **debug 协议** | **CDP** + Playwright `connectOverCDP` | **无 CDP**,GUI 黑盒(无 page 对象) |
| spawn | `DeskFox.exe` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` | `.app/Contents/MacOS/DeskFox` + env `DESKFOX_E2E_SAVE_PATH` |
| 窗口前景 | PowerShell `SetForegroundWindow` | `osascript activate` |
| **saveDialog mock** | **方案 ①** `page.exposeFunction("__deskFoxE2eSavePath")` | **方案 ② 降级** — env var + Tauri command `read_e2e_save_path_env` |
| 模拟点击 | `page.click()` / `page.keyboard.press()` | `cliclick c:x,y` + `osascript keystroke` |
| 视觉验证 | `page.screenshot()` | `screencapture` + `sips` 裁图 |
| 用例 spec | `smoke-cdp.spec.ts` / `md-to-word-real.spec.ts` | `smoke-mac.spec.ts` / `md-to-word-real-mac.spec.ts` |

## 依赖

1. **dev .app 已 build**:
   ```bash
   bash packages/branding/scripts/build-deskfox.sh -Env dev
   ```
   产出:`packages/desktop/src-tauri/target/release/bundle/macos/DeskFox Dev.app`
2. **cliclick 已装**:`brew install cliclick`(本机已装 5.1)
3. **辅助功能权限**:首次跑会触发 macOS 弹窗,user 在 `System Settings → 隐私与安全 → 辅助功能` 给以下 app 授权:
   - Terminal(或你跑测试的 IDE / shell)
   - cliclick(`/Users/<user>/homebrew/bin/cliclick` 等具体路径)
4. **不需要装 Playwright webkit binary** — 我们用的是 `@playwright/test` 的 test runner,不连任何浏览器。

## 跑法

### 跑 smoke(链路通)

```bash
cd packages/app
bun run test:e2e:tauri-mac -- --grep smoke
```

预期:`smoke-mac.spec.ts` 2 个 case 都 pass(~60s 总耗时,含 spawn .app + waitForLaunch)。

### 跑全套

```bash
cd packages/app
bun run test:e2e:tauri-mac
```

注:`md-to-word-real-mac.spec.ts` 当前 `test.fixme` 暂时跳过(待 user-flow 实证后启用)。

### 平台自动 dispatch

顶层 `test:e2e:tauri` 按 `process.platform` 自动选 win/mac:

```bash
cd packages/app
bun run test:e2e:tauri    # Mac 上自动跑 tauri-mac;Win 上自动跑 tauri-win
```

## 目录结构

```
packages/app/e2e-tauri-mac/
├── fixtures.ts                # Playwright fixture 主体(spawn .app + activate + teardown)
├── playwright-tauri-mac.ts    # Playwright config(testDir=./specs / workers=1 串行 / 180s timeout)
├── helpers/
│   ├── osascript.ts           # AppleScript 封装 — activate / quit / windowBounds / keystroke / clickMenuItem
│   ├── cliclick.ts            # cliclick 封装 — click / rightClick / type / keyPress / wait
│   ├── screencapture.ts       # screencapture + sips 裁图(全屏 / 窗口区域)
│   ├── window-bounds.ts       # 窗口位置 retry + 锚点计算 helper
│   └── index.ts               # 统一出口
├── specs/
│   ├── smoke-mac.spec.ts            # 链路 smoke(.app 启动 / 窗口可见 / 截屏非空白 / 二次启动)
│   └── md-to-word-real-mac.spec.ts  # 完整 MD → docx(当前 test.fixme,实证后启用)
└── README.md                  # 本文件
```

## 设计要点

### 1. saveDialog mock 方案 ② 降级理由

Win 端方案 ①(`page.exposeFunction`)依赖 Playwright `page` 对象注入函数到 `window`。Mac 端没 Playwright page(GUI 黑盒不连 WebView debug),方案 ① 在 Mac 注入端没解。

降级到方案 ②(env var):
- **测试侧**:`fixtures.ts` spawn .app 时 `env: { DESKFOX_E2E_SAVE_PATH: "/tmp/..." }` 注入
- **产品侧**:`packages/desktop/src/index.tsx saveFilePickerDialog` 调新 Tauri command `read_e2e_save_path_env`,env 存在则返(测试)、不存在 fall through 走 native save dialog(生产)
- **产品代码侵入**:Tauri command `+15 行` + index.tsx hook `+10 行`,FORK marker 标全

**生产环境不撞** — `DESKFOX_E2E_SAVE_PATH` env 永远不设,fall through 路径跟现有 native dialog 行为完全一致。

### 2. 进程命名陷阱

| 名 | 来源 | 用途 |
|---|---|---|
| **CFBundleName = "DeskFox Dev"** | tauri-overrides/dev.json `productName` | osascript `tell application "DeskFox Dev"` |
| **mainBinaryName = "DeskFox"** | tauri-overrides/dev.json | binary basename / `ps -ax` / `pgrep -f` 在 System Events 进程列表 |
| **bundle path 含 "DeskFox Dev.app"** | 物理路径 | `pkill -9 -f "DeskFox Dev.app"` 精确匹配(不打 prod `/Applications/DeskFox.app`) |

⚠️ prod 跟 dev 都跑 binary 都叫 "DeskFox"(同 mainBinaryName),**只有完整 .app 路径子串可区分**。Fixture 的 `killStaleDevInstances` 用 `pkill -f "DeskFox Dev.app"`,精确度比 process basename 高。

### 3. 串行约束(workers=1)

GUI 模拟只有一个 front window,**禁止并行测试**(并行会撞菜单 / 撞鼠标位置 / 撞窗口前景争夺)。`playwright-tauri-mac.ts` 强制 `workers: 1 / fullyParallel: false`。

### 4. test.fixme 模式

`md-to-word-real-mac.spec.ts` 当前 fixme — 不是 bug,是**等实证**:
- mdMenu 菜单项顺序(用 ↓↓↓ 第几个是"导出为 Word")
- viewer 中部右键的精确锚点(REQ-032 clamp 可能反位移)
- 命令面板 Cmd+K 在 Mac 是否完全等价(键码 + 修饰键 + DOM 焦点)

smoke 跑通 + user 在键盘 nav 路径实证后,fixme 改 `test` 启用。

## 已知坑

### 坑 1:辅助功能权限

首次跑 cliclick / osascript 会让 macOS 弹"X 想要控制 Y"权限对话框。**user 必须手动授权**(System Settings → 隐私与安全 → 辅助功能 + 自动化),无人值守授权方案需要 root + tccutil(运维侧)。

### 坑 2:Retina 坐标系

cliclick 自动按 logical resolution 处理(`(0,0)` 是屏幕左上,跟 macOS 标准一致),**不需要 2x Retina 换算**。但 screencapture 截出来的 .png 是 physical resolution(2x),sips 裁图时 `--cropOffset` 用 logical 坐标也对(macOS 自动桥)。

### 坑 3:cliclick 修饰键不稳

`cliclick` 不可靠支持 Cmd/Option 等修饰键(memory `reference_deskfox_gui_automation.md` §8)。组合键全部走 `osascript keystrokeWithModifiers`(System Events keystroke `"k" using {command down}`)。

### 坑 4:窗口移动后位置失效

Tauri 窗口可被 user 拖动,`anchorOf(bounds, ...)` 必须每次重新查 `windowBounds()`,不能缓存。Fixture 的 `windowBounds: () => getWindowBoundsRetry(...)` 设计如此(每次调用是 fresh osascript 查询)。

### 坑 5:prod / dev 共存进程名一样

dev `.app/Contents/MacOS/DeskFox` 和 prod `/Applications/DeskFox.app/Contents/MacOS/DeskFox` 进程 basename 都叫 `DeskFox`,**不能用 `pkill -f DeskFox` 精确匹配**(会误杀 prod)。Fixture 用 `pkill -f "DeskFox Dev.app"`(完整 .app 路径子串)精确锁 dev。

### 坑 6:macOS Gatekeeper 首次

Dev .app 没签名,首次 `open .app` 会被 macOS Gatekeeper 拦。fixture 的 `spawn` 直接走 binary path(`.app/Contents/MacOS/DeskFox`),跳过 LaunchServices,**不撞 Gatekeeper**。

## Backlog

- [ ] `md-to-word-real-mac.spec.ts` 启用(待 user-flow 实证 + mdMenu 菜单项顺序)
- [ ] 加更多 spec:导出 PDF / 文件树拖入 / MiniMax 视频生成 / 创作模式
- [ ] CI 接入(GitHub Actions macos-latest runner;权限授予自动化是难点)
- [ ] 视觉 diff(对比 baseline .png,识别 UI 回归)
- [ ] 共通 spec 抽象层(`e2e-tauri-shared/`):90% 平台无关断言抽出,各平台 fixture 实现
- [ ] Linux 端同款架构(xdotool + scrot 黑盒)
