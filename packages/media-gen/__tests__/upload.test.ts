// [feat: media-gen-alibaba] 2026-05-26 — 本地文件上传解析单元测试
import { describe, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { isRemoteUrl, needsResolveHeader, resolveInputUrl } from "../src/dashscope-upload"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => "" } as unknown as Response
}

describe("isRemoteUrl / needsResolveHeader", () => {
  test("识别 http/https/oss", () => {
    expect(isRemoteUrl("https://x/a.png")).toBe(true)
    expect(isRemoteUrl("oss://dir/a.png")).toBe(true)
    expect(isRemoteUrl("file:///D:/a.png")).toBe(false)
    expect(isRemoteUrl("D:/a.png")).toBe(false)
    expect(needsResolveHeader("oss://dir/a.png")).toBe(true)
    expect(needsResolveHeader("https://x/a.png")).toBe(false)
  })
})

describe("resolveInputUrl", () => {
  test("http 链接原样返回,不触发上传", async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      return res(200, {})
    }) as unknown as typeof fetch
    const u = await resolveInputUrl({ apiKey: "k", input: "https://x/a.wav", model: "m", fetchImpl })
    expect(u).toBe("https://x/a.wav")
    expect(called).toBe(false)
  })

  test("本地路径 → getPolicy + 上传 → oss:// 链接", async () => {
    const p = join(tmpdir(), `mg-upload-test-${Date.now()}.wav`)
    writeFileSync(p, new Uint8Array([1, 2, 3, 4]))
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("getPolicy")) {
        return res(200, {
          data: {
            upload_host: "https://oss.host",
            upload_dir: "dir/abc",
            policy: "p",
            signature: "s",
            oss_access_key_id: "id",
            x_oss_object_acl: "private",
            x_oss_forbid_overwrite: "true",
          },
        })
      }
      return res(200, {}) // OSS 上传
    }) as unknown as typeof fetch

    const u = await resolveInputUrl({ apiKey: "k", input: p, model: "paraformer-v2", fetchImpl })
    expect(u).toBe(`oss://dir/abc/${basename(p)}`)
    expect(needsResolveHeader(u)).toBe(true)
    rmSync(p)
  })
})
