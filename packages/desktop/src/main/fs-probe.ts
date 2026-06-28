// FORK: REQ-068 — 主进程路径存在性/可达性探测,供启动前 pre-check 默认项目目录。2026-06-25 [feat: stale-path-hardening]
// FORK: REQ-068 加固 — stat 加超时竞速,离线网络盘/UNC 上不再无限挂起阻塞启动(code-review 回归修复)。
// 2026-06-26 [feat: stale-path-hardening]
// FORK: REQ-068 加固 v2 — ENOENT/ENOTDIR 用盘符根可达性区分「目录真被删」vs「整盘/U盘/网络挂载离线」,
// 后者绝不 forget(修 code-review:可移动盘拔出/盘符未映射时合法项目被误永久遗忘)。2026-06-28 [feat: stale-path-hardening]
import { stat } from "node:fs/promises"
import path from "node:path"

// 生产端类型;IPC 线格式契约,必须与 renderer 端 packages/app/src/context/platform.tsx 的
// PathProbeResult 逐字段一致(两端 tsconfig 互相隔离、无 type import 边)。改形状须同步改两端。
export type PathProbeResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "unreachable"; code?: string }

/** stat 注入点,便于单测(默认 node fs/promises stat)。 */
export type StatFn = (target: string) => Promise<unknown>

/** 探测超时(ms)。离线网络盘/拔出 U 盘上 stat 可能挂起数十秒,超过即按 unreachable 兜底,绝不阻塞启动。 */
export const PROBE_TIMEOUT_MS = 3000

type StatOutcome = { kind: "ok" } | { kind: "err"; code?: string } | { kind: "timeout" }

/** stat 竞速超时(REQ-068 加固):离线盘 stat 可能挂起数十秒,超过 timeoutMs 按 timeout 兜底,绝不阻塞。 */
async function raceStatTimeout(target: string, statFn: StatFn, timeoutMs: number): Promise<StatOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
  })
  try {
    return await Promise.race<StatOutcome>([
      statFn(target).then(
        () => ({ kind: "ok" as const }),
        (err: NodeJS.ErrnoException | null) => ({ kind: "err" as const, code: err?.code }),
      ),
      timeout,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 探测一个本地目录路径是否可用,带超时(REQ-068 加固)。区分三类结果,供前端按模态给不同引导:
 *  - ok:          stat 成功。
 *  - missing:     目录确切不存在且**所在盘/挂载点可达**(健康盘上目录被删/改名,errno ENOENT/ENOTDIR
 *                 且盘符根 stat 成功)→ 前端清掉它作为 lastProject、落到项目选择器、提示重选路径。
 *  - unreachable: 路径可能仍有效但暂不可达(网络盘离线/U 盘忙,errno EACCES/EBUSY/ENXIO/EPERM…)、
 *                 **stat 超时**、**或 ENOENT/ENOTDIR 但连盘符根都不可达**(整盘/可移动盘/网络挂载离线:
 *                 U 盘拔出、盘符未映射、UNC 服务器离线 → 此时 target 其实有效、只是暂不可达)
 *                 → 前端保留 lastProject、提示「磁盘可能未连接/未映射,请重试」,**不清记录**。
 *
 * 关键一(超时):离线网络盘上 stat 不会快速报错,而会长时间挂起 → 用超时竞速兜底。
 * 关键二(根可达性,v2):ENOENT/ENOTDIR 有歧义 —— 既可能「目录真被删」(应 forget),也可能「整盘离线」时
 * 连中间挂载段/盘符根都报 ENOENT(USB 拔出 / 盘符未映射)。后者若也判 missing → forget 会**永久遗忘合法项目**
 * (用户重连盘后项目从最近列表消失)。故 ENOENT/ENOTDIR 时再探一次盘符根:根可达 → 确属 missing;
 * 根也不可达 → 整盘离线 → unreachable。**此处修订版本计划「迁移发现 §④」原「盘符未映射 = missing」的判定**
 * (code-review 命中:可移动盘拔出/未映射被误归 missing → 误 forget;非破坏性方向取 unreachable 更安全)。
 */
export async function probeWithStat(
  target: string,
  statFn: StatFn,
  timeoutMs: number = PROBE_TIMEOUT_MS,
  rootOf: (p: string) => string = (p) => path.parse(p).root,
): Promise<PathProbeResult> {
  const outcome = await raceStatTimeout(target, statFn, timeoutMs)
  if (outcome.kind === "timeout") return { ok: false, reason: "unreachable", code: "ETIMEDOUT" }
  if (outcome.kind === "ok") return { ok: true }
  if (outcome.code === "ENOENT" || outcome.code === "ENOTDIR") {
    const root = rootOf(target)
    // 盘符根存在且与 target 不同 → 探根:根不可达(整盘/U盘/网络挂载离线)则判 unreachable,绝不 forget
    if (root && root !== target) {
      const rootOutcome = await raceStatTimeout(root, statFn, timeoutMs)
      if (rootOutcome.kind !== "ok") return { ok: false, reason: "unreachable", code: outcome.code }
    }
    return { ok: false, reason: "missing", code: outcome.code }
  }
  return { ok: false, reason: "unreachable", code: outcome.code }
}

/** 用真实 node stat + 默认超时探测路径(生产入口)。 */
export function probePath(target: string): Promise<PathProbeResult> {
  return probeWithStat(target, stat)
}
