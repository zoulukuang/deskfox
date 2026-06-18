// FORK: REQ-054 — mergeGetbotModels 单测 [feat: v2026.8.3 自定义供应商模型列表同步] 2026-06-18
import { describe, expect, test } from "bun:test"
import { mergeGetbotModels, inferModelConfig, type GetbotModelMeta } from "./getbot"

describe("mergeGetbotModels", () => {
  test("keeps models in remoteIds, drops ghosts not in remote", () => {
    const existing: Record<string, GetbotModelMeta> = {
      "gpt-4o": { name: "gpt-4o", tool_call: true, attachment: true },
      "ghost-model": { name: "ghost-model", tool_call: true },
    }
    const remoteIds = ["gpt-4o", "new-model"]
    const result = mergeGetbotModels(existing, remoteIds)

    // 幽灵 ghost-model 不在 remoteIds → 丢弃
    expect(Object.keys(result)).not.toContain("ghost-model")
    // gpt-4o 在 remoteIds → 保留
    expect(Object.keys(result)).toContain("gpt-4o")
    // new-model 在 remoteIds → 新增(推断兜底)
    expect(Object.keys(result)).toContain("new-model")
  })

  test("preserves existing capability annotations for retained models", () => {
    const existing: Record<string, GetbotModelMeta> = {
      "gpt-4o": { name: "gpt-4o", tool_call: true, attachment: true, reasoning: false },
    }
    const remoteIds = ["gpt-4o"]
    const result = mergeGetbotModels(existing, remoteIds)

    // 已有标注原样保留,不被 inferModelConfig 覆盖
    expect(result["gpt-4o"]).toEqual({ name: "gpt-4o", tool_call: true, attachment: true, reasoning: false })
  })

  test("uses inferModelConfig for new models not in existing", () => {
    const existing: Record<string, GetbotModelMeta> = {}
    const remoteIds = ["o1-mini", "claude-3-5-sonnet"]
    const result = mergeGetbotModels(existing, remoteIds)

    // 新模型走推断兜底
    expect(result["o1-mini"]).toEqual(inferModelConfig("o1-mini"))
    expect(result["claude-3-5-sonnet"]).toEqual(inferModelConfig("claude-3-5-sonnet"))
  })

  test("returns exactly remoteIds.length keys (acceptance: 41 → 35)", () => {
    // 模拟 existing 41 个模型(含 6 个幽灵),remote 返回 35 个 → 结果 35 个
    const existing: Record<string, GetbotModelMeta> = {}
    for (let i = 0; i < 35; i++) existing[`model-${i}`] = { name: `model-${i}`, tool_call: true }
    for (let i = 35; i < 41; i++) existing[`ghost-${i}`] = { name: `ghost-${i}`, tool_call: true }

    const remoteIds = Array.from({ length: 35 }, (_, i) => `model-${i}`)
    const result = mergeGetbotModels(existing, remoteIds)

    expect(Object.keys(result).length).toBe(35)
    // 所有 ghost 键消失
    for (let i = 35; i < 41; i++) {
      expect(Object.keys(result)).not.toContain(`ghost-${i}`)
    }
    // 所有 remote 键存在
    for (let i = 0; i < 35; i++) {
      expect(Object.keys(result)).toContain(`model-${i}`)
    }
  })

  test("returns empty record when remoteIds is empty", () => {
    const existing: Record<string, GetbotModelMeta> = {
      "gpt-4o": { name: "gpt-4o", tool_call: true },
    }
    const result = mergeGetbotModels(existing, [])
    expect(Object.keys(result).length).toBe(0)
  })

  test("returns empty record when both existing and remoteIds are empty", () => {
    const result = mergeGetbotModels({}, [])
    expect(Object.keys(result).length).toBe(0)
  })

  test("handles no existing config (first connect scenario with empty existing)", () => {
    const remoteIds = ["gpt-4o", "gpt-4-turbo"]
    const result = mergeGetbotModels({}, remoteIds)
    expect(Object.keys(result).length).toBe(2)
    expect(result["gpt-4o"]).toEqual(inferModelConfig("gpt-4o"))
    expect(result["gpt-4-turbo"]).toEqual(inferModelConfig("gpt-4-turbo"))
  })
})

describe("inferModelConfig", () => {
  test("infers reasoning capability for o1/o3/o4 models", () => {
    expect(inferModelConfig("o1-mini").reasoning).toBe(true)
    expect(inferModelConfig("o3-mini").reasoning).toBe(true)
    expect(inferModelConfig("gpt-4o").reasoning).toBeUndefined()
  })

  test("infers attachment capability for vision/omni/claude models", () => {
    expect(inferModelConfig("gpt-4o-vision").attachment).toBe(true)
    expect(inferModelConfig("claude-3-5-sonnet").attachment).toBe(true)
    expect(inferModelConfig("gpt-4-turbo").attachment).toBeUndefined()
  })

  test("disables tool_call for realtime models", () => {
    expect(inferModelConfig("gpt-4o-realtime").tool_call).toBe(false)
    expect(inferModelConfig("gpt-4o").tool_call).toBe(true)
  })
})
