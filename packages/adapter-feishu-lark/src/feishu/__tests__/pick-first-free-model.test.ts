// [feat: feishu-edit-dialog-ux] 2026-06-08 — 自动免费模型解析单测(spec T7 / T15 兜底)
import { describe, expect, test } from "bun:test"
import { pickFirstFreeModel } from "../message-pipeline"

const providers = (models: Record<string, unknown>, id = "opencode") => ({
  providers: [{ id, models }],
})

describe("pickFirstFreeModel", () => {
  test("T7 取 opencode 第一个 cost.input===0 的 model", () => {
    const data = providers({
      paid: { id: "paid", cost: { input: 3 } },
      free1: { id: "free1", cost: { input: 0 } },
      free2: { id: "free2", cost: { input: 0 } },
    })
    expect(pickFirstFreeModel(data)).toEqual({ providerID: "opencode", modelID: "free1" })
  })

  test("cost 缺失也算免费(与前端 !cost 判据一致)", () => {
    const data = providers({ m: { id: "m" } })
    expect(pickFirstFreeModel(data)).toEqual({ providerID: "opencode", modelID: "m" })
  })

  test("全是付费 → null(调用方回退全局默认)", () => {
    const data = providers({
      a: { id: "a", cost: { input: 1 } },
      b: { id: "b", cost: { input: 2 } },
    })
    expect(pickFirstFreeModel(data)).toBeNull()
  })

  test("无 opencode provider → null", () => {
    const data = providers({ x: { id: "x", cost: { input: 0 } } }, "anthropic")
    expect(pickFirstFreeModel(data)).toBeNull()
  })

  test("T15 数据缺失/形状不对 → null(离线兜底)", () => {
    expect(pickFirstFreeModel(undefined)).toBeNull()
    expect(pickFirstFreeModel(null)).toBeNull()
    expect(pickFirstFreeModel({})).toBeNull()
    expect(pickFirstFreeModel({ providers: "nope" })).toBeNull()
    expect(pickFirstFreeModel({ providers: [{ id: "opencode" }] })).toBeNull() // 无 models
  })
})
