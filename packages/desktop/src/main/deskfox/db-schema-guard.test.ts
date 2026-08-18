// [fork-only] REQ-084① 迁移污染检测 — 纯判定逻辑单测 [feat: voice-preclear-batch] 2026-08-18
// 对应 1-spec §3-S1 的 R8 用例:T1(assessJournal 五类输入)+ T2(baseline drift 闸)
import { describe, expect, test } from "bun:test"
import { readdirSync } from "fs"
import path from "path"
import { assessJournal } from "./db-schema-guard"
import { MIGRATION_BASELINE } from "./migration-baseline.generated"

// 取真实基线的头几条当"已应用"样本,避免测试写死假 id 与实现脱节。
const B = MIGRATION_BASELINE
const AHEAD_ID = "99991231235959_pollution_probe"
// legacy 名:core 从 __drizzle_migrations.name seed 进来的,非 14 位时间戳形态。
const LEGACY = ["0000_wakeful_the_professor", "0001_broad_lady_bullseye"]

describe("assessJournal (T1)", () => {
  test("① 基线子集 → compatible", () => {
    expect(assessJournal(B.slice(0, 5), B)).toEqual({ verdict: "compatible", aheadIds: [] })
  })

  test("① 基线全集 → compatible", () => {
    expect(assessJournal(B, B)).toEqual({ verdict: "compatible", aheadIds: [] })
  })

  test("② 空 journal → unknown(fail-open,不拦)", () => {
    expect(assessJournal([], B)).toEqual({ verdict: "unknown", aheadIds: [] })
  })

  test("② 读不到 journal(null/undefined)→ unknown(fail-open)", () => {
    expect(assessJournal(null, B)).toEqual({ verdict: "unknown", aheadIds: [] })
    expect(assessJournal(undefined, B)).toEqual({ verdict: "unknown", aheadIds: [] })
  })

  test("③ 仅 legacy 名 → compatible(老库天然带,绝不能误判超前)", () => {
    expect(assessJournal(LEGACY, B)).toEqual({ verdict: "compatible", aheadIds: [] })
  })

  test("③ legacy + 基线内 id → compatible", () => {
    expect(assessJournal([...LEGACY, ...B.slice(0, 3)], B)).toEqual({ verdict: "compatible", aheadIds: [] })
  })

  test("④ 含基线外时间戳 id → ahead,并回报超前 id", () => {
    expect(assessJournal([...B, AHEAD_ID], B)).toEqual({ verdict: "ahead", aheadIds: [AHEAD_ID] })
  })

  test("⑤ 混合(legacy + 基线内 + 多条超前)→ ahead,aheadIds 排序且只含超前项", () => {
    const ahead2 = "99990101000000_another_probe"
    const got = assessJournal([...LEGACY, ...B.slice(0, 2), AHEAD_ID, ahead2], B)
    expect(got.verdict).toBe("ahead")
    // 排序后:99990101… 在 99991231… 前
    expect(got.aheadIds).toEqual([ahead2, AHEAD_ID])
  })

  test("边界:slug 含中划线的真实 id 不被误判(如 workspace-name / session-metadata)", () => {
    const dashed = B.filter((id) => id.includes("-"))
    expect(dashed.length).toBeGreaterThan(0) // 真实基线里确有这类 id,守住这个前提
    expect(assessJournal(dashed, B)).toEqual({ verdict: "compatible", aheadIds: [] })
  })

  test("边界:空基线 + 任何时间戳 id → ahead(基线丢了宁可判超前,由上层 fail-open 兜)", () => {
    expect(assessJournal([B[0]!], []).verdict).toBe("ahead")
  })

  test("边界:非 14 位数字前缀不算时间戳形态(13 位 / 15 位 / 纯数字无下划线)", () => {
    expect(assessJournal(["2026012722235_short", "202601272223531_long", "20260127222353"], B)).toEqual({
      verdict: "compatible",
      aheadIds: [],
    })
  })
})

describe("baseline drift 闸 (T2)", () => {
  test("生成物与 packages/core/src/database/migration/ 目录实时清单完全一致", () => {
    const dir = path.resolve(import.meta.dir, "../../../../core/src/database/migration")
    const actual = readdirSync(dir)
      .filter((n) => n.endsWith(".ts"))
      .map((n) => n.replace(/\.ts$/, ""))
      .sort()
    // 不一致 = 上游 sync 后忘了重跑 packages/branding/scripts/gen-migration-baseline.mjs。
    // 后果很实：基线缺条 → 自家正常新库被判 ahead → 被隔离挪走。必须红。
    expect([...MIGRATION_BASELINE].sort()).toEqual(actual)
  })

  test("基线非空且全为时间戳形态 id", () => {
    expect(MIGRATION_BASELINE.length).toBeGreaterThan(0)
    for (const id of MIGRATION_BASELINE) expect(id).toMatch(/^\d{14}_/)
  })

  test("基线无重复", () => {
    expect(new Set(MIGRATION_BASELINE).size).toBe(MIGRATION_BASELINE.length)
  })
})
