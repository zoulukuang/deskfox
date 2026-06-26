// FORK: REQ-068 — 启动自动加载默认项目目录的 pre-check 决策(纯函数,便于单测,不依赖 electron/solid)。
// 2026-06-25 [feat: stale-path-hardening]
import type { PathProbeResult } from "@/context/platform"

export type StartupProjectDecision =
  | { action: "open" }
  | { action: "skip"; forget: boolean; reason: "missing" | "unreachable" }

/**
 * 决定启动时是否进入 openProject(REQ-068)。
 *  - probe 为 undefined(非桌面端,无探测能力 / 探测自身出错)→ open(fail-open,维持原行为,不阻塞启动)
 *  - probe.ok → open
 *  - missing(目录确切不存在)→ skip + forget(清 lastProject → 下次启动不再自动加载死路径,UI 落到选择器)
 *  - unreachable(暂不可达:网络盘/U盘 offline)→ skip 但不 forget(保留 lastProject,提示重连后重试)
 *
 * 关键:绝不能让不存在/不可达的默认目录进入 openProject —— 否则首请求 session.list 静默返 200 空数组,
 * 用户只看到空白无报错无引导,触达 /file 才 500(见版本计划「迁移发现 §③」)。pre-check 是唯一可靠修法。
 */
export function decideStartupProject(probe: PathProbeResult | undefined): StartupProjectDecision {
  if (!probe || probe.ok) return { action: "open" }
  return { action: "skip", forget: probe.reason === "missing", reason: probe.reason }
}
