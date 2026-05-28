// [feat: media-gen-minimax] 2026-05-28 — catalog 含 minimax 3 entries
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { BUILTIN_CATALOG, MINIMAX_KEY } from "../src/catalog"
import { availableCapabilities, availableEntries, entriesByCapability } from "../src/registry"

describe("catalog minimax entries", () => {
  test("BUILTIN_CATALOG 含 3 个 minimax-cn providerKey entries", () => {
    const minimax = BUILTIN_CATALOG.filter((e) => e.providerKey === MINIMAX_KEY)
    expect(minimax).toHaveLength(3)
    const ids = minimax.map((e) => e.id).sort()
    expect(ids).toEqual(["minimax-hailuo-2.3", "minimax-image-01", "minimax-speech-2.8-turbo"])
    const caps = minimax.map((e) => e.capability).sort()
    expect(caps).toEqual(["image", "tts", "video"])
  })

  test("MiniMax 不接 image_edit / asr / translate / video_i2v(spec 非目标)", () => {
    const minimaxCaps = BUILTIN_CATALOG.filter((e) => e.providerKey === MINIMAX_KEY).map((e) => e.capability)
    expect(minimaxCaps).not.toContain("image_edit")
    expect(minimaxCaps).not.toContain("asr")
    expect(minimaxCaps).not.toContain("translate")
    expect(minimaxCaps).not.toContain("video_i2v")
  })

  test("阿里 entries 全保留(0 回归)", () => {
    const alibaba = BUILTIN_CATALOG.filter((e) => e.providerKey === "alibaba-cn")
    expect(alibaba.length).toBeGreaterThanOrEqual(8) // 文档明示 8 模型
  })
})

describe("registry 配 minimax-cn 后自动亮 3 档", () => {
  test("只配 minimax-cn(无 alibaba)→ availableEntries 只剩 minimax 3 个", () => {
    const dir = join(tmpdir(), `catalog-test-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const authPath = join(dir, "auth.json")
    writeFileSync(authPath, JSON.stringify({ "minimax-cn-coding-plan": { type: "api", key: "sk-x" } }))

    const list = availableEntries({ authPath })
    expect(list).toHaveLength(3)
    expect(list.every((e) => e.providerKey === MINIMAX_KEY)).toBe(true)
    expect(availableCapabilities({ authPath }).sort()).toEqual(["image", "tts", "video"])

    rmSync(authPath, { force: true })
  })

  test("alibaba + minimax 都配 → 文生图 (image) 列表 ≥2 个(两家可选)", () => {
    const dir = join(tmpdir(), `catalog-test-both-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const authPath = join(dir, "auth.json")
    writeFileSync(
      authPath,
      JSON.stringify({
        "alibaba-cn": { type: "api", key: "sk-a" },
        "minimax-cn-coding-plan": { type: "api", key: "sk-m" },
      }),
    )

    const images = entriesByCapability("image", { authPath })
    expect(images.length).toBeGreaterThanOrEqual(2)
    const providers = new Set(images.map((e) => e.providerKey))
    expect(providers.has("alibaba-cn")).toBe(true)
    expect(providers.has("minimax-cn-coding-plan")).toBe(true)

    rmSync(authPath, { force: true })
  })
})
