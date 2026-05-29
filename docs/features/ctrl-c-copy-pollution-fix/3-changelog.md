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
