# Phase 2 真桌面 e2e — Agent 用法指南

> **状态**:✅ 已启用(2026-05-28,feat `e2e-tauri-phase2-real-desktop` 合 main)
> **位置**:`packages/app/e2e-tauri/`(独立 Playwright runner,跟 Phase 1 mock e2e 互不干扰)

## 这一层 e2e 能干什么(用一段话讲清)

驱动**真编译过的 DeskFox.exe**,真启动 + WebView2 真 hydrate + 真 Tauri command + 真 Rust 后端往返,然后用 Playwright 通过 WebView2 CDP(`--remote-debugging-port=9222`)操作 UI,做端到端断言。

CDP self-test(`packages/media-gen/scripts/cdp-*.ts`)验数据 + Phase 1 mock e2e(`packages/app/e2e/`)验组件行为 + **本层(Phase 2)验真 Tauri 跨进程实际行为**,三层互补,**任何 Tauri/WebView 边界 bug** 只有本层能抓到。

## 测试金字塔三层

```
┌──────────────────────────────────────────────┐
│ Phase 2 真桌面 e2e  ← 本层                    │
│   - 验 native dialog 行为(save/open)        │
│   - 验 真 Tauri command 跨进程行为            │
│   - 验 真 Rust 后端读写                       │
│   - 慢:每 spec 1-2 分钟,build release 前提  │
├──────────────────────────────────────────────┤
│ Phase 1 mock e2e(packages/app/e2e)          │
│   - Vite mock + Playwright,组件交互验证      │
│   - 快:每 spec 几秒,无需 build              │
├──────────────────────────────────────────────┤
│ Unit tests(各包 bun test)                   │
│   - 纯逻辑,毫秒级                            │
└──────────────────────────────────────────────┘
```

## 快速跑(给 Agent)

```powershell
# 0. 杀残留(无条件,避免 :9222 被占 / DeskFox.exe 被锁)
powershell -Command "Get-Process -Name DeskFox,opencode-cli -ErrorAction SilentlyContinue | Stop-Process -Force"

# 1. build release exe(每次产品代码改动后必跑;只改测试代码可跳)
D:\project\opencode-fork\packages\branding\scripts\build-deskfox.ps1 -Env dev -NoBundle

# 2. 跑所有 e2e-tauri specs
bun run --cwd packages/app test:e2e:tauri

# 跑单个 spec
bun run --cwd packages/app test:e2e:tauri specs/md-to-word-real.spec.ts

# 跑前 grep 一下 spec 名(测试 title 走 --grep)
bun run --cwd packages/app test:e2e:tauri --grep "完整端到端"

# 看 trace(测试失败时,Playwright 自动生成 trace.zip)
npx playwright show-trace packages/app/e2e-tauri/test-results/<test-name>/trace.zip
```

**注意**:跑期间 DeskFox 窗口会真弹出(headless 不支持,Tauri WebView2 限制)。fixture 内置 `SetForegroundWindow` 把它顶到前景方便观察,**不影响测试正确性**。

## 现有 spec

| Spec | 验证内容 | 状态 |
|---|---|---|
| `specs/smoke-cdp.spec.ts` | CDP 链路 / WebView 渲染 / DOM 探查 | ✅ #1 pass(41s)/ ⚠ #2 race(连续 spawn 偶发,留 backlog) |
| `specs/md-to-word-real.spec.ts` | 完整端到端 MD → docx(右键导出 Word 全链路) | ✅ pass(1.2 min,产 22.5KB docx) |

## fixture API(给写新 spec 的 Agent)

`fixtures.ts` 暴露的 `deskfoxApp` 自动:
1. spawn 真 `DeskFox.exe`(带 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`)
2. 等 CDP `http://127.0.0.1:9222` 就绪(30s 超时)
3. `chromium.connectOverCDP` 连入主 WebView
4. **注入 saveDialog mock**(`page.exposeFunction("__deskFoxE2eSavePath", () => savePath)`,见下)
5. 等 SolidJS hydrate(button visible)
6. **强制 goto 测试项目 URL**(base64 编码本仓根路径,统一环境不靠 user state)
7. `SetForegroundWindow` 把 DeskFox 顶前景
8. 测试结束 SIGKILL DeskFox + close browser + 500ms 让 Win 释放端口

测试代码可以直接用 `deskfoxApp.{page, browser, context, proc, e2eSavePath}`。

```ts
import { test, expect } from "../fixtures"

test("我的新场景", async ({ deskfoxApp }) => {
  const { page, e2eSavePath } = deskfoxApp
  // page 是 Playwright Page 对象,跟普通 Playwright spec 一样用
  await page.keyboard.press("Control+k")
  // ...
})
```

## saveDialog mock 模式(可复用)

**问题**:Tauri native save dialog 弹出后,Playwright 不能跨进程操作 native UI,测试卡住。

**方案**:`page.exposeFunction` + 平台 hook,**0 产品代码侵入**:

- **产品端**(`packages/desktop/src/index.tsx saveFilePickerDialog`):
  ```ts
  const e2eMock = (window as unknown as { __deskFoxE2eSavePath?: ... }).__deskFoxE2eSavePath
  if (typeof e2eMock === "function") {
    const mocked = await e2eMock(opts)
    if (typeof mocked === "string") return mocked
  }
  // fall through 走真 native dialog(生产环境永远走这,window 字段 undefined)
  const result = await save({ ... })
  return handleWslPicker(result)
  ```
- **测试端**(`fixtures.ts`):
  ```ts
  await page.exposeFunction("__deskFoxE2eSavePath", () => e2eSavePath)
  ```

**任何新的 native dialog mock 都按这套**:产品端加 `(window as any).__deskFoxE2e<Name>` 检查,fixture exposeFunction 注入。

## 加新 spec 的 checklist(给 Agent)

写新 e2e-tauri spec 时,**按这个 checklist 抄**(避免重新踩坑):

1. ✅ **新文件放 `specs/`**,命名 `<feature>-real.spec.ts`(`-real` 后缀区分于 Phase 1 mock)
2. ✅ **import**:`import { test, expect } from "../fixtures"`(不是 `@playwright/test`)
3. ✅ **不要手 spawn DeskFox** —— fixture 已经做
4. ✅ **不要手 connectOverCDP** —— fixture 已经做
5. ✅ **找文件用 `Ctrl+K` 命令面板**,不要点文件树(文件树 SolidJS 结构容易飘,命令面板稳)
6. ✅ **right-click 用 Portal 选择器**,`[data-slot="<menu-slot>"]`(SolidJS Portal 渲到 body 外)
7. ✅ **跨进程文件读 / dialog 操作 用 mock 模式**(见上面 saveDialog mock 段)
8. ✅ **测试输出落 `D:/tmp/deskfox-test-output/`**(已被 `.gitignore` 排,且 OS 重启自清)
9. ✅ **失败截图** `await page.screenshot({ path: "e2e-tauri/test-results/<phase>.png" })`,test-results/ 已 .gitignore
10. ✅ **timeout 给宽**(release exe 启动 + hydrate 慢,Playwright config 已默认 120s / expect 15s)

## 已知限制

- **仅 Win**:Mac 端 WebView 是 WKWebView,CDP 行为不同(需 Safari Inspector 路径,留 backlog)
- **WebDriverIO + tauri-driver 走不通**:Tauri 2 时代 msedgedriver 启 isolated 空 WebView2,**不要再尝试**
- **测试窗口必弹**:headless 不支持,fixture 已 SetForegroundWindow 顶前景
- **连续 spawn race**(smoke#2 已知):后一个 test fixture spawn DeskFox 时偶发 page crash,sidecar 清不全。短期 workaround:每个 spec 文件只放 1 个 test,或加 `await new Promise(r => setTimeout(r, 3000))` 让端口释放。长期 follow-up:fixture 改进 process group kill
- **不进 pre-push 闸**:build release 太重(2-3 min)+ 测试 1-2 min,push 闸太慢。手动跑 / CI 触发 / ship 前跑

## 跟 Phase 1 mock e2e 怎么分工

| 场景 | 用 Phase 1 mock(快) | 用 Phase 2 真桌面(慢) |
|---|---|---|
| 组件交互逻辑(click / type / state 变化) | ✅ | × |
| Vite mock 可以 mock 的 Tauri command | ✅ | × |
| native dialog 行为(save/open file picker) | × | ✅ |
| Rust 后端真读写 / IPC 边界 bug | × | ✅ |
| 真 Tauri command 跨进程时序 | × | ✅ |
| 跑测试要不要 `bun run dev` Vite 服务 | ✅ 要 | × 不要 |
| 跑测试要不要 build release exe | × 不要 | ✅ 要 |

**Phase 1 能做的优先 Phase 1**,Phase 2 留给「native / 跨进程 / 真 Rust」类。

## 关联文档

- 治理:[`docs/governance/自动化测试规范.md`](../../../docs/governance/自动化测试规范.md) — 测试纪律 / R5 规则
- spec 文档:[`docs/features/e2e-tauri-phase2-real-desktop/`](../../../docs/features/e2e-tauri-phase2-real-desktop/) — 本 feat 三文档
- Phase 1 mock e2e:[`packages/app/e2e/README.md`](../e2e/README.md) — 兄弟基础设施

## Follow-up(留 backlog)

| 项 | 投入 |
|---|---|
| smoke#2 race fix(fixture 加 process group kill / 更长 release 等) | 小 |
| Mac CDP 路径(WKWebView Safari Inspector) | 大 |
| 加更多 spec(导出 PDF / 文件树拖入 / 创作模式生成 / IM 桥接) | 持续 |
| 进 CI 闸(ship 前自动跑) | 小 |
| docx 视觉效果优化(2026-05-07 实证 user 反馈"不理想") | 独立 feat |
