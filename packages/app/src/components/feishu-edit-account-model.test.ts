// [feat: feishu-edit-dialog-ux] 2026-06-08 — model 选择纯逻辑单测(Logic 清单,spec T1-T6)
import { describe, expect, test } from "bun:test"
import {
  AUTO_FREE_MODEL_ID,
  AUTO_FREE_PROVIDER_ID,
  buildModelOptions,
  defaultModelForProvider,
  initialModelSelection,
  isAutoFree,
  toModelPayload,
} from "./feishu-edit-account-model"

describe("initialModelSelection", () => {
  test("T1 未设(null)→ 默认 OpenCode Zen + 自动免费", () => {
    expect(initialModelSelection(null)).toEqual({
      providerID: AUTO_FREE_PROVIDER_ID,
      modelID: AUTO_FREE_MODEL_ID,
    })
  })

  test("T1' undefined 同样默认自动免费", () => {
    expect(initialModelSelection(undefined)).toEqual({
      providerID: "opencode",
      modelID: "__auto_free__",
    })
  })

  test("T2 哨兵 → 原样回显(provider opencode + auto)", () => {
    expect(
      initialModelSelection({ provider_id: "opencode", model_id: "__auto_free__" }),
    ).toEqual({ providerID: "opencode", modelID: "__auto_free__" })
  })

  test("T3 钉死具体 model → 原样返回(尊重已选)", () => {
    expect(
      initialModelSelection({ provider_id: "anthropic", model_id: "claude-x" }),
    ).toEqual({ providerID: "anthropic", modelID: "claude-x" })
  })
})

describe("buildModelOptions", () => {
  const models = [
    { id: "m1", name: "Model One" },
    { id: "m2" },
  ]
  const AUTO_LABEL = "自动(免费)"

  test("T4 opencode → 第一项是 auto 选项,其后才是真实 models", () => {
    const opts = buildModelOptions("opencode", models, AUTO_LABEL)
    expect(opts[0]).toEqual({ value: AUTO_FREE_MODEL_ID, label: AUTO_LABEL })
    expect(opts.slice(1)).toEqual([
      { value: "m1", label: "Model One" },
      { value: "m2", label: "m2" },
    ])
  })

  test("T5 非 opencode → 不含 auto 选项", () => {
    const opts = buildModelOptions("anthropic", models, AUTO_LABEL)
    expect(opts.some((o) => o.value === AUTO_FREE_MODEL_ID)).toBe(false)
    expect(opts).toHaveLength(2)
  })
})

describe("defaultModelForProvider", () => {
  test("opencode → 自动免费哨兵", () => {
    expect(defaultModelForProvider("opencode", [{ id: "x" }])).toBe(AUTO_FREE_MODEL_ID)
  })
  test("其他 → 第一个真实 model", () => {
    expect(defaultModelForProvider("anthropic", [{ id: "a" }, { id: "b" }])).toBe("a")
  })
  test("其他但空列表 → 空串", () => {
    expect(defaultModelForProvider("anthropic", [])).toBe("")
  })
})

describe("toModelPayload / isAutoFree", () => {
  test("T6 哨兵原样存为普通 {provider_id, model_id}", () => {
    expect(toModelPayload("opencode", "__auto_free__")).toEqual({
      provider_id: "opencode",
      model_id: "__auto_free__",
    })
  })
  test("具体 model 原样", () => {
    expect(toModelPayload("anthropic", "claude-x")).toEqual({
      provider_id: "anthropic",
      model_id: "claude-x",
    })
  })
  test("isAutoFree 仅 opencode + 哨兵为 true", () => {
    expect(isAutoFree("opencode", "__auto_free__")).toBe(true)
    expect(isAutoFree("opencode", "gpt-5")).toBe(false)
    expect(isAutoFree("anthropic", "__auto_free__")).toBe(false)
  })
})
