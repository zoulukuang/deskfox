feat-id: sidecar-oom-brake
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 步骤

1. fork-only `deskfox/memory-brake.ts`:采样判定纯逻辑(80% 触发 / 120s 静默 / 70% 重武装);
2. `sidecar.ts`:ready 后 30s 周期采样(timer.unref 不阻退出),事件走 parentPort;
3. `server.ts`:`execArgv --max-old-space-size=3072` + SidecarMessage 加 memory-pressure + 常驻 message 转发 `onMemoryPressure`;
4. `index.ts`:首次 spawn 与 respawn 统一用 spawnOptions(原首次 spawn 是内联重复对象,顺手收敛)+ onMemoryPressure 转发 + **watchdog emit 通道修为 `deskfox:sidecar-watchdog`、payload 统一 `{ status }` 对象**;
5. renderer:`sidecar-health.ts` 纯函数决策 + `sidecar-health-monitor.tsx` 订阅壳,AppShellProviders 挂载;
6. `submit.ts`:abort 不可达时 toast(复用 isBackendUnreachableError)。

## 决策轨迹

- **硬帽 3072MB**:现网 utility abort 在默认堆限(~4GB)附近;3GB 留 1GB 系统余量,且与软刹车 80%(≈2.4GB)拉开预警窗口。数值集中在 `SIDECAR_MAX_OLD_SPACE_MB` 一处,后续可调。
- **watchdog emit 通道原为裸 `sidecar-watchdog`**,preload 桥只订阅 `deskfox:` 前缀 → 历史上 renderer 收不到任何看门狗事件。修通道而非改 preload(preload 契约面更广,改它影响所有事件)。
- **停止键不做本地强置 idle**:busy 状态是服务端推送语义,本地强置会在 respawn 后与真实状态冲突;既有 heal-interrupted(2026-06-06)在 respawn 后自动复位残骸状态,补「不可达即时反馈」即闭环。
- **全屏重连页不做**:watchdog 正常 respawn 周期 ~15-20s,全屏 gate 误伤大于收益;toast + 自动恢复提示足够。计划文档「复用 ConnectionError 全屏页」按此降档,记入 changelog 供复核。
