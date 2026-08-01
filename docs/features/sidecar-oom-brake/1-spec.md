feat-id: sidecar-oom-brake
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-049 sidecar OOM 四层防御 — L1 内存刹车 + L3 断连 UI(Electron 落点)

> 来源:OPENCODE-PLAN 需求计划/2026-08-02.md + 需求池/sidecar-OOM崩溃-四层防御加固.md。
> 证据:utility.log 看门狗 respawn ×7(7-24→7-30)+ 7-31 utility `abort()` dump。
> L0(用户侧规避)已落 imbot 指南;L2(看门狗)已于 2026-06-13 落地(sidecar-watchdog.ts)。
> 本 feat 补 L1/L3。需求池详情 doc 是 Tauri 时代方案,本 spec 按 Electron utilityProcess 模型重订落点。

## 关键前提变化(评估发现)

- sidecar = `utilityProcess.fork` 的 in-process Node(server.ts:63),**支持 `execArgv`** → L1 硬帽一行
  `--max-old-space-size` 即可,**不再需要动 packages/opencode 上游核心 / 无黑名单 override**;
- 主进程 watchdog 已有 `sidecar-watchdog` 状态广播,但通道名少 `deskfox:` 前缀 → renderer 端 preload 桥
  (订阅 `deskfox:<event>`)永远收不到 = 「无消费方」的根因之一,本次一并修正。

## 方案

| 层 | 措施 | 落点 |
|---|---|---|
| L1 硬帽 | fork 时 `execArgv: --max-old-space-size=3072`:撑爆快速 OOM → L2 看门狗秒级 respawn,不再拖垮整机 | `server.ts`(FORK 标记) |
| L1 软刹车 | sidecar 内 30s 采样 v8 heap,占用 ≥80% 上报主进程(120s 静默 + 70% 重武装),转发 renderer 提示 | fork-only `deskfox/memory-brake.ts` + `sidecar.ts` / `server.ts` / `index.ts` FORK 接线 |
| L3 断连 UI | renderer 消费 `deskfox:sidecar-watchdog`:restarting/ready/gave-up/memory-pressure → toast(纯函数决策) | fork-only `app/utils/sidecar-health.ts` + `components/sidecar-health-monitor.tsx`,app.tsx 1 行挂载 |
| L3 停止键 | abort 请求后台不可达时不再静默吞错,如实 toast;状态复位依赖既有「respawn + heal-interrupted 自愈」链路 | `submit.ts`(FORK 标记) |

**显式取舍**:「本地强制置 idle 超时」不做——与服务端推送状态打架,且 respawn+heal 链路已在 ~30s 内自动复位;「主动中止当前任务保进程」需动上游 session 调度,维持 OUT OF SCOPE(随 REQ-027 评审)。

## R8 测试用例清单

- [x] memory-brake:越 80% 阈值报一次,静默窗口内不重复(unit)
- [x] memory-brake:持续高压过静默窗口再报(unit)
- [x] memory-brake:回落 <70% 重武装,再越线立即报(unit)
- [x] memory-brake:limit=0 防御 no-op(unit)
- [x] sidecar-health:restarting→ready 报「恢复」;冷启动 ready 不弹(unit)
- [x] sidecar-health:gave-up 恒报错;memory-pressure 带用量明细(unit)
- [x] 运行时·native:execArgv 是否真生效(heap_size_limit≈3GB)无法单测 → e2e local 包实测 memory-pressure limitMB 值 / 冷启动健康检查兜底
- [ ] L1 压测(压 heap 到阈值观察刹车)→ 真机长跑抽查,🟡 不阻断合并

## 验收(对照需求计划门槛)

- L1 刹车真触发验证:软刹车判定逻辑 unit 全绿;真机压测抽查(🟡);
- 挂死→respawn 期间 UI 有断连提示:restarting toast 即时弹出(unit 决策 + e2e 冒烟)。
