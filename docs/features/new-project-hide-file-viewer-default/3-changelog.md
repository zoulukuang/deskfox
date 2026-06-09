---
feat-id: new-project-hide-file-viewer-default
status: done
related: ./3-changelog.md
---

# 3-changelog — new-project-hide-file-viewer-default

> Tiny 规模(1 effect ~6 行),按规范只写 3-changelog.md。

## 背景 / 需求

打开项目时右侧**内容预览器**(reviewPanel)默认就展开着(哪怕还没点任何文件,占一块空预览区)。
user 要:**每次打开/重开项目默认收起预览器,点文件才展开**;左侧文件树列表保留。

## 现状机制(调研结论)

- 预览器开关 = `view().reviewPanel.opened()`,底层 `store.review.panelOpened ?? true`(`layout.tsx:735`)—— **全局持久化单例**,默认 `true`。
- **点文件展开链路已现成**:`createOpenSessionFileTab → openReviewPanel()`(`session-side-panel.tsx:136`),再点同文件还会 `closeViewer` 收起。
- `session.tsx` 是常驻组件(`on(() => params.id)` 响应切会话,不 remount);项目目录信号是 `sdk.directory`,切项目时 `directory-layout` 层才重挂。

所以这半边("点文件才打开")不用动,唯一问题是默认展开。

## 修法

`packages/app/src/pages/session.tsx` 加一个 effect,监听项目目录变化主动收起预览器:

```ts
createEffect(on(() => sdk.directory, () => view().reviewPanel.close()))
```

| 场景 | `sdk.directory` | 行为 |
|---|---|---|
| 打开项目 / app 启动恢复项目 | 设值 → effect 首跑 | 收起 ✅ |
| 点文件 | — | 现成链路展开 ✅ |
| 同项目内切会话 | 不变 → 不触发 | 保持当前状态(不算"重新打开") ✅ |
| 切到/重开另一个项目 | 变化 → 触发 | 收起 ✅(关掉再打开当新项目) |

## 设计取舍

- **只 close 不改默认值**:不动 `?? true` 全局默认(改默认值只影响新装用户,且点文件持久化后又会展开,语义不完整);用 directory 监听 reset 才满足"每次打开项目都默认关"。
- **文件树、点文件链路、持久化结构都不动**,最小侵入。

## 验证

- monorepo typecheck **16/16**;app 全量 **835 pass / 0 fail**(0 回归)。
- ⚠️ effect wiring 属集成行为(View 层),GUI 由 dev 包真机验:打开项目无预览区 → 点文件展开 → 关项目重开仍无预览区。R5 Tiny(<50 行)豁免强制单测。

## 规模 / 影响

- **Tiny**:1 文件(`session.tsx`)~6 行(含注释),fork-only effect + FORK marker。
- **回退**:`git revert` 本 commit;恢复后预览器回到"打开项目即展开"。
- **0 改上游产品逻辑 / 0 R4 / 0 黑名单**。
