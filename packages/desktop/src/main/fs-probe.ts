// FORK: REQ-068 — 主进程路径存在性/可达性探测,供启动前 pre-check 默认项目目录。2026-06-25 [feat: stale-path-hardening]
import { stat } from "node:fs/promises"

export type PathProbeResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "unreachable"; code?: string }

/**
 * 探测一个本地目录路径是否可用。区分两类失败,供前端按模态给不同引导(REQ-068):
 *  - missing:    目录确切不存在(被删/改名/盘符未映射/U 盘拔出后盘符消失,errno ENOENT/ENOTDIR)
 *                → 前端清掉它作为 lastProject、落到项目选择器、提示重选路径。
 *  - unreachable:路径可能仍有效但暂不可达(网络盘离线/U 盘忙,errno EACCES/EBUSY/ENXIO/ETIMEDOUT/EPERM…)
 *                → 前端保留 lastProject、提示「磁盘可能未连接/未映射,请重试」,不清记录。
 * 注:Windows 各失败模态的确切 errno 需真机分模态确认(见版本计划「迁移发现 §④」);此处按
 * 「ENOENT/ENOTDIR = 确切不存在,其它 = 暂不可达」兜底分类,真机结果可据此微调。
 */
export async function probePath(target: string): Promise<PathProbeResult> {
  try {
    await stat(target)
    return { ok: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, reason: "missing", code }
    return { ok: false, reason: "unreachable", code }
  }
}
