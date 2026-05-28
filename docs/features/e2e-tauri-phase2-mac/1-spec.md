---
feat-id: e2e-tauri-phase2-mac
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 1-spec — e2e Phase 2 真桌面 e2e Mac 端启用(GUI 黑盒,跟 Win 用例对齐)

## 背景

`feat: e2e-tauri-phase2-real-desktop`(2026-05-28 合 main)在 Win 端跑通 Phase 2 真桌面 e2e — Playwright 通过 WebView2 CDP 远程调试,smoke-cdp + md-to-word-real 真启动 + 真 Tauri + 真 docx 落盘。**1-spec 明文 "不做 Mac CDP 路径(WebKit Inspector 不同,留 backlog)"**,Mac 那条路被识别为大投入悬空。

2026-05-28 user 决议:Mac 端 Phase 2 也要实施,跟 Win **保持用例 / saveDialog 思路 / spec 流程一致**;底层 protocol 不一致 ⇒ macOS WKWebView 没有 CDP,**Apple/WebKit 的设计选择,业界没成熟绕过**。

## 平台异同 — 物理事实

| 维度 | Win 端 | Mac 端 | 影响 |
|---|---|---|---|
| WebView 引擎 | WebView2(Chromium 内核) | WKWebView(WebKit 内核,不可换) | 不可绕 |
| **Debug 协议** | **CDP**(Chrome DevTools Protocol) | **WIP**(WebKit Inspector Protocol,跟 CDP 不兼容) | **架构差异根源** |
| 远程 debug 入口 | env `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` | 私有 API `_setRemoteInspectionEnabled`;无标准远程端口 | Mac 无对等 |
| Playwright 连接 | `chromium.connectOverCDP(CDP_URL)` | 不能连嵌入 WKWebView | Mac 无 Playwright |
| 窗口前景 API | PowerShell `[Win32]::SetForegroundWindow` | `osascript -e 'tell app "DeskFox Dev" to activate'` | 一行换 |
| EXE 路径 | `D:/.../DeskFox.exe` | `.app/Contents/MacOS/DeskFox` | 配置化 |
| saveDialog mock 方案 ① | `page.exposeFunction("__deskFoxE2eSavePath")` | **无 Playwright page 对象,方案 ① 注入端不能用** | **必须降级方案 ②** |

**结论**:**Mac 端不能复用 Win 端的 Playwright + CDP 架构**;改走 GUI 黑盒(osascript + cliclick + screencapture + sips),跟 memory `reference_deskfox_gui_automation.md` 既有套路接合。

## 目标

1. 新建 `packages/app/e2e-tauri-mac/` 目录(跟 Win `e2e-tauri/` 平级,平台分流而非合一)
2. `fixtures.ts` Mac 版:spawn `.app/Contents/MacOS/DeskFox` + `osascript activate` + env var saveDialog 注入 + 项目 base64 路径
3. **saveDialog mock 降级方案 ②**(env var `DESKFOX_E2E_SAVE_PATH`):
   - `packages/desktop/src/index.tsx saveFilePickerDialog` 加 `e2eSavePathFromEnv()` 优先(Tauri command 读 env);**生产环境 env 永远不设,fall through 不影响 native dialog**
4. `specs/smoke-mac.spec.ts`:.app 启动 + 窗口可见性 + screencapture 取屏验 hydrate
5. `specs/md-to-word-real-mac.spec.ts`:cliclick + osascript 触发 Cmd+K 打开文件 → 右键 → 「导出为 Word」→ 验 docx 落盘 + word/document.xml 段落 / 文本 run
6. `packages/app/package.json` 加 `test:e2e:tauri-mac` script + 顶层 `test:e2e:tauri` 按 `uname -s` 自动 dispatch(Mac → tauri-mac / Win → tauri)
7. 三文档(spec + plan + changelog)+ INDEX + 改动日志.md

## 非目标

- **不强求底层一致**(物理事实做不到;架构差异接受)
- **不接 pre-push 闸**(同 Win 端理由:Phase 2 真桌面要 build .app + 启动 + 模拟交互,2-5 分钟一轮,push 闸太重;留独立 `bun run test:e2e:tauri-mac` 手动 / CI 触发)
- **不做视觉效果细抠**(docx 视觉差异、cliclick 像素级稳定性等,只做"端到端跑通 + 关键断言"层)
- **不动 Win 端 `e2e-tauri/`**(平行存在,各自独立维护;test:e2e:tauri 顶层 dispatch 平台分流)
- **不接 Phase 1 mock 路径**(Phase 1 已有,本 feat 是 Phase 2 补 Mac)

## 关键设计决策

### A. saveDialog mock 降级方案 ②(env var,非 ①)

Win 端用方案 ①(`page.exposeFunction`)— 测试侧通过 Playwright page 注入函数到 window,产品代码 `window.__deskFoxE2eSavePath?.()` 检查。**Mac 没 Playwright page 对象**(GUI 黑盒不连 WebView debug),方案 ① 实施不了。

降级到方案 ②(env var):
```ts
// packages/desktop/src/index.tsx — 优先 env(测试态)/ 否则 fall through native dialog
const e2eSavePath = await tryReadEnvE2eSavePath()  // Tauri command 读 process env
if (e2eSavePath) return e2eSavePath
// 生产 fall through
const result = await save({ title, defaultPath })
return handleWslPicker(result)
```

测试侧 `fixtures.ts` spawn DeskFox 时 env 注入:
```ts
spawn(".app/Contents/MacOS/DeskFox", [], {
  env: {
    ...process.env,
    DESKFOX_E2E_SAVE_PATH: `/tmp/deskfox-e2e/e2e-real-export-${Date.now()}.docx`,
  },
})
```

**产品代码侵入比 Win 多 1 行**(读 env),但行为外延一致:env 不存在 fall through 真 native。0 e2e mode flag、0 if-then,只看一个 env 是否存在。

### B. GUI 黑盒架构(无 Playwright)

| 工具 | 作用 | memory 出处 |
|---|---|---|
| `spawn .app/Contents/MacOS/DeskFox` + env | 真启动 dev .app + 注入 env | 标准 Node API |
| `osascript -e 'tell app activate'` | 窗口拉前景 | 标准 macOS |
| `cliclick c:x,y` / `cliclick kp:return` | 鼠标点击 / 键盘 | memory `reference_deskfox_gui_automation.md` |
| `osascript -e 'keystroke "k" using command down'` | Cmd+K 等组合键 | 同上 |
| `screencapture -x /tmp/X.png` | 截屏(后台静默)+ sips 裁图 | 同上 |
| `osascript ... get bounds of front window` | 窗口位置动态查询 | 同上 |
| Tauri command `read_e2e_save_path_env` | 前端读后端 env(MAC) | 本 feat 新增 |

### C. 平台 dispatch(单 script 入口)

`packages/app/package.json`:
```json
{
  "scripts": {
    "test:e2e:tauri": "node -e \"const p=require('process').platform;require('child_process').execSync(p==='darwin'?'bun run test:e2e:tauri-mac':'playwright test --config=e2e-tauri/playwright-tauri.ts',{stdio:'inherit'})\"",
    "test:e2e:tauri-mac": "playwright test --config=e2e-tauri-mac/playwright-tauri-mac.ts",
    "test:e2e:tauri-win": "playwright test --config=e2e-tauri/playwright-tauri.ts"
  }
}
```

`test:e2e:tauri` 自动按 `process.platform === 'darwin'` dispatch;开发者可显式指定 win/mac script。

> **注**:Mac 端虽然不用 Playwright + CDP,但 spec 文件仍然用 Playwright test runner(`test.describe/test/expect`),只是 fixture 不连 page,改提供 `deskfoxAppMac` 对象暴露 `proc / windowBounds / triggerCmdK / clickAt / takeScreenshot / readDocx` 等 macOS-flavor API。这样 Win/Mac 共用 `@playwright/test` 框架,只是底层桥不同。

### D. 文件树规划

```
packages/app/
├── e2e-tauri/                          # Win 端(已 done,2026-05-28)
│   ├── fixtures.ts                    # Playwright + CDP
│   ├── playwright-tauri.ts
│   ├── specs/
│   │   ├── smoke-cdp.spec.ts
│   │   └── md-to-word-real.spec.ts
│   └── README.md
└── e2e-tauri-mac/                      # 本 feat 新增
    ├── fixtures.ts                     # GUI 黑盒(osascript + cliclick)
    ├── playwright-tauri-mac.ts         # Playwright config(testDir=./specs)
    ├── helpers/                        # macOS 工具封装
    │   ├── cliclick.ts                 # spawn cliclick / 类型化
    │   ├── osascript.ts                # AppleScript 模板
    │   ├── screencapture.ts            # screencapture + sips 裁图
    │   └── window-bounds.ts            # AppleScript 查询 front window 位置
    ├── specs/
    │   ├── smoke-mac.spec.ts           # .app 启动 + 窗口可见 + screencapture
    │   └── md-to-word-real-mac.spec.ts # Cmd+K + 右键 + 导出 + 验 docx
    └── README.md                       # Mac 端 setup / 跑法 / 平台差异 + cliclick brew install 提示
```

## 改动规模

**Medium**(~700-900 行新增,1 处上游 packages/desktop 加 +5 行 env hook + 1 个 Tauri command):

| 文件 | 类型 | 估算行数 |
|---|---|---|
| `packages/app/e2e-tauri-mac/fixtures.ts` | 新 | ~200 |
| `packages/app/e2e-tauri-mac/playwright-tauri-mac.ts` | 新 | ~30 |
| `packages/app/e2e-tauri-mac/helpers/*.ts` (4 个) | 新 | ~250 |
| `packages/app/e2e-tauri-mac/specs/smoke-mac.spec.ts` | 新 | ~80 |
| `packages/app/e2e-tauri-mac/specs/md-to-word-real-mac.spec.ts` | 新 | ~150 |
| `packages/app/e2e-tauri-mac/README.md` | 新 | ~150 |
| `packages/desktop/src/index.tsx` saveDialog hook | 改 fork-only | +5 行 |
| `packages/desktop/src-tauri/src/lib.rs` 新 Tauri command `read_e2e_save_path_env` | 改 fork-only | +15 行 |
| `packages/app/package.json` script | 改 | +3 行 |
| 三文档 + INDEX + 改动日志 | 新 | ~400 |

净 **~1300 行**(其中代码 ~700-900 / 文档 ~400),触动上游文件 2 个(都是 fork-only 包),Medium 偏上,但不到 Large(Large 阈值 >500 行 或 触动 ≥5 上游文件)。

## 测试覆盖范围(R5 v4)

**本 feat 的产物本身就是测试代码**,测试覆盖范围 = `e2e-tauri-mac/specs/*.spec.ts`:
- `smoke-mac.spec.ts`:.app 启动链路 / 窗口可见 / screencapture 取屏 / hydrate 时序(对应 Win `smoke-cdp.spec.ts`)
- `md-to-word-real-mac.spec.ts`:完整 .md→.docx 端到端(对应 Win `md-to-word-real.spec.ts`)

**反向测试目标**:本 feat 完成后,改动 saveDialog 任何相关代码 / Tauri command 注入 env / .app 启动参数 / 项目路径 base64 编码 — 这些动作都应被 Mac e2e 抓到(类似 Win 端 catch 同类 bug)。

## 验收

- [ ] `bun run --cwd packages/app test:e2e:tauri-mac` 在 Mac 跑通(smoke-mac + md-to-word-real-mac 都 pass)
- [ ] `bun run --cwd packages/app test:e2e:tauri` 在 Mac 自动 dispatch 到 tauri-mac script
- [ ] 验证 docx 落盘 + word/document.xml 存在 + 段落 + 文本 run 正常(跟 Win 一致)
- [ ] 平台 hook 加 env 读取后,生产模式 `bun run --cwd packages/desktop tauri dev` / build .app 跑期间 saveDialog 仍弹真 native dialog(env 不存在 fall through 正确)
- [ ] 0 改 Win 端代码(`e2e-tauri/` 不动)
- [ ] 三文档(spec/plan/changelog)闭环 + INDEX + 改动日志.md 收尾
- [ ] typecheck + Phase 1 e2e 回归全绿

## Follow-up(留 backlog)

- **加更多场景**:导出 PDF / 文件树拖入 / 创作模式生成 Mac e2e
- **Win + Mac 共通 spec 抽象层**:把 90% 平台无关的断言抽出 `e2e-tauri-shared/`,各平台 fixture 实现
- **CI 接入**:GitHub Actions macos-latest runner 自动跑(投入大,先手动验证为主)
- **Linux 端**:同款 GUI 黑盒架构(xdotool + scrot)— 远期需求

## 相关 memory

- `reference_deskfox_gui_automation.md` — Mac GUI 自动化完整套路(本 feat 直接吃下)
- `feedback_dont_gui_test_in_user_workspace.md` — 不在 user 实例上跑 GUI 自动化(测试启动专用 .app,跟 user 长开的 prod / dev 区分)
- `feedback_kill_and_launch_test_app.md` — test fixture teardown 用 `pkill -9 -f "DeskFox Dev"` 精确匹配,不打 prod
- `feedback_no_bundle_pitfall.md` + `feedback_full_build_doesnt_update_app_binary.md` — Mac build .app 兜底 cp(测试前确认 .app 内 binary 最新)
