# DeskFox 桌面端到端 e2e(Playwright + WebView2 CDP)

> 状态:**架子搭完,smoke 跑通**(2026-05-08)
>
> **完整 MD → Word 测试 fixme**,等 saveDialog mock 方案落地。

## 路径选型(已踩坑沉淀)

经过 2 条路探索,**最优方案是 Playwright + WebView2 CDP**:

| 路径 | 结果 | 理由 |
|---|---|---|
| ❌ WebdriverIO + tauri-driver | **走不通** | tauri-driver 在 Tauri 2 + Win11 + WebView2 上不接管 DeskFox(msedgedriver 启 isolated 空 WebView2)|
| ✅ Playwright + WebView2 CDP | **跑通** | `--remote-debugging-port=9222` 启 DeskFox + `chromium.connectOverCDP` 连进 真 WebView2 |

## 环境依赖(一次性 setup)

仅 Win 平台:
- Edge 147+(系统已带,WebView2 内核同版本)
- Bun(已装)
- Playwright + chromium 二进制(随 e2e setup 自动装)

**不依赖** WebdriverIO / tauri-driver / msedgedriver / Rust(Playwright 走 CDP,无需这些)。

## 跑法

```powershell
# 必须先 build DeskFox.exe(release)
D:\project\opencode-fork\packages\branding\scripts\build-deskfox.ps1 -Env dev -NoBundle

# 跑 e2e
bun run --cwd packages/app test:e2e:tauri
```

注:config 文件名是 `playwright-tauri.ts`(无 `.config` 后缀)— pre-commit hook 黑名单 `.*\.config\.(ts|js|mjs)$` 防上游配置乱改,fork 加桌面 e2e config 用 `playwright-tauri.ts`(Playwright `--config=` 接任何 .ts 文件,不强制 `.config.ts` 命名)。

## 当前测试

| spec | 状态 | 说明 |
|---|---|---|
| `smoke-cdp.spec.ts` | ✅ 跑通 | DeskFox 启动 + CDP 连 + DOM 探查;0 业务依赖 |
| `md-to-word-real.spec.ts` | ⏸ `test.fixme` | 完整 MD→Word 端到端;**等 saveDialog mock 方案落地后启用** |

## fixture 能力

`fixtures.ts` 提供 `deskfoxApp` test fixture,自动:
1. spawn DeskFox.exe(`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`)
2. 等 9222 端口 CDP 监听就绪
3. `chromium.connectOverCDP` 连入主 WebView
4. 等 SolidJS hydrate(button visible)
5. **强制 `page.goto` 注入测试项目**(默认 `C:/Users/yuexi/Downloads`,统一环境不靠 user state)
6. SetForegroundWindow 让 user 看见(可选,Win32 API)
7. 测试结束自动 kill DeskFox + close browser

## 待解决的关键问题:saveDialog mock

`md-to-word-real.spec.ts` 完整跑通需要让 native save dialog 不弹(直接返 mock 路径)。**3 个候选方案**(实施顺序由难易决定):

### 方案 ① Playwright `page.exposeFunction`(推荐)
- 测试代码:`page.exposeFunction("__deskFoxE2eSavePath", () => "D:/tmp/.../mock.docx")`
- 前端 platform.tsx:try `(window as any).__deskFoxE2eSavePath?.()` 优先,fallback native dialog
- 优点:**0 产品代码侵入**(前端只是查 window 上是否有这个 function,生产环境永远 undefined)
- 投入:小

### 方案 ② env var 检测
- DeskFox.exe 启动加 `DESKFOX_E2E_MODE=1` 环境变量
- 前端 platform.tsx 启动时通过 Tauri command 读 env,标记 e2e 模式
- saveDialog 在 e2e 模式下走 mock(读固定 path 文件 / 路径 fixed)
- 优点:可控
- 缺点:需 1 行 platform 改动 + 1 个 Tauri command(轻度产品改动)

### 方案 ③ Tauri Rust 后端 dialog plugin mock
- 改 packages/desktop/src-tauri 加 e2e config 拦 save_dialog 命令
- 优点:最彻底
- 缺点:重工程,改 Rust 侧

**推荐顺序**:① → ②(① 实在不行)→ ③(都不行才上)。

## 实证(2026-05-07)

`md-to-word-real.spec.ts` 之前用方案 (废)产品代码 hook 跑通过 1 次:
- 真启动 DeskFox + 进 Downloads 项目 + 找 .md + 右键 + 导出 + 真生成 53KB .docx
- 测试 status: passed
- docx 视觉效果 user 反馈"不理想"(独立 backlog,不在 e2e 范围)

代码逻辑已实证可行,只是 mock 方案要换干净路径。

## 已知限制

- **仅 Win**:Mac 端 WebView 是 WKWebView,CDP 行为不同,需要单独 setup(macOS WebDriver / Safari Inspector 路径)
- **WebDriverIO 不再尝试**:Tauri 2 时代验证不行
- **测试期间窗口可见**:fixture 有 SetForegroundWindow,user 跑 e2e 时会看到 DeskFox 弹出(headless 不可行,因 Tauri WebView2 不支持 headless)

## 后续 follow-up(backlog)

| 项 | 投入 |
|---|---|
| 实施 saveDialog mock 方案 ①(`page.exposeFunction`)| 中 |
| 启用 `md-to-word-real.spec.ts`(去 fixme)| 小(mock 落地后)|
| 加 Mac CDP 路径(WKWebView Safari Inspector)| 大 |
| docx 视觉效果优化(user 反馈不理想)| 独立 feat |
| 加更多端到端测试场景(导出 PDF / 文件树拖入 / etc)| 持续 |
