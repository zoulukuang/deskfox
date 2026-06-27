// FORK: REQ-068 — 主进程路径存在性/可达性探测,供启动前 pre-check 默认项目目录。2026-06-25 [feat: stale-path-hardening]
// FORK: REQ-068 加固 — stat 加超时竞速,离线网络盘/UNC 上不再无限挂起阻塞启动(code-review 回归修复)。
// 2026-06-26 [feat: stale-path-hardening]
import { stat } from "node:fs/promises"

// 生产端类型;IPC 线格式契约,必须与 renderer 端 packages/app/src/context/platform.tsx 的
// PathProbeResult 逐字段一致(两端 tsconfig 互相隔离、无 type import 边)。改形状须同步改两端。
export type PathProbeResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "unreachable"; code?: string }

/** stat 注入点,便于单测(默认 node fs/promises stat)。 */
export type StatFn = (target: string) => Promise<unknown>

/** 探测超时(ms)。离线网络盘/拔出 U 盘上 stat 可能挂起数十秒,超过即按 unreachable 兜底,绝不阻塞启动。 */
export const PROBE_TIMEOUT_MS = 3000

/**
 * 探测一个本地目录路径是否可用,带超时(REQ-068 加固)。区分三类结果,供前端按模态给不同引导:
 *  - ok:          stat 成功。
 *  - missing:     目录确切不存在(被删/改名/盘符未映射/U 盘拔出后盘符消失,errno ENOENT/ENOTDIR)
 *                 → 前端清掉它作为 lastProject、落到项目选择器、提示重选路径。
 *  - unreachable: 路径可能仍有效但暂不可达(网络盘离线/U 盘忙,errno EACCES/EBUSY/ENXIO/EPERM…)
 *                 **或 stat 超时** → 前端保留 lastProject、提示「磁盘可能未连接/未映射,请重试」,不清记录。
 *
 * 关键:离线网络盘/拔出 U 盘上 stat 不会快速报错,而会长时间挂起(直到 OS 超时)→ 启动 auto-select
 * 卡白屏、既不进项目也不弹提示。用超时竞速兜底:超过 timeoutMs 未返回即按 unreachable 处理。
 * 注:Windows 各失败模态的确切 errno 需真机分模态确认(见版本计划「迁移发现 §④」);此处按
 * 「ENOENT/ENOTDIR = 确切不存在,其它 / 超时 = 暂不可达」兜底分类,真机结果可据此微调。
 */
export async function probeWithStat(
  target: string,
  statFn: StatFn,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<PathProbeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
  })
  try {
    const outcome = await Promise.race([
      statFn(target).then(
        () => ({ kind: "ok" as const }),
        (err: NodeJS.ErrnoException | null) => ({ kind: "err" as const, code: err?.code }),
      ),
      timeout,
    ])
    if (outcome.kind === "timeout") return { ok: false, reason: "unreachable", code: "ETIMEDOUT" }
    if (outcome.kind === "ok") return { ok: true }
    if (outcome.code === "ENOENT" || outcome.code === "ENOTDIR")
      return { ok: false, reason: "missing", code: outcome.code }
    return { ok: false, reason: "unreachable", code: outcome.code }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 用真实 node stat + 默认超时探测路径(生产入口)。 */
export function probePath(target: string): Promise<PathProbeResult> {
  return probeWithStat(target, stat)
}
