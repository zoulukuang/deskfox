---
feat-id: e2e-tauri-phase2-mac
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 2-plan — e2e Phase 2 Mac 实施计划

> spec 锁版后开干。本文档实时追加 note(踩坑 / 方案推翻),开发完成后 1-spec 不改、2-plan 补全、3-changelog 总览。

## 总目标

按 1-spec 7 项工作项实施,~3 天完工(单人 Claude + user 拍板节奏)。

## 阶段拆分

### 阶段 0:依赖检查(~10 min)

- [x] dev .app 已 build(`bundle/macos/DeskFox Dev.app` 已存在,version 1.14.33,2026-05-28 21:46)
- [ ] `cliclick` 已安装?`brew install cliclick`(memory `reference_deskfox_gui_automation.md` 已踩过坑)
- [ ] Playwright 已装(`packages/app/node_modules/@playwright/test`,Phase 1 mock e2e 共用)

### 阶段 1:helpers/ 工具封装(~0.5 天)

按"先底层后上层"顺序,helper 是 spec 的依赖。

#### 1.1 `helpers/osascript.ts`(~50 行)

封装 AppleScript 执行:
- `activateApp(appName)` → `tell app appName to activate`
- `keystrokeWithModifiers(key, modifiers[])` → `key code` + `using {command down, ...}`
- `clickMenuItem(appName, menuPath[])` → 点菜单栏 / 右键菜单
- `getWindowBounds(appName)` → 返 `{x, y, width, height}`(查 front window)
- `quitApp(appName)` → `tell app appName to quit` 优雅退出(fixture teardown)

底层 `execAsync('osascript -e ...')`(node:child_process.exec)。

#### 1.2 `helpers/cliclick.ts`(~40 行)

封装 cliclick 命令:
- `click(x, y)` → `cliclick c:x,y`
- `rightClick(x, y)` → `cliclick rc:x,y`
- `keyPress(key)` → `cliclick kp:return` / `kp:tab` 等
- `type(text)` → `cliclick t:text`(打字)
- `wait(ms)` → `cliclick w:ms`(可链式)

底层 `execAsync('cliclick ...')`。错误时输出"未装请 brew install cliclick"。

#### 1.3 `helpers/screencapture.ts`(~40 行)

- `takeFullScreen(savePath)` → `screencapture -x savePath`(-x 静默无快门声)
- `cropImage(srcPath, dstPath, x, y, w, h)` → `sips --cropToHeightWidth ... --cropOffset ...`(memory 套路)
- `windowAreaScreenshot(appName)` → 联动 getWindowBounds + takeFullScreen + cropImage,返窗口区域 .png

#### 1.4 `helpers/window-bounds.ts`(~30 行)

封装 `osascript -e 'tell app "System Events" to get position/size of front window'`,容错处理(权限拒绝 / app 未启动)。

#### 1.5 helpers/index.ts

re-export 上面 4 个 helper,fixture 单点 import。

#### 测试 helpers(短期 sanity)

写 1 个 `helpers/__tests__/osascript.test.ts` smoke,验 `activateApp("Finder")` 不报错 — 跑环境 sanity。

### 阶段 2:平台 hook + Tauri command(~0.3 天)

#### 2.1 加 Tauri command `read_e2e_save_path_env`(packages/desktop/src-tauri/src/lib.rs)

新增 ~15 行:
```rust
// FORK: E2E saveDialog mock 方案 ② — 测试态读 env 优先返,生产态 env 永远不设
// [feat: e2e-tauri-phase2-mac] 2026-05-28
#[tauri::command]
fn read_e2e_save_path_env() -> Option<String> {
    std::env::var("DESKFOX_E2E_SAVE_PATH").ok()
}
```

register 到 `invoke_handler`。

#### 2.2 platform hook 改造(packages/desktop/src/index.tsx)

saveFilePickerDialog 加 env 检查(+5 行 fork-only):
```ts
async saveFilePickerDialog(opts) {
  // FORK: E2E mock 注入点(方案 ② env var,Mac 不能用 Win 的 page.exposeFunction)
  // 生产环境 DESKFOX_E2E_SAVE_PATH 永远不设,fall through 不影响真 native dialog
  // [feat: e2e-tauri-phase2-mac] 2026-05-28
  try {
    const e2ePath = await invoke<string | null>("read_e2e_save_path_env")
    if (typeof e2ePath === "string" && e2ePath.length > 0) return e2ePath
  } catch {
    // ignore(Win 端如果没 register 也不报错,fall through)
  }
  // 既有 Win 端方案 ① 仍保留(Mac 不影响 Win 已生效路径)
  const e2eMock = (window as unknown as { __deskFoxE2eSavePath?: ... }).__deskFoxE2eSavePath
  if (typeof e2eMock === "function") {
    const mocked = await e2eMock(opts)
    if (typeof mocked === "string") return mocked
  }
  const result = await save({ title, defaultPath })
  return handleWslPicker(result)
}
```

#### 2.3 验证 hook(回归手段)

- 启动 dev .app 不带 env → 触发"导出为 Word" → 弹真 native save dialog ✓
- spawn dev .app 带 env=`/tmp/xxx.docx` → 触发同动作 → 不弹 dialog 直接写到 /tmp/xxx.docx ✓

(本笔 commit 前 user 手测验证一遍,不动主分支)

### 阶段 3:fixtures.ts 主体(~0.5 天)

`packages/app/e2e-tauri-mac/fixtures.ts` ~200 行:

```ts
import { spawn, type ChildProcess } from "node:child_process"
import { mkdirSync, existsSync, readFileSync } from "node:fs"
import { test as base } from "@playwright/test"
import { activateApp, getWindowBounds, quitApp } from "./helpers/osascript"

const DESKFOX_APP = "/Volumes/ExtSSD/opencode-fork/packages/desktop/src-tauri/target/release/bundle/macos/DeskFox Dev.app"
const DESKFOX_BIN = `${DESKFOX_APP}/Contents/MacOS/DeskFox`
const APP_NAME = "DeskFox Dev"  // matches CFBundleName

const E2E_PROJECT_DIR = "/Volumes/ExtSSD/opencode-fork"
const E2E_OUTPUT_DIR = "/tmp/deskfox-e2e"

type MacFixtures = {
  deskfoxAppMac: {
    proc: ChildProcess
    appName: string
    e2eSavePath: string
    windowBounds: () => Promise<{x: number, y: number, width: number, height: number}>
    activate: () => Promise<void>
    teardown: () => Promise<void>
  }
}

export const test = base.extend<MacFixtures>({
  deskfoxAppMac: async ({}, use) => {
    if (!existsSync(DESKFOX_BIN)) {
      throw new Error(`DeskFox Dev.app missing: ${DESKFOX_BIN} — run build-deskfox.sh -Env dev`)
    }
    mkdirSync(E2E_OUTPUT_DIR, { recursive: true })
    const e2eSavePath = `${E2E_OUTPUT_DIR}/mac-real-export-${Date.now()}.docx`

    // 1. spawn .app binary 带 env 注入
    const proc = spawn(DESKFOX_BIN, [], {
      env: {
        ...process.env,
        DESKFOX_E2E_SAVE_PATH: e2eSavePath,
      },
      stdio: "ignore",
      detached: false,
    })

    // 2. 等 .app launch ready(轮询 osascript 检测 process)
    await waitForAppLaunch(APP_NAME, 30_000)

    // 3. 项目 URL 注入 — 用 osascript 触发 Cmd+L(或 deeplink)?
    //    实际 base64 路径 router 是前端自管,Mac 端没法走 page.goto,改用 osascript 模拟 user 操作
    //    (打开项目对话框 → 输路径 → Enter)。具体在 specs 里按需触发,fixture 不强制注入
    //    (Win 端有 page.goto 优势,Mac 走 user-flow 兼容性更好)

    // 4. 拉前景(允许 user 看到 e2e 过程)
    await activateApp(APP_NAME)

    await use({
      proc,
      appName: APP_NAME,
      e2eSavePath,
      windowBounds: () => getWindowBounds(APP_NAME),
      activate: () => activateApp(APP_NAME),
      teardown: async () => {
        await quitApp(APP_NAME).catch(() => proc.kill("SIGKILL"))
        await new Promise((r) => setTimeout(r, 500))
      },
    })

    // auto teardown
    if (!proc.killed) proc.kill("SIGKILL")
    await new Promise((r) => setTimeout(r, 500))
  },
})

export { expect } from "@playwright/test"
```

要点:
- **不连 WebView debug**(没 page 对象 / 没 connectOverCDP)
- env 注入实施 saveDialog mock 方案 ②
- 项目 URL 注入留给 spec 处理(Mac 没 page.goto,改 user-flow 兼容)
- teardown 优先 `osascript quit`(优雅) → fallback SIGKILL

### 阶段 4:playwright-tauri-mac.ts config(~10 min)

```ts
import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,   // GUI 模拟必须串行(一个屏幕只有一个 front window)
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "./report" }]],
  timeout: 180_000,       // 3 min/case(.app 启动 + 模拟操作慢)
})
```

### 阶段 5:smoke-mac.spec.ts(~0.5 天)

最小可行 spec:
1. fixture spawn .app
2. waitForLaunch
3. activate to front
4. takeScreenshot 验非空白(file size > 50KB)
5. teardown

约 80 行,验链路通。

### 阶段 6:md-to-word-real-mac.spec.ts(~1 天)

按 user-flow 复刻 Win:
1. spawn .app(env saveDialog 注入)
2. 等 hydrate
3. **打开项目**:Cmd+O 或 user-flow(尚未确认,2-plan 中实测决定 — 注 1)
4. **打开 .md 文件**:Cmd+P / Cmd+K 命令面板 + 文件名 + Enter
5. **触发右键菜单**:在编辑器右键(cliclick rc:x,y)
6. **选「导出为 Word」**:cliclick + osascript 找菜单项位置
7. **wait dispatcher**:轮询 file `e2eSavePath` 出现(超时 30s)
8. **读 docx 验内容**:`yauzl` 或 `adm-zip` 解压 → `word/document.xml` 段落 / 文本 run 校验(同 Win 端断言)

注 1:**项目打开方式 Mac 没 page.goto**,要走 user flow(打开文件对话框 / 拖入 / Cmd+O)。实测决定哪条路径 — 阶段 5/6 实施时打开 .app 看实际命令面板/快捷键。

### 阶段 7:package.json + 平台 dispatch(~15 min)

```json
{
  "scripts": {
    "test:e2e:tauri": "node ./scripts/dispatch-tauri-e2e.mjs",
    "test:e2e:tauri-mac": "playwright test --config=e2e-tauri-mac/playwright-tauri-mac.ts",
    "test:e2e:tauri-win": "playwright test --config=e2e-tauri/playwright-tauri.ts"
  }
}
```

`packages/app/scripts/dispatch-tauri-e2e.mjs` ~10 行:
```js
import { execSync } from "node:child_process"
import { platform } from "node:process"
const script = platform === "darwin" ? "test:e2e:tauri-mac" : "test:e2e:tauri-win"
execSync(`bun run ${script}`, { stdio: "inherit" })
```

### 阶段 8:README.md(~0.3 天)

按 Win `e2e-tauri/README.md` 结构对齐 + 加 Mac 特殊段:
- **依赖**:`brew install cliclick` + dev .app 已 build
- **跑法**:`bun run --cwd packages/app test:e2e:tauri-mac`
- **平台差异表**(spec 复用)
- **已知坑**:权限 prompt(辅助功能 / 屏幕录制 / 自动化)— 首次跑要 user 在 System Settings 授权;cliclick 修饰键限制(memory `reference_deskfox_gui_automation.md` §8)
- **backlog**:Win+Mac 共通 spec 抽象 / Linux 端

### 阶段 9:真桌面端到端实测(~0.5 天)

- [ ] cliclick / osascript 权限授予(首次跑 user 手操授权)
- [ ] `bun run --cwd packages/app test:e2e:tauri-mac --grep smoke` 跑通
- [ ] `bun run --cwd packages/app test:e2e:tauri-mac --grep "MD → Word"` 跑通 + 验 docx
- [ ] `bun run --cwd packages/app test:e2e:tauri` Mac 自动 dispatch 验证

### 阶段 10:文档收尾 + 回归(~0.3 天)

- [ ] `3-changelog.md` 填实际 commit hash + 行数 + 影响范围 + 回归测试 + 回退方法
- [ ] `docs/features/INDEX.md` 加本 feat 行
- [ ] `改动日志.md` 索引表加本 feat 一行
- [ ] `bun run typecheck` 全绿
- [ ] `bun run --cwd packages/app test:e2e`(Phase 1 mock e2e) 13 pass 无回归
- [ ] **不 push**,等 user 拍板合 main

## 实施期间 note(实时追加)

> 此区开发中实时填,记踩坑 / 方案推翻 / 关键决策。spec 不改,plan 滚动更新。

### note-0(2026-05-28 启动)

阶段 0 检查待执行;1-spec 已锁;开干 helpers/。

(后续追加...)
