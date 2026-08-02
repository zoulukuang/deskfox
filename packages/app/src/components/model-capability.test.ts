// [feat: model-capability-ui] REQ-026 T1-T3(T4 tools/reasoning 随徽标撤除删去)
import { describe, expect, test } from "bun:test"
import { modelSupportsImage } from "./model-capability"

describe("modelSupportsImage", () => {
  test("T1: capabilities.input.image 明确 true/false", () => {
    expect(modelSupportsImage({ capabilities: { input: { image: true } } })).toBe(true)
    expect(modelSupportsImage({ capabilities: { input: { image: false } } })).toBe(false)
  })

  test("T2: capabilities 缺失回落 modalities.input", () => {
    expect(modelSupportsImage({ modalities: { input: ["text", "image"] } })).toBe(true)
    expect(modelSupportsImage({ modalities: { input: ["text"] } })).toBe(false)
  })

  test("T3: 模型为空 / 字段全缺 → unknown(保守放行)", () => {
    expect(modelSupportsImage(undefined)).toBe("unknown")
    expect(modelSupportsImage(null)).toBe("unknown")
    expect(modelSupportsImage({})).toBe("unknown")
    expect(modelSupportsImage({ capabilities: {} })).toBe("unknown")
  })

  test("capabilities 优先于 modalities(false 也优先)", () => {
    expect(modelSupportsImage({ capabilities: { input: { image: false } }, modalities: { input: ["image"] } })).toBe(
      false,
    )
  })
})
