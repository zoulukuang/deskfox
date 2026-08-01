feat-id: renderer-snapshot-oom
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动记录

## commit

- `a350919844` fix(app/desktop): REQ-087 renderer 快照 OOM 治理四件套 [feat: renderer-snapshot-oom]

## 实际改动

| 文件 | 类型 | 内容 |
|---|---|---|
| `packages/app/src/utils/persist.ts` | 上游+FORK 标记 | 桌面 async 路径写盘 trailing-throttle(800ms)+ 体积熔断(16M chars)+ flush 钩子(pagehide / visibilitychange / deskfox-flush-before-close);removeItem 取消 pending;测试钩子入 PersistTesting |
| `packages/app/src/components/prompt-input/history.ts` | 上游+FORK 标记 | prependHistoryEntry 剥离 image part、纯图片 prompt 不入历史;normalizePromptHistoryEntry 防御性过滤;新增 migrateStoredHistory 存量清洗纯函数 |
| `packages/app/src/components/prompt-input.tsx` | 上游+FORK 标记 | 两个 history persisted() 挂 migrate(首启读取即清洗回写缩容) |
| `packages/desktop/src/main/deskfox/renderer-crash-guard.ts` | fork-only 新增 | 崩溃循环检测(120s 窗口第 2 次可数崩溃)+ 快照 .dat 隔离(rename .bak-<ts>)+ reload;handleRendererGone 入口 |
| `packages/desktop/src/main/index.ts` | 上游+FORK 标记 | render-process-gone 处 1 行接入 handleRendererGone(R1 二级,≤5 行) |
| `packages/app/src/utils/persist.test.ts` | 测试 | +4 节流/熔断用例 |
| `packages/app/src/components/prompt-input/history.test.ts` | 测试 | +5 剥离/迁移用例 |
| `packages/desktop/src/main/deskfox/renderer-crash-guard.test.ts` | fork-only 测试新增 | 6 用例(检测器窗口语义 / 文件族匹配 / 隔离改名) |

## 回归测试

- `packages/app` bun test:537 pass / 2 fail(`project-restore.test.ts` ×2,**main 干净树复跑同样失败 = 预存,与本改动无关**);
- persist.test.ts 18/18、history.test.ts 11/11、renderer-crash-guard.test.ts 6/6;
- app + desktop typecheck 0 错。

## 影响范围与回退

- 影响:桌面端所有 persisted store 的落盘时序(最长延迟 800ms,flush 兜底);历史回填不再带图片附件(行为变化,1-spec 已声明);连环崩时快照被隔离为 .bak(可手动改回恢复)。
- 回退:整笔 `git revert`(单 commit);或单独回退 persist.ts / history.ts 的 FORK 段。

## 遗留 / follow-up

- draft(单会话草稿)图片外置 deferred(2-plan 决策轨迹);
- 24h 长跑 heap 抽查、macOS 不再产 disk-writes .diag 需真机长期观察;
- 现网存量 global.dat 1.4MB 将在升级后首启自动缩容(migrate),无需人工。
