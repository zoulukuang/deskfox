// [feat: media-creation-mode] 2026-05-26 — 派发器:目录条目 → 对应引擎(mock fetch)
import { describe, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BUILTIN_CATALOG } from "../src/catalog"
import { runEntry } from "../src/dispatch"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => "" } as unknown as Response
}
function authFile(): string {
  const p = join(tmpdir(), `mg-disp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(p, JSON.stringify({ "alibaba-cn": { type: "api", key: "sk-x" } }))
  return p
}
const entry = (id: string) => BUILTIN_CATALOG.find((e) => e.id === id)!

describe("dispatch.runEntry", () => {
  test("image → generateImage,归一为 {kind:image, urls}", async () => {
    const authPath = authFile()
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("image-synthesis")) return res(200, { output: { task_id: "t", task_status: "PENDING" } })
      return res(200, { output: { task_status: "SUCCEEDED", results: [{ url: "https://oss/a.png" }] } })
    }) as unknown as typeof fetch
    const out = await runEntry(entry("alibaba-wanx2.1-t2i-turbo"), { prompt: "狐狸", fetchImpl, pollIntervalMs: 1 }, { authPath })
    expect(out.kind).toBe("image")
    expect(out.urls).toEqual(["https://oss/a.png"])
    expect(out.model).toBe("wanx2.1-t2i-turbo")
    rmSync(authPath)
  })

  test("translate → text", async () => {
    const authPath = authFile()
    const fetchImpl = (async () => res(200, { choices: [{ message: { content: "Hello" } }] })) as unknown as typeof fetch
    const out = await runEntry(entry("alibaba-qwen-mt-turbo"), { prompt: "你好", targetLang: "English", fetchImpl }, { authPath })
    expect(out.kind).toBe("text")
    expect(out.text).toBe("Hello")
    rmSync(authPath)
  })

  test("image_edit 缺素材 → 报错", async () => {
    const authPath = authFile()
    await expect(runEntry(entry("alibaba-qwen-image-edit"), { prompt: "改背景" }, { authPath })).rejects.toThrow(/图片/)
    rmSync(authPath)
  })

  test("没 key → 友好报错", async () => {
    const authPath = join(tmpdir(), `mg-nokey-${Date.now()}.json`)
    writeFileSync(authPath, JSON.stringify({ other: { type: "api", key: "x" } }))
    await expect(runEntry(entry("alibaba-wanx2.1-t2i-turbo"), { prompt: "x" }, { authPath })).rejects.toThrow(/API Key/)
    rmSync(authPath)
  })
})
