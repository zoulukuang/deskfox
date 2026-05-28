// [feat: media-gen-minimax] 2026-05-28 — asset-save file:// URL 支持(minimax-tts hex 落 tmpdir 后通过此搬到 creations/)
import { describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { saveAssets } from "../src/asset-save"

describe("saveAssets 支持 file:// URL", () => {
  test("file:// URL 走本地读 + 不调 fetch + 文件搬到 creations/audio/", async () => {
    // 准备:在 tmpdir 写一个 fake mp3
    const tmpFile = join(tmpdir(), `asset-save-test-${Date.now()}.mp3`)
    const expected = Buffer.from([0xde, 0xad, 0xbe, 0xef])
    writeFileSync(tmpFile, expected)
    const fileUrl = pathToFileURL(tmpFile).href
    expect(fileUrl.startsWith("file://")).toBe(true)

    // 准备:临时 projectDir
    const projectDir = join(tmpdir(), `asset-save-project-${Date.now()}`)
    mkdirSync(projectDir, { recursive: true })

    // 跑(若任何对外 fetch 被触发,本测试无网络也会失败 — 这是验证「不走 fetch」的最简方式)
    const out = await saveAssets(projectDir, "audio", [fileUrl])

    expect(out).toHaveLength(1)
    expect(out[0]!.startsWith(join(projectDir, "creations", "audio"))).toBe(true)
    expect(out[0]!.endsWith(".mp3")).toBe(true)

    // 验文件内容真搬到了(bytes 跟源一致)
    const onDisk = readFileSync(out[0]!)
    expect(onDisk.equals(expected)).toBe(true)

    // 清理
    rmSync(tmpFile, { force: true })
    rmSync(projectDir, { recursive: true, force: true })
  })

  test("file:// URL 指向不存在的文件 → 单个失败不阻断其他 URL", async () => {
    const projectDir = join(tmpdir(), `asset-save-project-${Date.now()}`)
    const validFile = join(tmpdir(), `valid-${Date.now()}.mp3`)
    writeFileSync(validFile, Buffer.from("hello"))

    const out = await saveAssets(projectDir, "audio", [
      "file:///nonexistent-blahblah.mp3",
      pathToFileURL(validFile).href,
    ])
    // 第一个失败,第二个成功
    expect(out).toHaveLength(1)
    expect(out[0]!.endsWith(".mp3")).toBe(true)

    rmSync(validFile, { force: true })
    rmSync(projectDir, { recursive: true, force: true })
  })
})
