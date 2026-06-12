// [feat: media-creation-mode] 2026-05-26 — 注册表:按已配 key 过滤目录
import { describe, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { availableCapabilities, availableEntries, defaultEntry, entriesByCapability, findEntry } from "../src/registry"

function authFile(content: Record<string, unknown>): string {
  const p = join(tmpdir(), `mg-reg-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(p, JSON.stringify(content))
  return p
}

describe("registry", () => {
  test("配了 alibaba-cn → 阿里全部专业模型可用", () => {
    const authPath = authFile({ "alibaba-cn": { type: "api", key: "sk-x" } })
    expect(availableEntries({ authPath }).length).toBe(8)
    rmSync(authPath)
  })

  test("没配 alibaba-cn → 空", () => {
    const authPath = authFile({ getbot: { type: "api", key: "x" } })
    expect(availableEntries({ authPath }).length).toBe(0)
    expect(availableCapabilities({ authPath }).length).toBe(0)
    rmSync(authPath)
  })

  test("按能力筛 + 缺省主模型", () => {
    const authPath = authFile({ "alibaba-cn": { type: "api", key: "sk-x" } })
    expect(entriesByCapability("image", { authPath }).length).toBe(2)
    expect(defaultEntry("image", { authPath })?.model).toBe("wanx2.1-t2i-turbo")
    expect(defaultEntry("translate", { authPath })?.model).toBe("qwen-mt-turbo")
    rmSync(authPath)
  })

  test("可用能力齐 7 类 + findEntry", () => {
    const authPath = authFile({ "alibaba-cn": { type: "api", key: "sk-x" } })
    expect(availableCapabilities({ authPath }).slice().sort().join(",")).toBe(
      "asr,image,image_edit,translate,tts,video,video_i2v",
    )
    expect(findEntry("alibaba-qwen-image-edit", { authPath })?.capability).toBe("image_edit")
    rmSync(authPath)
  })
})
