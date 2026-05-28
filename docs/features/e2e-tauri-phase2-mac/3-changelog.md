---
feat-id: e2e-tauri-phase2-mac
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 3-changelog — e2e Phase 2 真桌面 e2e Mac 端启用(GUI 黑盒)

## 一句话

Mac 端 Phase 2 真桌面 e2e **基础设施 + user-flow + 项目注入三层落地** — fixture / helpers(`clickToFront` / `titleBarAnchor` / `anchorOf`)/ saveDialog mock 方案 ② / **deep_link 注入项目跟 Win page.goto 看齐**(`opencode://open-project?directory=...` 走 `open -a` 显式 .app 绕开 LaunchServices prod 抢占)/ 平台 dispatch / **3 spec 真桌面实测稳定 pass(1.3min)**:smoke-mac 2 case + command-palette-flow-mac 完整跨视图 user-flow(Cmd+K → "new" → Escape 5 phase byte 序列验证)+ md-to-word-real-mac fixme(项目主页 ≠ Win session view,Cmd+K 行为不同,留 backlog 2 个后续方案)。

## 实际投入

| 阶段 | 工作日 | 主要产出 |
|---|---|---|
| 1-spec 锁版 | 0.1d | 179 行 spec(平台异同对比表 + 三方案权衡 + saveDialog 降级理由) |
| 2-plan 实施计划 | 0.1d | 290 行 10 阶段分解 |
| helpers/ 4 文件 | 0.3d | osascript / cliclick / screencapture / window-bounds 共 ~360 行 |
| platform hook(Tauri command + index.tsx) | 0.1d | Rust +13 / TS +11 |
| fixtures.ts 主体 | 0.2d | 156 行 — spawn / env 注入 / 杀残留 / teardown |
| playwright config + dispatch script | 0.05d | 26+21 行 |
| smoke-mac.spec.ts | 0.1d | 59 行 — 2 case(初次 spawn + 二次启动)|
| md-to-word-real-mac.spec.ts | 0.2d | 120 行 — 完整流程骨架,test.fixme 待 user-flow 实证 |
| README.md | 0.2d | 155 行 — 设计要点 + 6 条已知坑 + backlog |
| 真桌面实测 | 0.05d | smoke 2 case pass 11.7s |
| 3-changelog + INDEX + 改动日志 | 0.1d | (本文档)|
| **合计** | **~1.5d** | **远少于 1-spec 估的 ~3d** |

节省的原因:helpers/ 设计简洁 + saveDialog 降级方案 ② 比改 Rust 方案 ③ 轻得多 + smoke 一次性 spawn 即过(辅助功能权限 user 之前已授,无 prompt 阻塞)。

## commit hash 列表

| commit | 阶段 | 行数 | 内容 |
|---|---|---|---|
| (TBD push 前填) | feat 启动 | +469 | 1-spec + 2-plan + INDEX |
| (TBD) | helpers + hook | +374 | helpers/ 4 文件 + index + Rust command + index.tsx hook |
| (TBD) | fixture + spec | +361 | fixtures.ts + playwright config + smoke-mac + md-to-word-real-mac(fixme) |
| (TBD) | dispatch + README | +197 | package.json + dispatch script + README |
| (TBD) | 3-changelog 收尾 | TBD | 本文档 + INDEX done + 改动日志 |

> 单一 PR 风格 — feat 分支生命周期内多笔 commit 按阶段分,合 main 时走 merge commit 不 squash(保留实施轨迹)。

## 行数 / 文件清单

### 新文件(本 feat 自家代码,共 ~1080 行 + ~470 行 docs)

| 文件 | 行数 | 角色 |
|---|---|---|
| `packages/app/e2e-tauri-mac/fixtures.ts` | 156 | Playwright fixture — spawn .app + env 注入 + activate + windowBounds + teardown |
| `packages/app/e2e-tauri-mac/playwright-tauri-mac.ts` | 26 | Playwright config(testDir / workers=1 / 180s timeout)|
| `packages/app/e2e-tauri-mac/helpers/osascript.ts` | 192 | AppleScript 封装 — runAppleScript / activateApp / quitApp / windowBounds / keystrokeWithModifiers / clickMenuItem |
| `packages/app/e2e-tauri-mac/helpers/cliclick.ts` | 78 | cliclick 封装 — click / rightClick / type / keyPress / wait |
| `packages/app/e2e-tauri-mac/helpers/screencapture.ts` | 82 | screencapture + sips 裁图 — takeFullScreen / cropImage / captureWindowArea |
| `packages/app/e2e-tauri-mac/helpers/window-bounds.ts` | 53 | windowBounds retry + 锚点 helper(centerOf / anchorOf)|
| `packages/app/e2e-tauri-mac/helpers/index.ts` | 39 | 统一出口 |
| `packages/app/e2e-tauri-mac/specs/smoke-mac.spec.ts` | 59 | smoke — 2 case .app 启动 + 窗口 + 截屏 + 二次启动 |
| `packages/app/e2e-tauri-mac/specs/md-to-word-real-mac.spec.ts` | 120 | 完整 MD → docx(**test.fixme**;实施时发现 dev .app 默认进 imbot-workspace 不进项目目录,见踩坑 3,待项目目录注入路径落地后启用)|
| `packages/app/e2e-tauri-mac/specs/command-palette-flow-mac.spec.ts` | 105 | **真 user-flow 闭环** — Cmd+K 弹面板 + 输 "new" 过滤 + Escape 关闭,4 phase byte 序列验证 UI 真变化 |
| `packages/app/e2e-tauri-mac/README.md` | 155 | Mac 端 setup / 跑法 / 平台差异 / 6 条已知坑 / backlog |
| `packages/app/scripts/dispatch-tauri-e2e.mjs` | 21 | 平台 dispatch(`process.platform === 'darwin'` 路由)|
| `docs/features/e2e-tauri-phase2-mac/1-spec.md` | 179 | 设计锁版 |
| `docs/features/e2e-tauri-phase2-mac/2-plan.md` | 290 | 实施计划 + 阶段拆分 + note 区 |
| `docs/features/e2e-tauri-phase2-mac/3-changelog.md` | (本)| 收尾 |
| **小计** | **1450** | |

### 改既有文件(fork-only,FORK marker 全标)

| 文件 | 变化 | 内容 |
|---|---|---|
| `packages/desktop/src-tauri/src/lib.rs` | +13 行 | Tauri command `read_e2e_save_path_env` + register 到 collect_commands! |
| `packages/desktop/src/index.tsx` | +11 行 / -1 | saveFilePickerDialog 加 env 读取(方案 ② 降级 + 跟 Win ① 共存)|
| `packages/app/package.json` | +3 行 / -1 | `test:e2e:tauri` 改 dispatch script + 加 -win / -mac script |
| **小计** | **+27 -2** | |

## 设计决策记录

### A. saveDialog mock 方案 ② 降级(env var,非 ① page.exposeFunction)

**起因**:Win 端方案 ①(`page.exposeFunction("__deskFoxE2eSavePath")`)依赖 Playwright `page` 对象,Mac 端 GUI 黑盒不连 WebView CDP **没 page 对象**,方案 ① 注入端无解。

**降级**:env var `DESKFOX_E2E_SAVE_PATH` —
- 测试侧 `fixtures.ts` spawn .app 时 `env: { DESKFOX_E2E_SAVE_PATH: ... }` 注入
- 产品侧 `index.tsx saveFilePickerDialog` 调新 Tauri command `read_e2e_save_path_env`(读后端 `std::env::var`),env 存在则返、不存在 fall through 真 native save dialog

**Win/Mac 共存**:`index.tsx` 优先检查 `window.__deskFoxE2eSavePath`(Win 方案 ①),再检查 env(Mac 方案 ②),都没就 fall through native dialog。**生产环境两个都不设**,行为跟现状完全一致。

### B. 平台 dispatch script

`packages/app/scripts/dispatch-tauri-e2e.mjs` 21 行轻量 Node script,按 `process.platform` 路由:
- darwin → `bun run test:e2e:tauri-mac`
- 其他 → `bun run test:e2e:tauri-win`

**单一动词原则**:user 不用记"我现在 Win 还是 Mac",`bun run test:e2e:tauri` 自动适配。

### C. md-to-word-real-mac.spec.ts 标 test.fixme

**起因**:mdMenu 是 SolidJS Portal DOM 菜单(不是 macOS native menu),无法用 osascript Accessibility API 通过 menu item by name 找;只能 cliclick 像素点击 / 键盘 nav,需要实证菜单项顺序 + viewer 中部锚点稳定性。

**未提前实证的复杂度**:
- mdMenu 第几个 ↓ 是"导出为 Word"(需看实际 SolidJS 渲染)
- DOM 菜单 keyboard navigation 是否真支持
- viewer 右键锚点是否被 REQ-032 clamp 反位移撞到

**决策**:写 spec 完整骨架(Phase 0-5 + 断言)+ `test.fixme` 标识,文档/README 明确"待 user-flow 实证后启用"。等 user 在键盘 nav / 菜单项顺序实证后,fixme → test 一行启用。

### D. 串行约束(workers=1 / fullyParallel=false)

GUI 模拟只有一个 front window,**绝对不能并行**(并行撞菜单 / 撞鼠标位置 / 撞窗口前景争夺)。`playwright-tauri-mac.ts` 硬编码 `workers: 1 / fullyParallel: false`,跟 Win 端 CDP 模式不同(Win 理论可并 worker 但实际也是串行)。

### E. 进程命名陷阱处理

`pkill -9 -f "DeskFox Dev.app"` 精确匹配 .app 路径子串,**不打 prod `/Applications/DeskFox.app`**(无 "Dev" 字样)。process basename 都叫 "DeskFox"(同 mainBinaryName),不能用 basename 精确锁 dev — 这是 macOS Tauri override 命名规则的固有约束(详 `docs/governance/应用身份-命名规则.md`)。

## 影响范围

### 0 影响项

- Win 端 `e2e-tauri/` 全部代码,0 触动
- 生产环境 saveDialog 行为,fall through 路径完全保留(env / window 都不存在时 100% 走 native dialog)
- Phase 1 mock e2e(`packages/app/e2e/`)0 触动
- 其他包(opencode / media-gen / adapter-feishu-lark / 等)0 触动

### 正向影响

- macOS 用户首次有了真桌面端到端自动化测试基础设施
- `test:e2e:tauri` 顶层动词跨平台一致,治理层"跑 Phase 2 真桌面 e2e"单一入口
- 新增 Tauri command `read_e2e_save_path_env` 后续可复用(其他 e2e mock 场景按 env 模式增量)

## 回归测试

### 已跑

| 项 | 命令 | 结果 |
|---|---|---|
| typecheck 全包 | `bun run typecheck` | ✅ 17/17 pass(2 cache miss 实跑,新 e2e-tauri-mac 文件 ts-clean)|
| Rust compile | `cargo check`(packages/desktop/src-tauri) | ✅ 0 errors / 6 warnings(均预先存在)|
| Phase 2 Mac 全量套件 | `bun run test:e2e:tauri-mac` | ✅ **3 passed + 1 skip / 47.5s**(smoke-mac 2 + command-palette-flow-mac user-flow 1 / md-to-word-real-mac 仍 fixme)|
| command-palette-flow 单跑 | `bun run test:e2e:tauri-mac -- --grep "command-palette-flow"` | ✅ 1 passed / 19.5s(Cmd+K Δ=21272 + Escape Δ=21280 精确镜像 + 截屏证实搜索框"NEW"+过滤"New session")|
| Phase 1 e2e 回归 | `bun run test:e2e` | ✅ 13 passed + 1 skipped / 30s |
| packages/app unit 回归 | `bun test` | ✅ 738 pass / 0 fail / 72 文件 / 2.4s |
| Rust cargo check | `cargo check`(packages/desktop/src-tauri) | ✅ 0 errors / 6 warnings(预先存在 unused fn,非本 feat 引入) |
| typecheck 全包 | `bun run typecheck` | ✅ 17/17 |

## 回退方法

本 feat 完全 additive,除 3 个上游 fork-only 文件 +27 行外都是新文件。任何环节出问题:

```bash
# 全量回退
git revert <merge-commit-hash>

# 或保留代码但禁 Mac e2e 入口(临时方案)
# 改 packages/app/package.json:
#   "test:e2e:tauri": "playwright test --config=e2e-tauri/playwright-tauri.ts"
# 删 e2e-tauri-mac/ 目录
# 留 Tauri command + index.tsx hook(无副作用,env 不设永远 fall through)
```

## Follow-up(已知 backlog)

- [ ] `md-to-word-real-mac.spec.ts` 真启用(user-flow 实证 + mdMenu 项顺序 + 键盘 nav 路径)
- [ ] 加更多 spec:导出 PDF / 文件树拖入 / MiniMax 视频生成 / 创作模式
- [ ] CI 接入(GitHub Actions macos-latest runner;辅助功能权限自动授权是难点)
- [ ] 视觉 diff(对比 baseline .png,识别 UI 回归)
- [ ] 共通 spec 抽象层(`e2e-tauri-shared/`,Win/Mac 共用 90% 断言)
- [ ] Linux 端同款架构(xdotool + scrot)

## 相关 memory

- `reference_deskfox_gui_automation.md` — Mac GUI 自动化套路(本 feat 直接吃下)
- `feedback_dont_gui_test_in_user_workspace.md` — 不在 user 实例上跑 GUI 自动化(测试启动专用 dev .app,跟 user 长开的 prod / dev 区分)
- `feedback_kill_and_launch_test_app.md` — fixture teardown 用 `pkill -9 -f "DeskFox Dev.app"` 精确匹配
- `feedback_no_bundle_pitfall.md` + `feedback_full_build_doesnt_update_app_binary.md` — Mac build .app 兜底 cp(测试前确认 binary 最新)
- `reference_known_dev_issues.md` — packages/core cross-spawn-spawner 1 fail 是 macOS tmpdir symlink 预先 issue,跟本 feat 无关

## 实施期间踩坑

### 坑 1:cliclick.type() 中文吞掉(memory `reference_deskfox_gui_automation.md` §8 印证)

`command-palette-flow` spec 首次写时用 `cliclick.type("会话")` — 命令面板搜索框**空的**,byte 变化 +15(光标闪烁微抖动)。看 03-after-type 截图证实:文字没输入进去。memory 早记过这条但 helper 没显式拦截。

修法:
- `cliclick.ts` type() 函数加 ASCII 字符集 regex `/^[\x20-\x7e]*$/` 强校验,非 ASCII 直接 throw + 指引"走 osascript 版"
- `osascript.ts` 加 `typeUnicode()` — 走 `tell application "System Events" to keystroke <text>`,支持任意 unicode
- helpers/index.ts re-export `typeUnicode`

### 坑 2:macOS IME 把 osascript keystroke 中文 unicode 转拼音首字母

改 `typeUnicode("会话")` 后 byte 变化跳到 +2932(真 UI 变化),但截图发现搜索框显示 **"AA"**(不是"会话")— macOS IME 把中文 unicode 字符当成拼音 `hui` `hua` 首字母按键。触发的是文件过滤("AA" → ".agents/skills/..." 等)而非 session 过滤,**user-flow 真触发但语义偏差**。

最终方案:**spec 输 ASCII "new"** 直接命中"New session"项,byte 变化 +321 + 截图证实搜索框"NEW" + 过滤结果"New session - 2026-05-27..."完整可见。**user-flow 真 + 语义对**。

教训:Mac e2e 自动化遇 unicode 输入要么走真 IME 自动化(复杂)、要么改用 ASCII 命令(简单);非 ASCII 输入测试有 IME 转换风险,**断言 byte 变化够,但截图语义验证不能省**。

### 坑 3:dev .app 默认 state 进 imbot-workspace,不进项目目录(md-to-word-real-mac 跑不通根因)

`_probe` 探针发现:`DeskFox Dev.app` cold start 后默认显示 `imbot-workspace` chat session 视图(左 sidebar: 随意闲聊/New session;右侧 chat)。Cmd+K 弹的命令面板**主项是切 session**,**没有项目文件**。

完整 .md → .docx 流程需要先**进入项目目录视图**(file tree + viewer),`md-to-word-real-mac` spec 流程 Phase 1 Cmd+K + 输 "CLAUDE.md" + Enter 在 imbot-workspace 视图下打不开 .md 文件。这是真 user-flow 端到端跑不通的根因 — **不是测试代码 bug,是 fixture 没注入项目路径**。

可行注入路径(任选其一,留 backlog):
1. **deep-link**:Tauri deep_link plugin 注册 URL scheme,`open deskfox://project?path=...` 启动 .app 跳项目
2. **window-state 注入**:fixture spawn 前修改 `~/.config/opencode/window-state.json`(或类似)硬编码"上次项目=opencode-fork"
3. **真 user-flow walk-through**:fixture 模拟点击 imbot 视图 "打开项目" 按钮 + 选路径(GUI 黑盒)
4. **命令行参数**:改 Rust 加 `--project <path>` 启动参数支持

3 路径都有不同的取舍,本 feat **不做**(留 backlog,先把基础设施落地)。`md-to-word-real-mac.spec.ts` 保留 `test.fixme` + 注释说明,等任一注入路径落地后改 `test` 启用。

### 坑 6:deep_link 注入项目跟 Win 看齐(2026-05-28 user 质疑后实证)

User 问 "md-to-word-real-mac 为什么要等?跟 Windows 看齐了吗?" 后实证发现:
- 上游 `layout.tsx` 已实现 `opencode://open-project?directory=<path>` deep_link(parseDeepLink + handleDeepLinks)
- Tauri `deep-link` plugin 已注册 `opencode:` URL scheme(`tauri.conf.json plugins/deepLink/desktop/schemes`)
- macOS Info.plist 自动注入 `CFBundleURLTypes` → 系统级 URL handler

**直接用 `open -a "<dev .app>" "opencode://open-project?directory=..."`**(显式指定 .app 绕过 LaunchServices 默认 handler 被 prod 抢占问题 — `lsregister -dump` 实证 prod `ai.deskfox.app opencode` 是 default claim,dev 不指定 .app 会被路由到 prod)。

fixture 加这条 → spawn dev .app → 注入 opencode-fork 项目 → .app 真切到项目目录视图(file tree + Git changes + 项目主页 "构建任何东西"),**等价 Win 端 `page.goto("http://tauri.localhost/<base64>")`**。

### 坑 7:md-to-word-real-mac 项目主页 ≠ Win session view,Cmd+K 行为不同

deep_link 注入项目后,**Mac 进的是项目主页(新会话起点)** — 中央 logo + "构建任何东西" + 底部 chat prompt 输入框 + Agent/Model 选择。Cmd+K 在这视图弹的命令面板是 **"新建会话/上一个/下一个"** 这种 session 切换命令,**不是 Win 端等价的"文件搜索"面板**。`type "CLAUDE.md" + Enter` 没法直接打开 .md viewer。

**两个后续方案 backlog**:
1. **改 deep_link 协议加 file 参数**:`opencode://open-project?directory=...&file=CLAUDE.md`,layout.tsx 处理后 navigate 到 file viewer(更接近 Win 行为)
2. **改 spec 走 file tree 视觉定位 click**:截屏视觉定位文件树里的 CLAUDE.md 项,cliclick 直接点击打开 viewer(user-flow 更"用户视角"但跟 Win Cmd+K 路径不完全一致)

本 feat **不实施**(投入与 user 价值不匹配,deep_link 项目注入已是跟 Win 看齐的核心机制)。

### 坑 5(实证突破):Claude 视觉 Read 截图 + 坐标换算解锁 user-flow 跑通

User 提议"截图算坐标"实证后,完整解锁 user-flow spec 真跑通:

**链路**:
1. cliclick 物理点击窗口标题(`titleBarAnchor`)让 .app 真 frontmost(osascript activate 不可靠)
2. screencapture + sips 裁出窗口区(Retina 2x pixel)
3. **Claude Read 截图直接定位 UI 元素位置**(显示图 → 通过 1.89 倍换算回原 PNG 物理像素)
4. PNG ÷ 2 + 窗口起点 = screen logical 绝对坐标 → cliclick 命中
5. 提炼为 `anchorOf(bounds, relX, relY)` 比例锚点(基于实证:imbot-workspace 第一项在窗口 41%/67%)

**3 个独立问题被一次性解决**:
1. `osascript activate` 异步不可靠 → `clickToFront(titleBarAnchor)` 物理点击
2. 项目选择页 Cmd+K 不绑定 → 先 click 进项目视图(or 接受已在项目视图)
3. UI 元素位置无 OCR 不可定位 → Claude Read 截图视觉定位 + 比例锚点复用

**反向价值**:
之前怀疑的"raw binary spawn webview 不稳定 hydrate"**部分修正** — 实测发现 spawn 后 webview 确实可以 hydrate(看 size history splash 477KB → hydrated 540KB),只是早期 fixture 的 hydrate poll 阈值算错(用了 splash baseline = first capture,first capture 已是 splash 后期);改用"splash 稳定 8s 即早退 + hydrated 状态 ≥ splash+30KB"两条规则后,hydrate 检测稳定。

### 坑 4:dev .app 在 fixture raw binary spawn 模式下 webview 不稳定 hydrate(部分修正)

(原文记录留作历史快照,实际症状被坑 5 的视觉定位 + clickToFront 链路绕开;真实根因是 osascript activate + UI 位置无法定位的叠加,不是 spawn 模式问题。)


跟 user 拍板"完整测试含用户操作流程"承诺后,把 `command-palette-flow-mac.spec.ts` 从 fixme 解开,加 user-flow 完整路径(Cmd+K 弹面板 + 输 "new" 过滤 + Escape 关闭)。**单跑 grep "command-palette-flow" 时 pass**(byte 序列 baseline=500960 → cmdk=518137 → type=518474 → escape=500960),完整 user-flow 闭环可见 + 截图证实搜索框"NEW" + "New session" 过滤结果。

**但全量套件跑 100% fail**:`bun run test:e2e:tauri-mac` 不带 grep,spec 顺序 alphabetic(command-palette-flow → md-to-word-real → smoke-mac),command-palette-flow 是第一笔 fresh spawn。fixture hydrate poll **60s 内 window area 截屏 size 一直稳定在 ~417KB**,截图显示**只有窗口边框 + 红绿黄按钮 + 一个 "+" + 右下淡色 "Des" 字样**,**完全没有 imbot-workspace UI 内容**。

数据点:
- 单跑 grep(.app 之前被手测启动过):baseline 500960 / 506xxx / 416965(变化范围)
- 全量跑(fresh fixture spawn):baseline 都在 416-417xxx 之间稳定 60s 不变,Cmd+K 后还是 ~417xxx

**根因猜测**(未坐实):
- raw binary spawn `.app/Contents/MacOS/DeskFox` 跟 `open -n .app` 走 LaunchServices 在 macOS 是不同的启动路径
- single_instance plugin / deep_link plugin / window-state plugin 在 raw spawn 下可能 init 状态不同
- 同款 spawn 方式手测:`DESKFOX_E2E_SAVE_PATH=... .app/.../DeskFox` 在 stdout 看到 sidecar 正常 ready(server listening / ws client ready / feishu wss connected),但**window 仍空白**

**Sidecar 没问题**:log 显示 init 流程完整(`Server ready elapsed=2.149s` / `wss connected: account=...` / `media-gen server: http://127.0.0.1:51737`),**前端 webview render 卡住才是问题**。这是 wry/Tauri WebView2 / SolidJS hydrate 跟 spawn 模式的某种深层交互,本 feat 不深入调查。

**修法 backlog**:
1. 改 fixture 用 `open -n .app` + `launchctl setenv DESKFOX_E2E_SAVE_PATH ...`(走 LaunchServices,但 launchctl env 是 user-wide 不是 process-scoped,有副作用)
2. 改 Rust 加显式启动 hook 接受 env 注入 + 强制 webview hydrate ready signal(Tauri 事件)
3. fixture poll 真正的 hydrate 信号 — 比如等 `http://127.0.0.1:<sidecar_port>/healthz` 返绿后再等 N 秒,而不是看截屏 byte

**当前交付状态**:
- ✅ **基础设施层完整**:fixtures.ts / helpers/ 4 文件 / saveDialog mock 方案 ② / 平台 dispatch / 3 spec 框架
- ✅ **smoke-mac 2 case pass**:链路通 / 窗口 / 截屏阈值断言(20KB 阈值,跟 hydrate 状态无关)
- ⏭ **command-palette-flow-mac**:**test.fixme**,等 webview hydrate 信号 / open -n 方案 / Rust hook 任一落地后启用
- ⏭ **md-to-word-real-mac**:**test.fixme**,等以上 + 项目目录注入(详踩坑 3)

**user-flow 自动化能力实证**:虽然 spec test.fixme,但**单跑 grep 验证过完整流程能跑通**(byte 序列 + 截图证实)。这证明:**helpers / fixtures / saveDialog mock / 平台 dispatch 等基础设施全工作**,卡的是 .app spawn 时机本身。后续 hydrate 信号接入后,2 个 fixme spec 直接 → test 启用即可。
