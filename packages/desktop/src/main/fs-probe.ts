// FORK: REQ-068 — 主进程路径存在性/可达性探测,供启动前 pre-check 默认项目目录。2026-06-25 [feat: stale-path-hardening]
// FORK: REQ-068 加固 — stat 加超时竞速,离线网络盘/UNC 上不再无限挂起阻塞启动(code-review 回归修复)。
// 2026-06-26 [feat: stale-path-hardening]
// FORK: REQ-068 加固 v2 — ENOENT/ENOTDIR 用盘符根可达性区分「目录真被删」vs「整盘/U盘/网络挂载离线」,
// 后者绝不 forget(修 code-review:可移动盘拔出/盘符未映射时合法项目被误永久遗忘)。2026-06-28 [feat: stale-path-hardening]
import { stat, readdir, readFile } from "node:fs/promises"
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
// FORK: REQ-070 物理盘 QA 实测修复 — macOS 外置/网络盘挂载根探测 2026-07-06
// [feat: project-continuity-v2026-8-4]
// 真机实测(diskutil unmount /Volumes/WININSTALL):卸载后 `stat(/Volumes/<盘>/项目)` 报 ENOENT,而 v2
// 的根可达判据默认用 `path.parse(p).root` —— 在 macOS 上恒为 `/`(文件系统根,永远可达)→ 探根必 ok →
// 误判 missing → **forget 掉合法项目**(拔 U 盘后项目从最近列表消失)。Windows 的 `D:\盘符` 正确、mac 失效。
// 修法:mac 下取真正的挂载点 `/Volumes/<name>`(拔盘后该目录随卷消失 → 探它不可达 → 正确判 unreachable);
// Windows/其它路径回落 path.parse().root,行为完全不变(regex 不匹配非 /Volumes 路径,且仅 darwin 生效)。
export function mountRootOf(target: string): string {
  if (process.platform === "darwin") {
    const m = /^(\/Volumes\/[^/]+)(?:\/|$)/.exec(target)
    if (m) return m[1]
  }
  return path.parse(target).root
}

export async function probeWithStat(
  target: string,
  statFn: StatFn,
  timeoutMs: number = PROBE_TIMEOUT_MS,
  rootOf: (p: string) => string = mountRootOf,
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

// FORK: REQ-072 改名 relocate — 项目文件夹改名/挪位后,前端 server.projects 里旧路径 stale(打不开
//   + 反复 503)。已知旧路径 + 该项目 id(前端持久化 StoredProject.id),扫旧路径**同父目录**的兄弟,
//   读各自 .deskfox/id 锚,命中同 id 者即改名后的新位置。纯 fs、不依赖后端/git —— flag on 后
//   fromDirectory 对 git+非git 项目都写锚(project.ts writeAnchor),故两类都可锚扫描命中。
//   只覆盖「同父目录内改名/原地挪」(用户最常见);跨父目录挪出去不在此(需 Open Folder 重开)。 2026-07-05
// 锚契约(与 core/project/anchor.ts ANCHOR_DIR/ANCHOR_FILE 一致,主进程无 core type import 边故硬编码)
const ANCHOR_REL = path.join(".deskfox", "id")

export type ListDirsFn = (dir: string) => Promise<string[]>
export type ReadAnchorFn = (candidateDir: string) => Promise<string | undefined>

/** 锚扫描核心(注入 fs 便于单测)。返回改名后的新目录绝对路径,或 null(没找到/id 空)。 */
export async function findRelocatedWithFs(
  missingDir: string,
  id: string,
  listDirs: ListDirsFn,
  readAnchor: ReadAnchorFn,
): Promise<string | null> {
  if (!id) return null
  const parent = path.dirname(missingDir)
  const missingBase = path.basename(missingDir)
  let names: string[]
  try {
    names = await listDirs(parent)
  } catch {
    return null
  }
  for (const name of names) {
    if (name === missingBase) continue // 旧目录本身(理论已不存在)
    const candidate = path.join(parent, name)
    const anchorId = await readAnchor(candidate)
    if (anchorId && anchorId === id) return candidate
  }
  return null
}

/** 生产入口:真实 node fs 扫兄弟目录 .deskfox/id。 */
export function findRelocatedProject(missingDir: string, id: string): Promise<string | null> {
  const listDirs: ListDirsFn = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  }
  const readAnchor: ReadAnchorFn = async (candidateDir) => {
    try {
      return (await readFile(path.join(candidateDir, ANCHOR_REL), "utf8")).trim() || undefined
    } catch {
      return undefined
    }
  }
  return findRelocatedWithFs(missingDir, id, listDirs, readAnchor)
}
