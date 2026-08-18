// [fork-only] REQ-084① 迁移污染检测 — 纯判定逻辑 [feat: voice-preclear-batch] 2026-08-18
//
// 风险场景:用户同机装了上游 opencode 且上游先升到 > fork core 的版本,把共享
//   `~/.local/share/opencode/opencode.db` 迁成【超前 schema】。之后 DeskFox 首启把它 copy 进
//   deskfox 命名空间 → fork core 打不开(no such column/table)→ sidecar 起不来且无自愈
//   (marker 已写,重启仍读同一污染 db,永久坏)。
//
// 判定依据:core 的迁移 journal = `migration` 表(id TEXT PRIMARY KEY),id 即
//   `packages/core/src/database/migration/` 下的文件名(去 .ts),形如 `YYYYMMDDHHMMSS_<slug>`。
//   老库兼容:core `migration.ts` 会把 legacy `__drizzle_migrations.name` seed 进 `migration` 表,
//   这些 legacy 名【不是】14 位时间戳形态 —— 老库天然带,不是超前信号,必须忽略否则全员误报。
//
// 本文件是纯函数(Logic 清单,行覆盖 ≥80%),不碰 IO;真正读 db 的壳在 db-schema-guard-io.ts。

/** 时间戳形态的 migration id:14 位数字 + 下划线 + slug(slug 允许中划线,如 `20260410174513_workspace-name`)。 */
const TIMESTAMP_ID = /^\d{14}_/

export type SchemaVerdict =
  /** journal 全部落在基线内(或只有 legacy 名)—— 可安全打开。 */
  | "compatible"
  /** 出现基线之外的时间戳形态 id —— db 比本 fork core 超前,打开必崩。 */
  | "ahead"
  /** 读不出有效 journal(空库 / 无表 / 打不开 / 文件损坏)—— 无法判断,fail-open 放行。 */
  | "unknown"

export interface SchemaAssessment {
  verdict: SchemaVerdict
  /** 判 ahead 时,超前的 id 清单(排序后);其余情形为空数组。用于日志与 toast 诊断。 */
  aheadIds: string[]
}

/**
 * T1:比对 journal id 清单与烤进包里的基线清单。
 *
 * 规则(1-spec §3-S1 钉死):
 * 1. 只看匹配 `^\d{14}_` 的时间戳形态 id;legacy 名一律忽略(老库天然带,不是超前信号)。
 * 2. 存在【基线清单之外】的时间戳形态 id → ahead。
 * 3. journal 读不出内容(null/空数组)→ unknown,fail-open。
 *
 * ⚠ 设计约束:检测本身绝不能把好库拦下来。任何不确定一律 unknown(放行),
 *   只有拿到确凿的"基线外时间戳 id"这一正向证据才判 ahead。
 */
export function assessJournal(ids: readonly string[] | null | undefined, baseline: readonly string[]): SchemaAssessment {
  // 读不到 journal(db 打不开 / 无 migration 表)→ 无法判断,放行。
  if (!ids) return { verdict: "unknown", aheadIds: [] }
  // 空 journal(全新空库,或表在但无行)→ 无法判断,放行。空库本来也没什么可污染的。
  if (ids.length === 0) return { verdict: "unknown", aheadIds: [] }

  const known = new Set(baseline)
  const aheadIds = ids.filter((id) => TIMESTAMP_ID.test(id) && !known.has(id)).sort()

  if (aheadIds.length > 0) return { verdict: "ahead", aheadIds }
  // 到这里:要么全在基线内,要么只剩 legacy 名 —— 两种都是正常可打开的库。
  return { verdict: "compatible", aheadIds: [] }
}
