// [fork-only] media-gen — 注册表:合并目录 + 判可用(Layer 1 运行时)
// [feat: media-creation-mode] 2026-05-26
//
// 把"内置目录"按"用户配了哪些供应商 key"过滤成"当前可用模型清单"。
// 创作模式的模式菜单 / 左侧模型下拉就消费这里的输出。
// 用户文件(Layer 3 AI 帮接产出)+ 撞名内置赢 + 坏配跳过 等隔离逻辑留 P4(见需求规格 §8)。

import { readProviderApiKey } from "./auth"
import { BUILTIN_CATALOG, type CatalogEntry, type Capability } from "./catalog"

export type RegistryOptions = {
  /** 仅测试注入:覆盖 auth.json 路径 */
  authPath?: string
  /** 仅测试注入:覆盖目录(默认内置目录) */
  catalog?: CatalogEntry[]
}

function isConfigured(providerKey: string, opts?: RegistryOptions): boolean {
  return readProviderApiKey(providerKey, opts?.authPath) !== null
}

/** 当前可用的全部模型(供应商已配 key 的那些) */
export function availableEntries(opts?: RegistryOptions): CatalogEntry[] {
  const catalog = opts?.catalog ?? BUILTIN_CATALOG
  return catalog.filter((e) => isConfigured(e.providerKey, opts))
}

/** 某能力下的可用模型 */
export function entriesByCapability(cap: Capability, opts?: RegistryOptions): CatalogEntry[] {
  return availableEntries(opts).filter((e) => e.capability === cap)
}

/** 某能力的缺省主模型(标了 isDefault 的优先,否则第一个) */
export function defaultEntry(cap: Capability, opts?: RegistryOptions): CatalogEntry | undefined {
  const list = entriesByCapability(cap, opts)
  return list.find((e) => e.isDefault) ?? list[0]
}

/** 按 id 查可用模型 */
export function findEntry(id: string, opts?: RegistryOptions): CatalogEntry | undefined {
  return availableEntries(opts).find((e) => e.id === id)
}

/** 当前有哪些能力至少有 1 个可用模型(决定模式菜单显示哪些档) */
export function availableCapabilities(opts?: RegistryOptions): Capability[] {
  const seen = new Set<Capability>()
  for (const e of availableEntries(opts)) seen.add(e.capability)
  return [...seen]
}
