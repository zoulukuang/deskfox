---
feat-id: e2e-chat-loop
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# e2e-chat-loop — 3-changelog

> 接手 WIP commit `11ada4f02`(3 case fixme + mock helper 不通),修通 3 case + 完整三文档 + cleanup。

## commit 列表

| hash | message | 备注 |
|---|---|---|
| _待提交_ | `feat(e2e-chat-loop): 修通 3 case + 重写 chat-mock 路由 + SSE addInitScript [feat: e2e-chat-loop]` | 本笔主 commit |

## 改动文件

| 文件 | 行数变动 | 说明 |
|---|---|---|
| `packages/app/e2e/chat-loop.spec.ts` | -92 +X(净简化) | 3 case 从 fixme 改回 test;清理攻坚期调试 instrumentation;补 strict-mode `.first()`;C3 progress 断言改 `toBeVisible` 取代 isVisible probe |
| `packages/app/e2e/mocks/chat-mock.ts` | ~+70 净增 | 路由全改 RegExp 兜 query string;新增 per-project `/path` `/project` mock;SSE 重写为 `addInitScript` + `window.fetch` patch + `ReadableStream`;assistant mock 补 `parentID` 参数 + 完整 `tokens` / `cost` / `path` / `system` / `mode` shape;`pushEvents` 改 async |
| `docs/features/e2e-chat-loop/1-spec.md` | 新增 | 5 验收点 + 4 关键技术决策 + Logic/View 双清单分类 |
| `docs/features/e2e-chat-loop/2-plan.md` | 新增 | 6 步实施轨迹 + 5 条踩坑沉淀 |
| `docs/features/e2e-chat-loop/3-changelog.md` | 新增 | 本文档 |
| `docs/features/INDEX.md` | +1 行 | 加 `e2e-chat-loop / done` 索引 |
| `本仓 改动日志.md` | +1 行 | feat 索引指向 3-changelog.md |

## 影响范围

- **正面**:packages/app 聊天主链路有 e2e 守护;改 prompt-input / submit / session-turn / global-sync 任一处都会被这 3 case 抓到回归
- **没动源码**:0 行 packages/app/src 改动 — 纯测试基础设施
- **mock helper 可复用**:`mocks/chat-mock.ts` 后续 chat 相关 spec(followup / abort / retry)直接复用,不需复制粘贴路由

## 回归测试

```bash
bun run --cwd packages/app test:e2e -- chat-loop.spec.ts
```

预期:**3 passed**(~5 分钟,主要是 vite warmup + 3 个 page navigation 耗时)。

## 回退方法

无破坏性源码改动。如本笔出问题:

1. 把 3 个 case 改回 `test.fixme()`(不阻塞 push)
2. 或 `git revert <commit>` 完全回退

mock helper 改动是测试用、不影响 production,revert 0 副作用。

## 接通后续

- **下一步 chat 相关 e2e**:abort / retry / followup 三场景,各 ~150 行,可单独提 commit 接入
- **mock-foundation 的 bootstrap glob bug**(本笔在 chat-mock 局部修了 path / project,bootstrap 全局是否也要 regex 化?):留 backlog 观察,目前 mock-foundation 单独跑全过、不阻塞 chat-loop
