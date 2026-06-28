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

const TOAST_KEYS = {
  missing: { titleKey: "project.path.missing.title", descKey: "project.path.missing.description" },
  unreachable: { titleKey: "project.path.unreachable.title", descKey: "project.path.unreachable.description" },
} as const

export type ProjectAvailability =
  | { available: true }
  | { available: false; forget: boolean; reason: "missing" | "unreachable"; titleKey: string; descKey: string }

/**
 * 探测 + 决策 + 给出 toast 文案 key 的薄封装(REQ-068 加固):供 layout autoselect 与 home 手动打开**复用同一道防呆**。
 * 之前 pre-check 只挂在 autoselect,首页最近列表手点死路径仍直接 projects.open → 白屏 + 首个 /file 500。
 *  - 探测 ok / 无探测能力 → available:true。
 *  - missing / unreachable → available:false + forget 标志 + 对应 toast key,由调用方做副作用(forget / toast)。
 */
export async function checkProjectAvailable(
  pathExists: ((target: string) => Promise<PathProbeResult>) | undefined,
  directory: string,
): Promise<ProjectAvailability> {
  const probe = pathExists ? await pathExists(directory).catch(() => undefined) : undefined
  const decision = decideStartupProject(probe)
  if (decision.action === "open") return { available: true }
  return { available: false, forget: decision.forget, reason: decision.reason, ...TOAST_KEYS[decision.reason] }
}

/**
 * 串行打开目录选择器多选的结果(REQ-068 加固):对每个目录**依次 await** openOne,杜绝并发触发。
 * 修 code-review 命中的回归 —— openProject 改异步后,多选循环 `for (const d of result) openProject(d)`
 * 未 await,N 个异步 openProject 同时在飞(各 await 最长 3s 路径探测后再 navigate),navigate 解析顺序
 * 不确定 → 最终落点不是用户预期的项目、死路径 toast 乱序。串行后:落点确定(最后一个成功 open 的项目)、
 * toast 按选择顺序、任一时刻最多 1 个探测在飞。openOne 自身负责探测/防呆/打开(如 home 的 openProject)。
 */
export async function openPickedDirectories(
  directories: string[],
  openOne: (directory: string) => Promise<void>,
): Promise<void> {
  for (const directory of directories) {
    await openOne(directory)
  }
}
