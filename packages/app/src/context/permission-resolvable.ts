// FORK-ONLY: REQ-078 方案D「谁触发谁展示」共享过滤层(纯逻辑) [feat: permission-filter-concurrency] 2026-08-02
//
// 背景:permission.asked 按目录广播,会带进别的 instance(如飞书桥)触发的权限;respond 是
// instance-scoped,别人的权限本端点了必 404。此前过滤只做在 composer 一处,且 resource 以布尔
// memo 为 source —— 只在 false→true 沿 fetch 一次,同 session 先后到两个权限时第二个被陈旧快照
// fail-closed 藏死(turn 挂死,飞书侧 240s 超时)。
//
// 这里改为「候选权限 id 集签名」驱动:任一增减 → refetch;无候选 → 不 fetch(保 e2e/离线
// 不冒 ERR_CONNECTION_REFUSED);fetch 失败 → null(fail-open 不过滤)。供 permission context
// 做成按 directory 共享的过滤视图,composer / 侧栏徽标 / 头像指示统一消费,消灭幻影徽标。

import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"

/** 计算某目录下候选权限 id 集签名(排除 autoResponds 的);空串 = 无候选。 */
export function candidateSignature(
  permissionsBySession: Record<string, PermissionRequest[] | undefined>,
  exclude: (item: PermissionRequest) => boolean,
): string {
  const ids: string[] = []
  for (const list of Object.values(permissionsBySession)) {
    for (const item of list ?? []) {
      if (exclude(item)) continue
      ids.push(item.id)
    }
  }
  return ids.sort().join(",")
}

/**
 * REQ-112:把**全局** session store 的 permission(形状 `{[sessionID]: PermissionRequest[]}`,
 * 没有 directory 维度)裁到指定 directory。
 *
 * 起因:1.18 把 permission 权威源挪到全局 store 后,过滤层仍读 child store —— 而 child 的
 * permission 恒空(两条写入路径都被关掉),导致签名恒空、从不 fetch、canResolve 恒 true,
 * REQ-078 整个过滤层 fail-open。换源必须配一层 session→directory 映射,否则会把别的目录的
 * 权限也算进候选。
 *
 * `directoryOf` 返回 undefined(session 还没进 store,启动期常见)时**保留**该条:
 * 宁可多触发一次自身可解列表的拉取,也不要让过滤层因为暂时认不出 session 而退回 fail-open ——
 * 后者正是本次 bug 的形状。多算进来的外来权限随后会被 canResolve 正确滤掉。
 *
 * [feat: session-presentation-input-batch] 2026-08-17
 */
export function scopePermissionsByDirectory(
  permissionsBySession: Record<string, PermissionRequest[] | undefined>,
  directory: string,
  directoryOf: (sessionID: string) => string | undefined,
): Record<string, PermissionRequest[] | undefined> {
  const result: Record<string, PermissionRequest[] | undefined> = {}
  for (const [sessionID, list] of Object.entries(permissionsBySession)) {
    if (!list?.length) continue
    const owner = directoryOf(sessionID)
    if (owner !== undefined && owner !== directory) continue
    result[sessionID] = list
  }
  return result
}

export type ResolvableApply = (ids: string[] | null) => void

/**
 * 按 directory 记签名、去重 fetch 的缓存。
 * - 空签名 / 与上次相同 → skip(不发请求);
 * - 新签名 → fetch;完成时若签名已被更新(乱序竞态)则丢弃结果;
 * - fetch 失败 → apply(null)(fail-open)。
 */
export function createResolvableCache(fetchIds: (directory: string) => Promise<string[]>) {
  const signatures = new Map<string, string>()

  return {
    async sync(directory: string, signature: string, apply: ResolvableApply): Promise<"skip" | "fetched" | "stale"> {
      if (!signature) return "skip"
      if (signatures.get(directory) === signature) return "skip"
      signatures.set(directory, signature)

      let ids: string[] | null
      try {
        ids = await fetchIds(directory)
      } catch {
        ids = null
      }
      if (signatures.get(directory) !== signature) return "stale"
      apply(ids)
      return "fetched"
    },
  }
}
