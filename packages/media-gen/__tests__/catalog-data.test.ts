// [feat: media-catalog-data-extract] 2026-06-01
// 阶段 1:catalog 数据/代码分层后,守护 catalog.data.json 的结构 + 与代码/schema 不漂移。
// 这是数据层的 Logic 测试(校验在测试期跑,运行时不校验,见 catalog.ts FORK 段)。
import { describe, expect, test } from "bun:test"
import { ALIBABA_KEY, BUILTIN_CATALOG, CAPABILITY_LABEL, MINIMAX_KEY, XIAOMI_KEY } from "../src/catalog"
import catalogData from "../src/catalog.data.json"
import schema from "../src/catalog.schema.json"

const CAPABILITIES = Object.keys(CAPABILITY_LABEL)
const KNOWN_PROVIDER_KEYS = new Set([ALIBABA_KEY, MINIMAX_KEY, XIAOMI_KEY])
const ALLOWED_TOP_KEYS = new Set(["id", "capability", "provider", "providerKey", "model", "displayName", "isDefault", "note", "params"])
const ALLOWED_PARAM_KEYS = new Set(["sizes", "voices", "needFile", "voiceDesignHint"])

describe("catalog.data.json — 数据层结构校验", () => {
  test("是非空数组,且 BUILTIN_CATALOG 与 JSON 数据等量(运行时原样导出)", () => {
    expect(Array.isArray(catalogData)).toBe(true)
    expect(catalogData.length).toBeGreaterThan(0)
    expect(BUILTIN_CATALOG.length).toBe(catalogData.length)
  })

  test("每条都有必填 string 字段(id/capability/provider/providerKey/model/displayName)", () => {
    for (const e of BUILTIN_CATALOG) {
      for (const f of ["id", "capability", "provider", "providerKey", "model", "displayName"] as const) {
        expect(typeof e[f]).toBe("string")
        expect((e[f] as string).length).toBeGreaterThan(0)
      }
    }
  })

  test("id 全局唯一", () => {
    const ids = BUILTIN_CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("每条 capability 都在 CAPABILITY_LABEL 已知集合内", () => {
    for (const e of BUILTIN_CATALOG) {
      expect(CAPABILITIES).toContain(e.capability)
    }
  })

  test("每条 providerKey 都是已知供应商 key(alibaba/minimax/xiaomi)", () => {
    for (const e of BUILTIN_CATALOG) {
      expect(KNOWN_PROVIDER_KEYS.has(e.providerKey)).toBe(true)
    }
  })

  test("每个 capability 最多一个 isDefault(避免默认歧义)", () => {
    const defaultsByCap = new Map<string, number>()
    for (const e of BUILTIN_CATALOG) {
      if (e.isDefault) defaultsByCap.set(e.capability, (defaultsByCap.get(e.capability) ?? 0) + 1)
    }
    for (const [cap, n] of defaultsByCap) expect(n, `capability ${cap} 有多个 isDefault`).toBe(1)
  })

  test("没有未知顶层字段 / 未知 params 字段(additionalProperties: false)", () => {
    for (const e of BUILTIN_CATALOG as Record<string, unknown>[]) {
      for (const k of Object.keys(e)) expect(ALLOWED_TOP_KEYS.has(k), `条目 ${e.id} 有未知字段 ${k}`).toBe(true)
      const params = e.params as Record<string, unknown> | undefined
      if (params) for (const k of Object.keys(params)) expect(ALLOWED_PARAM_KEYS.has(k), `${e.id}.params 有未知字段 ${k}`).toBe(true)
    }
  })

  test("params 字段类型正确(needFile ∈ image|audio,sizes/voices 为 string[])", () => {
    for (const e of BUILTIN_CATALOG) {
      if (!e.params) continue
      if (e.params.needFile !== undefined) expect(["image", "audio"]).toContain(e.params.needFile)
      if (e.params.sizes !== undefined) {
        expect(Array.isArray(e.params.sizes)).toBe(true)
        for (const s of e.params.sizes) expect(typeof s).toBe("string")
      }
      if (e.params.voices !== undefined) {
        expect(Array.isArray(e.params.voices)).toBe(true)
        for (const v of e.params.voices) expect(typeof v).toBe("string")
      }
      if (e.params.voiceDesignHint !== undefined) expect(typeof e.params.voiceDesignHint).toBe("boolean")
    }
  })
})

describe("catalog.schema.json — 与代码防漂移", () => {
  test("schema 的 capability 枚举 与 CAPABILITY_LABEL 的 key 完全一致", () => {
    const enumVals: string[] = schema.definitions.Capability.enum
    expect([...enumVals].sort()).toEqual([...CAPABILITIES].sort())
  })

  test("schema 的 needFile 枚举 = image|audio", () => {
    const nf: string[] = schema.definitions.CatalogEntry.properties.params.properties.needFile.enum
    expect([...nf].sort()).toEqual(["audio", "image"])
  })

  test("schema 必填字段 = 代码里 CatalogEntry 的必填项", () => {
    const required: string[] = schema.definitions.CatalogEntry.required
    expect([...required].sort()).toEqual(["capability", "displayName", "id", "model", "provider", "providerKey"])
  })
})
