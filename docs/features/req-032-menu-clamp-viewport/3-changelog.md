---
feat-id: req-032-menu-clamp-viewport
status: done
related: ./3-changelog.md
---

# 3-changelog · REQ-032 选区菜单贴近窗口边沿被遮挡

## 现象

文件查看区选中文字右键的"选区加聊天"菜单/输入卡,按 raw click 坐标 `fixed` 定位,贴近窗口边沿时按钮溢出视口 —— 用户看不到也点不到。用户实报:**md 文件结尾右键,「取消/加入聊天」按钮被裁,只能 Ctrl+Enter 临时绕过**。bug 影响**上下左右四边沿**。

## 根因

两处**手写**菜单都绕开了 Kobalte,自己 `fixed + style={{ left: x, top: y }}`,**无任何视口边界保护**:

- `packages/app/src/utils/context-menu-host/host.tsx`(`ContextMenuHost`):聊天 + PDF/office 选区菜单
- `packages/app/src/pages/session/file-tabs.tsx`(`mdMenu`):MD/HTML/代码文件选区菜单(**用户命中的就是这个**)

每个文件里都有 menu/input 两种 Match,各一个 `<div fixed ... style={{ left, top }}>`,共 **4 个渲染点**。

需求池审计结论:其余右键菜单全走 Kobalte/相对定位(file-tree.tsx 文件树菜单、slash-popover、status-popover、文件评论下拉),自带 flip/shift 视口保护,**不受影响**。

## 修法

抽共享 helper `packages/app/src/utils/menu-position.ts`:

- **`clampMenuToViewport(input) → { left, top }`** 纯函数:水平右溢出→向左收 + clamp 左边;垂直下溢出→flip 到锚点上方 + clamp 上边;默认 8px margin。
- **`repositionMenu(el, x, y)`** glue:读 `el.getBoundingClientRect()` 真实宽高(input 卡 360px + textarea 多行变高,不能用常量)→ 调 clamp → 写回 `el.style.left/top` + 设 `visibility: visible`。

两处菜单各加 `let menuEl: HTMLDivElement` + `createEffect(menu())` + `queueMicrotask → repositionMenu`;两 Match div 各加 `ref={el => menuEl = el}` + 初帧 `visibility: "hidden"`(防闪)。

四个边沿统一覆盖(`menu/input` × `host.tsx/file-tabs.tsx` = 4 个渲染点共用一份 helper)。

## 改动文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/utils/menu-position.ts` | **新建** 纯函数 helper + glue,带详细注释 | +88 |
| `packages/app/src/utils/menu-position.test.ts` | **新建** 9 单测(4 边沿 + 右下角同时溢出 + flip 后再 clamp + 自定义 margin + 极端菜单大于视口) | +73 |
| `packages/app/src/utils/context-menu-host/host.tsx` | import + `let menuEl` + `createEffect` + 2 Match `ref/visibility:hidden` | +16 |
| `packages/app/src/pages/session/file-tabs.tsx` | 同上(`mdMenu` 版) | +14 |

净改动 ~190 行 / 4 文件 / 0 R4 / 0 上游侵入(全 fork-only 新文件 + fork 既有文件 marker'd 段)。

## 测试 / 验证

- 单测 `menu-position.test.ts`:9 个纯几何断言全过(完全在内 / 下溢 flip / flip 后 clamp 上 / 右溢 / 左 / 上 / 右下角同溢 / 自定义 margin / 菜单 > 视口)。Logic 清单 ≥ 80% 行覆盖达标(helper 纯函数 100%)。
- 全仓 typecheck:17/17。
- 全 app 单测:**738 pass / 0 fail**(本笔 +9 helper 测,无既有用例回归)。
- View 层验证(rect ≥ 0 / ≤ innerWH 断言):e2e 基础设施(Phase 1)未 ready,留 user 真桌面抽查(spec 标 🟢,四角附近右键测一遍即可)。

## 回退

`git revert` 本 commit 即可。helper 文件独立,删除不影响其他模块;两处接入点的 `ref + visibility` 是加法,移除即回原行为。

## 关联

- 需求池:`OPENCODE-PLAN/需求池/选区加聊天菜单-边沿遮挡.md`(spec 含两处手写菜单的精确定位 + 全仓审计结论 + helper 草案)
- 长期方案:随 `office-选中加聊天` v2 把两套选区菜单都迁到 Kobalte/floating 原语,从根上消除手写定位 —— 那时本 helper 可删。当前两套并存,本 fix 兜两处。

## 关键术语

选区菜单, 加聊天, 添加到聊天, 取消按钮, Ctrl+Enter, mdMenu, md-selection-menu, file-tabs.tsx, ContextMenuHost, context-menu-host/host.tsx, chat-selection-menu, fixed 定位, clientX, clientY, viewport 溢出, 视口边界, clamp, flip, 翻转, 上下左右四边沿, 底部不可见, 右侧溢出, getBoundingClientRect, innerWidth, innerHeight, 共享定位 helper, menu-position, repositionMenu, clampMenuToViewport
