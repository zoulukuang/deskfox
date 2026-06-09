---
feat-id: file-tab-close-others
status: done
related: ./3-changelog.md
---

# 3-changelog — file-tab-close-others

> Small 规模(纯函数 + 组件右键菜单 + i18n + 单测),按规范只写 3-changelog.md。

## 背景 / 需求

文件预览区顶部的 tab 栏,只有单个 × 关闭。user 要:**tab 上右键 → "关闭其他标签"**(关掉除当前外所有已开 tab)。

## 现状机制(调研结论)

- tab 栏在 `session-side-panel.tsx:347`:`<For each={openedTabs()}>{(tab) => <SortableTab .../>}</For>`,关闭 API `tabs().close(tab)`。
- 文件 tab 组件 `session-sortable-tab.tsx` 原本**无右键菜单**(只有 × 和中键关闭)。
- **现成参照**:terminal tab(`session-sortable-terminal-tab.tsx`)已有完整右键菜单(`DropdownMenu` + `menuPosition` + `onContextMenu`),照搬即可。

## 修法

| 文件 | 改动 |
|---|---|
| `pages/session/helpers.ts` | 新增纯函数 `closeOtherTabs(tabs, keep, close)` — 遍历关掉除 keep 外所有 tab(顺序保留),便于单测 |
| `components/session/session-sortable-tab.tsx` | 加 `onCloseOthers?` prop + 右键菜单(照搬 terminal-tab 的 `DropdownMenu` 定位模式):`onContextMenu` 弹菜单,一项「关闭其他标签」→ 调 `onCloseOthers(props.tab)`;无回调时不弹(降级安全) |
| `pages/session/session-side-panel.tsx` | 给 `SortableTab` 传 `onCloseOthers={(keep) => closeOtherTabs(openedTabs(), keep, tabs().close)}` + import helper |
| `i18n/{en,zh,zht}.ts` | 加 `common.closeOtherTabs`(Close Other Tabs / 关闭其他标签 / 關閉其他標籤);其余 14 locale fallback en(completeness 测试只守 zh/zht) |

## 设计取舍

- **逻辑抽纯函数**:`closeOtherTabs` 与 UI 解耦,5 个单测覆盖(正常 / keep 重复不误关 / 单 tab no-op / 空列表 / keep 不存在则全关)。
- **照搬而非新造菜单**:复用 terminal-tab 已验证的 `DropdownMenu` 模式,体验/定位一致,0 新依赖。
- **本次只加「关闭其他标签」一项**(按 user 要求),菜单结构预留可扩(将来加「关闭」「关闭所有」只是多 `DropdownMenu.Item`)。

## 验证

- `closeOtherTabs` **5 新单测** + helpers 原测 + i18n completeness = **27 pass / 0 fail**(该两文件)。
- app 全量 **835 pass / 0 fail**(+5 新,0 回归);typecheck **16/16**。
- ⚠️ 右键菜单 GUI 弹出/点击由 dev 包真机验(View 层,e2e 门槛未生效)。

## 规模 / 影响

- **Small**:4 文件代码(1 helper + 1 组件 + 1 wire + 3 i18n 行)+ 1 test,净 ~70 行,全 fork-only / 加 FORK marker。
- **回退**:`git revert` 本 commit;恢复后 tab 仅剩单个 × 关闭。
- **0 改上游产品逻辑 / 0 R4 / 0 黑名单**。
