---
feat-id: ctrl-c-copy-pollution-fix
status: done
related: ./3-changelog.md
---

# 3-changelog · Ctrl+C 复制错内容 v2 — 跨区域污染 + pickBest 策略错配修复

## 现象

聊天区 / 文件查看器选中文字按 Ctrl+C,剪贴板里**不是当前选中文字**,而是 viewer 历史栈里"30s 内最长"的旧选区文本 — 即便用户已经重选了别的更短的文字、或彻底点空白处取消选区。

复现概率与操作顺序强相关。v1(2026-05-04 commit `6792320c2`)修了文件树快捷键抢 Ctrl+C 的问题,但同期 `file-tabs.tsx` 加的 capture-phase Ctrl+C 拦截器引入了新的复制错内容路径,v2 这次根治。

## 三个 bug-repro 场景

| 场景 | 复现 | 现状 |
|---|---|---|
| **A:viewer 内重选短覆盖长** | viewer 内先选长文本 → 再选短文本 → Ctrl+C | 剪贴板=长文本(错)→ 修后=短文本 |
| **B:跨区域选区污染** | viewer tab active → 切到聊天区选短文本 → Ctrl+C | 剪贴板=viewer 里的旧长文本(错)→ 修后=聊天区当前选区 |
| **C:取消选区后幽灵复制** | viewer 内选 → 点空白处取消 → 30s 内 Ctrl+C | 剪贴板=刚取消的文本(错)→ 修后=系统剪贴板不动(no-op) |

## 根因(4 漏洞叠加)

`file-tabs.tsx` 自家 capture-phase Ctrl+C 拦截器(2026-05-04 引入修 Pierre Shadow DOM Ctrl+C 失效 bug),逻辑链:

```
window-capture keydown  ← 优先(永远跑第一)
  ↓ pickBestRecentSelection() 挑 30s 内"最长"
  ↓ preventDefault + clipboard.writeText
```

漏洞:
1. **`onSelChange` 听 document** — 任何区域(聊天区 / 其他 tab)的选区都入 viewer 的 history 栈
2. **`pickBestRecentSelection` 挑"最长"** — 这个策略是为右键 selection-collapse 设计的(WebKit collapse 出的单词必然短),kbd Ctrl+C 没 collapse 问题,策略错配
3. **capture 阶段** — 比 v1 `use-file-tree-shortcuts.ts` 的 bubble 闸优先,v1 闸根本走不到
4. **不区分 light/shadow** — light DOM(md / 聊天)原本不需要这套 history 机制,被一并劫持

## 修法(R1 + R2)

抽 pure helper `packages/app/src/pages/session/file-tabs-ctrl-c.ts`:

```ts
isAnchorInsideViewer(anchorNode, viewerRoot) → boolean
  // light DOM:viewerRoot.contains(anchorEl)
  // Shadow DOM:anchor.getRootNode() → ShadowRoot.host → 再判 contains

decideCtrlCAction({ text, shadow, anchorNode, viewerRoot }) → CtrlCDecision
  // text 空 → "noop"        (解场景 C)
  // anchor 不在 viewer → "noop"  (解场景 B)
  // viewer 内 + light DOM → "native"  (让原生 Ctrl+C,解场景 A light 半边)
  // viewer 内 + shadow DOM → "shadow-intercept"  (handler 写当前选区文本,解场景 A shadow 半边)
```

**R1(`file-tabs.tsx` `onSelChange` 入栈闸)**:`isAnchorInsideViewer(sel.anchorNode, viewerRootRef)` 失败直接 return — history 只记本 `FileTabContent` 实例 viewer 内的选区,跨 tab + 跨区域天然隔离。

**R2(`file-tabs.tsx` capture-phase Ctrl+C handler)**:用 `readSelectionText(sel)` 拿当前 shadow-aware 选区(原本就是 v1 引入的工具,只是没在 kbd 路径用),交 `decideCtrlCAction` 决策:
- `noop` / `native` → 不 `preventDefault`,让浏览器原生 Ctrl+C 自己处理
- `shadow-intercept` → 唯一保留 preventDefault + writeText 的路径,因为原生看不到 shadow 选区

**关键决策(对 OPENCODE-PLAN spec 的进一步精简)**:spec 原案 R2 在 shadow DOM in viewer 时仍 fall back 到 `pickBestRecentSelection` history,这会导致**场景 A 的 shadow 半边**未解(用户在 shadow 内重选短文本仍命中旧长文本)。改用"当前选区直接写"思路:`readSelectionText` 走 `getComposedRanges({ shadowRoots })` / `ShadowRoot.getSelection` 两路径已能拿到 shadow 当前选区,history 兜底对 kbd 路径根本不需要(history 机制本来就是为右键 selection-collapse 设计)。`selectionHistory` + `pickBestRecentSelection` 保留给 `handleSelectionContextMenu`(右键)路径,不动。

**viewer 容器标识**:`<Tabs.Content>`(每个 `FileTabContent` 的 root)加 `data-component="file-viewer"` + `ref={(el: HTMLElement) => { viewerRootRef = el }}`。**实例 scope**(`viewerRootRef` 是 `let` 局部变量),不是全局 selector — 跨 tab 也互不污染。

## 改动文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/pages/session/file-tabs-ctrl-c.ts` | **新建** pure helper(`isAnchorInsideViewer` + `decideCtrlCAction`),带 spec 决策表注释 | +71 |
| `packages/app/src/pages/session/file-tabs-ctrl-c.test.ts` | **新建** 16 单测(8 scope + 8 decision,三场景 + shadow 回归 + light DOM 反例 + 防御性) | +175 |
| `packages/app/src/pages/session/file-tabs.tsx` | import + `viewerRootRef` + `data-component="file-viewer"` + `ref` + R1 闸 + R2 决策替换 + 注释更新 | +35 -15 |

净改动 ~266 行 / 3 文件 / 0 R4 / 0 上游侵入(新文件 + 既有文件 FORK-marker 段更新)。

## 测试 / 验证

- 单测 `file-tabs-ctrl-c.test.ts`:**16/16 pass**(Logic 清单 ≥80% 行覆盖,helper 纯函数 100%)
- 同目录其它单测:57 pass / 1 fail(`session-composer-state.test.ts` 是 pre-existing solid-js SSR 问题,memory `reference_known_dev_issues.md` 已记录,与本笔无关)
- 全仓 typecheck:**17/17 pass**
- Mac dev release build:`build-deskfox.sh -Env dev`(完整 build,raw + .app 同步刷新,40,515,088 bytes)产物路径:
  - raw binary: `packages/desktop/src-tauri/target/release/DeskFox`
  - .app(已自动 launch): `packages/desktop/src-tauri/target/release/bundle/macos/DeskFox Dev.app`
- View 层验证(由 user 真桌面抽测):三场景 A/B/C 手动复现一遍 confirm 剪贴板与当前选区一致;Pierre Shadow DOM 文件(代码 / HTML / PDF / office 预览)正向回归 — Ctrl+C 仍能正确拿到 shadow 内选区文本

## 回退

`git revert` 本 commit 即可。`file-tabs-ctrl-c.ts` + 测试是新文件,删除不影响其他模块;`file-tabs.tsx` 的改动是 FORK-marker 段内替换,git 回滚自动还原 v1 行为(pickBest history 路径)— 退到那个状态等于退回到本笔 fix 之前的 bug 状态,不会破坏其他模块。

## 关联

- 需求池 spec:`OPENCODE-PLAN/需求池/ctrl-c-复制失效.md`(v2 诊断完整版,含 4 漏洞静态定位 / 三场景确定性复现 / 三层 Ctrl+C 监听竞争图 / R1+R2+R3 工程量预估)
- v1 前序:commit `6792320c2` `fix(file-tree): 中性区 Ctrl+C 失效 — B 路径加文本选区闸 [feat: filetree-ctrlc-textsel-fix]`(`use-file-tree-shortcuts.ts:61-78` `hasTextSelectionOutsideFileTree()` 闸,修文件树快捷键抢 Ctrl+C)
- 不沾边路径(已审计):`chat-selection-menu.tsx`(只拦右键 `contextmenu`,聊天区 Ctrl+C 走原生)/ `terminal.tsx`(用 Ctrl+Shift+C 不冲突)/ `handleLightDomContextMenu`(右键 light DOM 已识别不走 history)
- 长期方向:`office-选中加聊天 v2` 把 shadow DOM 内容统一迁到 ContextMenuHost 后,`selectionHistory` + `pickBestRecentSelection` 整套机制(右键 collapse 解药)可视情况移除 — 当前先留着,本 fix 只解 kbd 路径

---

## Follow-up · 架构师视角 backlog 落地(2026-05-29 同分支续做)

主 fix 后 user 要求做架构师审视里点出的 3 个 backlog 项。**结论**:Item 1 + Item 2 做了,Item 3 显性 NACK。

### Item 1 ✅ 落地 — 单例 selection-bus
**问题**:每个 `FileTabContent` 实例自己挂 `document.addEventListener("selectionchange", ...)`,N tab = N listener。
**修法**:新建 `packages/app/src/pages/session/selection-bus.ts`:
- 模块级 singleton,`registerViewer(viewerRoot)` 返回 `{ history, destroy }`
- 0 注册时自动 detach 全局 listener,有注册才挂
- selectionchange first-match-wins 路由到 anchor 所在 viewer(viewer 互不嵌套)

### Item 2 ✅ 落地 — selection-history 独立 module
**问题**:`SelSnapshot` type / `selectionHistory` 数组 / `knownShadows` 集 / `readSelectionText` 三策略 / `pickBestRecentSelection` 全挤在 `file-tabs.tsx` 里(~125 行),职责不清。
**修法**:新建 `packages/app/src/pages/session/selection-history.ts`:
- `ViewerSelectionHistory` class(`push / pickBestRecent / readSelection / collectShadow* / size / clear`)
- `readSelectionWithShadows(sel, knownShadows)` export(三策略 shadow-aware,供测试 / Ctrl+C handler 复用)
- module 头部注释**严格界定唯一合法消费者**:`handleSelectionContextMenu` 对抗 macOS WebKit shadow collapse bug。其他路径**禁止扩散**(在头部白纸黑字写明)。

### Item 3 ❌ NACK — 不统一决策表
**审计发现**:右键路径已经天然按特性分流,没必要硬塞同一个 `decideCtrlCAction`-style 决策表:

| 路径 | 数据源 | 走 history? | 为什么 |
|---|---|---|---|
| `handleLightDomContextMenu`(.md 右键)| `window.getSelection()` | ❌ | light DOM 无 collapse bug,原生工作 |
| `handleSelectionContextMenu`(代码/HTML 右键)| `pickBestRecent()` history | ✅ | 对抗 macOS WebKit shadow collapse — **唯一合法 history 消费者** |
| `ContextMenuHost` / `DomSelectionProvider`(聊天 / PDF / office 右键)| `window.getSelection()` | ❌ | 自己 module,2026-05-24 重构后跟 file-tabs 解耦 |
| Ctrl+C kbd handler(R2 主 fix)| `readSelectionWithShadows` 当前选区 | ❌ | kbd 无 collapse 问题 |

三个右键路径**已经各自处理**,数据源根本不同。硬塞决策表只会增加抽象噪音 — 不做。

### file-tabs.tsx 净瘦身

| 段 | 改动 |
|---|---|
| import | +2 行(`registerViewer` + `type ViewerSelectionHistory`)|
| 顶部局部状态 | `let viewerHistory: ViewerSelectionHistory \| undefined` 替代 `selectionHistory[]/knownShadows/SEL_HISTORY_*` 三个常量 |
| FORK-BEGIN/END 块(macOS shadow 选区修复段)| **-125 行 → +16 行**(`onMount` 注册 / `onCleanup` 注销 / `handlePreContextCapture` 改委托)|
| `handleSelectionContextMenu` | `pickBestRecentSelection()` → `viewerHistory?.pickBestRecent()`;`readSelectionText` → `viewerHistory.readSelection` |
| Ctrl+C handler | `readSelectionText` → `viewerHistory.readSelection` |

### 新增改动文件 / 测试

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/pages/session/selection-history.ts` | **新建** `ViewerSelectionHistory` class + `readSelectionWithShadows` + 严格 module 头部注释 | +180 |
| `packages/app/src/pages/session/selection-bus.ts` | **新建** 单例 bus + `registerViewer` + `_resetBus`(测试用)| +100 |
| `packages/app/src/pages/session/selection-history.test.ts` | **新建** 12 单测(pickBest 语义 / shift / 30s 窗 / shadow 收集 / readSelection light path)| +175 |
| `packages/app/src/pages/session/selection-bus.test.ts` | **新建** 8 单测(注册生命周期 / 多 viewer 隔离 / 幂等 destroy)| +125 |
| `packages/app/src/pages/session/file-tabs.tsx` | 接入新 module,净减 ~110 行 | +28 -110 |

### 验证

- 新 module 单测:**20/20 pass**(history 12 + bus 8)
- 既有 ctrl-c-test:**16/16 pass**(0 回归)
- 同目录 session 套件:**77 pass / 1 fail**(pre-existing solid-js SSR,memory 已记录 `reference_known_dev_issues.md`,与本次无关)
- 全 app 套件:**780/0 pass / 0 fail**
- typecheck:17/17 pass
- Mac dev build:raw + DeskFox Dev.app(40,515,088 bytes)20:37 timestamp 同步刷新

### 健康指标

- 上游侵入率:**0 change**(纯 fork-only 新文件 + 既有 fork 文件内重构)
- R4 黑名单:**0 触动**
- 漂移 commit:1 笔
- 净行数:`file-tabs.tsx` -110 行 / 新文件 +580 行,本仓总行数 +470。R1 三级跳 ratio = 新增 580 / 改既有 138(28+110)= 4.2:1,健康
- 模块责任清晰:`selection-history.ts`(数据结构 + 算法)/ `selection-bus.ts`(派发)/ `file-tabs-ctrl-c.ts`(决策表)/ `file-tabs.tsx`(组件接入)

### Backlog 全 close

架构师视角"如果重做"清单 3 项 → 2 ✅ 落地 / 1 ❌ NACK(审计后发现是过度抽象,不做反而正确)。**`selectionHistory` 整套机制现在 1 个消费者**(`handleSelectionContextMenu`),职责清晰可单独 grep,future 删除 / 调整时一目了然。

---

## Follow-up 2 · REQ-032 visibility:hidden + el.focus() race 修复(2026-05-29 user 测试发现)

User 测试 dev .dmg(`9d7440cf6` post-refactor build)发现新 bug:**所有文件格式**(.md / 代码 / HTML / PDF / office / 聊天区)右键"添加到聊天窗口"后,**input mode 弹出框的 textarea 没自动 focus,焦点回到了底部主聊天输入框**。

### 根因 — 跟本 fix / refactor 无关,是 REQ-032 残留 bug

REQ-032(2026-05-28 commit `d944cabb4`)给两套手写菜单加了**初帧 `visibility: hidden` + repositionMenu microtask 才置 visible** 的防闪 pattern。但 textarea 自带的 `ref={(el) => queueMicrotask(() => el.focus())}` 在 Solid 渲染流水线上**比 repositionMenu microtask 早一拍**触发:

```
setMdMenu({mode:"input"}) → reactive flush:
  1. JSX render: input div 挂载(visibility:hidden) → textarea ref 触发 → queueMicrotask A (focus)
  2. createEffect repositionMenu 触发 → queueMicrotask B (visibility:visible)
微任务队列(FIFO): A → B
  A: textarea.focus() on visibility:hidden 父容器 → **浏览器 silent fail**(Chromium/WebKit 一致)
  B: visibility:visible → 已经太晚
```

Silent fail 之后 `document.activeElement` 没动,焦点保留在上一个有焦点的元素 — 典型场景:**上次 `submitMdSelection` / `submitToChat` 用 `focusChatInput()` 把焦点留在了底部主聊天框**。下次 user 再选→右键→添加到聊天,弹窗起来了但焦点还在底部主聊天框,user 必须手动点弹窗的 textarea 才能输入。

### 影响范围

两套手写菜单**全中招**(同一根因,User 也确认"在其他文件格式上也是同样的问题"):
- `file-tabs.tsx mdMenu`(.md light DOM + 代码/HTML Pierre shadow)
- `context-menu-host/host.tsx ContextMenuHost`(PDF / office / 聊天区)

### 修法

把 focus 从 textarea ref 抽出,改 `createEffect` + `requestAnimationFrame`:rAF 比所有 queueMicrotask 都晚一拍,等 repositionMenu 已把 visibility 置 visible 之后再 focus。

```ts
createEffect(() => {
  const m = mdMenu()  // 或 menu() (host.tsx)
  if (!m.open || m.mode !== "input") return
  requestAnimationFrame(() => {
    if (!menuEl) return
    const ta = menuEl.querySelector("textarea") as HTMLTextAreaElement | null
    ta?.focus()
  })
})
```

同时 textarea 上原 `ref={(el) => queueMicrotask(() => el.focus())}` 删除(改 doc-only 注释,说明 focus 已由上方 createEffect + rAF 接管),避免双路径 silent fail 之后困住焦点。

### 改动文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/pages/session/file-tabs.tsx` | 加 `createEffect + rAF` focus,删 textarea inline ref | +20 -2 |
| `packages/app/src/utils/context-menu-host/host.tsx` | 同款 fix,加 `createEffect + rAF` focus,删 textarea inline ref | +14 -2 |

净改动 ~30 行 / 2 文件 / 0 R4 / 0 上游侵入。

### 测试

- typecheck 17/17
- 全 app 单测 780/0 pass(0 回归)
- Unit 测层未加:这种 visibility + queueMicrotask + rAF race 行为 happy-dom 不完整模拟,unit 测会不稳定;**靠 user 真桌面验证 + bug-repro tag 标识**。**长期方向**:Phase 2 真桌面 e2e ready 后补一个 right-click + input mode 的端到端 case(目前基础设施在 backlog)

### user 验证 checklist

| 文件类型 | 操作 | 期望 |
|---|---|---|
| `.md` / 代码 / HTML | 选文字 → 右键 → 添加到聊天窗口 | 弹窗 textarea 自动获得焦点,光标在 textarea 里,可立即输入 |
| PDF / office | 同上 | 同上 |
| 聊天区某条消息 | 选文字 → 右键 → 添加到聊天 | 同上 |
| 连续两次"添加到聊天" | 第一次 submit 后再选 → 右键 → 添加 | 第二次弹窗仍正确 focus 到弹窗 textarea(不再被上次 focusChatInput 留下的主聊天框 focus 捕获)|

### 教训

REQ-032 引入 `visibility:hidden` 防闪 pattern 时,没考虑现有 `ref={queueMicrotask focus}` pattern 的执行时机 — 两个 microtask 在同一个 batch flush 里,JSX mount 比 createEffect 早一拍,导致 silent fail 之后焦点丢失。

类似 race 防线:**任何依赖元素 visible 才能正确执行的副作用,必须用 rAF**(比所有 queueMicrotask 晚)**或在同一个 createEffect 里 sequential** (先设 visibility:visible 再做副作用)。queueMicrotask 链不可靠(后注册的 microtask 不一定比早注册的晚)。
