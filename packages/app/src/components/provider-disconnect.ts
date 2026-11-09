// [fork-only] 断开配置型供应商后强制失效服务端 provider 缓存并刷新列表 [feat: provider-disconnect-stale] 2026-11-09
//
// 背景:配置型供应商(含 GetBot)断开走 `disabled_providers` 路径。服务端 `global.config.update`
// 只把「销毁全部实例」fork 出去就立刻返回;客户端在 onSuccess 里马上重拉 providers,
// 请求常常打到还没销毁的旧实例 → 拿回的还是缓存里「已连接」的列表 → 设置页里供应商消失不掉。
// 修法:写完配置后显式 await `global.dispose`(服务端这条是同步等待销毁完成的),再 await 刷新。
// 抽成纯函数以便离线单测时序;组件只负责注入 SDK / store 的具体实现。

export type DisableProviderDeps = {
  /** 写 disabled_providers 到全局配置(server-sync.updateConfig)。 */
  updateConfig: (config: { disabled_providers: string[] }) => Promise<unknown>
  /** 服务端销毁全部实例并等待完成(client.global.dispose)。 */
  dispose: () => Promise<unknown>
  /** 重拉 providers query(server-sync.refreshProviders)。 */
  refresh: () => Promise<unknown>
}

export type DisableProviderResult = { ok: true; next: string[] } | { ok: false; error: unknown }

export function nextDisabledProviders(before: readonly string[], providerID: string): string[] {
  return before.includes(providerID) ? [...before] : [...before, providerID]
}

/**
 * 顺序必须是 updateConfig → dispose → refresh,且后两步都要等前一步完成:
 * - dispose 不等 → 刷新撞旧实例缓存(本 bug);
 * - refresh 不等 → 调用方先弹「已断开」toast 而列表还没变,看起来像没生效。
 * dispose / refresh 失败不改变「配置已写入」这一事实,所以只吞掉、照样返回 ok;
 * updateConfig 失败才算失败,由调用方回滚本地 store。
 */
export async function disableProviderAndRefresh(
  deps: DisableProviderDeps,
  providerID: string,
  before: readonly string[],
): Promise<DisableProviderResult> {
  const next = nextDisabledProviders(before, providerID)
  try {
    await deps.updateConfig({ disabled_providers: next })
  } catch (error) {
    return { ok: false, error }
  }
  await deps.dispose().catch(() => undefined)
  await deps.refresh().catch(() => undefined)
  return { ok: true, next }
}
