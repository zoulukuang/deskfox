feat-id: sidecar-oom-brake
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动记录

## commit

- `fe784b7cd3` fix(desktop/app): REQ-049 sidecar OOM L1 内存刹车 + L3 断连提示 [feat: sidecar-oom-brake]

## 实际改动

| 文件 | 类型 | 内容 |
|---|---|---|
| `packages/desktop/src/main/deskfox/memory-brake.ts` | fork-only 新增 | 软刹车采样判定纯逻辑(80%/120s 静默/70% 重武装) |
| `packages/desktop/src/main/sidecar.ts` | 上游+FORK | ready 后 30s heap 采样,memory-pressure 走 parentPort |
| `packages/desktop/src/main/server.ts` | 上游+FORK | `execArgv --max-old-space-size=3072` 硬帽;SidecarMessage 扩 memory-pressure;常驻转发 onMemoryPressure |
| `packages/desktop/src/main/index.ts` | 上游+FORK | 首次 spawn/respawn 统一 spawnOptions + 内存压力转发;**watchdog emit 通道修为 `deskfox:sidecar-watchdog`(原裸通道 renderer 收不到)**,payload 统一对象 |
| `packages/app/src/utils/sidecar-health.ts` | fork-only 新增 | 看门狗事件 → toast 决策纯函数 |
| `packages/app/src/components/sidecar-health-monitor.tsx` | fork-only 新增 | 订阅壳组件 |
| `packages/app/src/app.tsx` | 上游+FORK | AppShellProviders 挂载监控组件(1 行) |
| `packages/app/src/components/prompt-input/submit.ts` | 上游+FORK | abort 后台不可达不再静默吞错,toast 提示自愈中 |
| 测试 | fork-only | memory-brake.test.ts ×4 / sidecar-health.test.ts ×5 |

## 回归测试

- desktop bun test 150 pass / 0 fail;app sidecar-health 5/5;app + desktop typecheck 0 错;
- app 全量与批次其他分支合并后统一复跑(见端到端测试记录)。

## 影响范围与回退

- 影响:sidecar 进程 V8 老生代上限 3GB(此前默认 ~4GB);watchdog 事件通道名变更(此前无消费方,零兼容风险);停止键失败路径新增 toast。
- 回退:整笔 `git revert`;或仅删 server.ts execArgv 行恢复默认堆限。

## 遗留 / follow-up

- 真机压测(压 heap 至阈值观察软刹车/硬帽行为)待 local 包长跑抽查;
- 「主动中止当前任务保进程」维持 OUT OF SCOPE,随 REQ-027 架构评审;
- 全屏重连页按 2-plan 决策降档为 toast,如实场景反馈不足再升级。
