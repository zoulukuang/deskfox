feat-id: session-list-load-more-30
status: done
related: ./3-changelog.md

# 3-changelog — 会话列表「加载更多」每次 +30

> 规模:**Tiny**(2 行常量,1 文件)。commit:`(本笔 commit)`,分支 `feat/session-list-load-more-30`(基于 `feat/electron-replatform`)。

## 需求

user(2026-06-15):侧边栏会话列表点「加载更多」,每次新加载 **30 条**(原 +15)。

## 改动

| 文件 | 改动 |
|---|---|
| `packages/app/src/pages/layout/sidebar-workspace.tsx` | 两处 `loadMore` 的 `limit += 15` → `+= 30`(行 340 / 477,FORK marker 更新为 `[feat: session-list-load-more-30]`) |

两处分别对应不同列表上下文,统一步长。底层 `limit` store 机制不变,仅每次点击的增量从 15 改 30。

## 验证

- 全仓无残留 `+15` 步长;无测试断言旧值。
- typecheck 26/26 全过。
- 真机 QA 待 user(需重打 dev 包)。

## 回退

`git revert <本笔 hash>`(或两处 `30` 改回 `15`)。
