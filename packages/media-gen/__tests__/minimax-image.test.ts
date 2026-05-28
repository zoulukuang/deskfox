// [feat: media-gen-minimax] 2026-05-28 — MiniMax 文生图 image-01 单测(mock fetch,不联网)
import { describe, expect, test } from "bun:test"
import { MinimaxError } from "../src/minimax-error"
import { generateImage } from "../src/minimax-image"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe("minimax generateImage", () => {
  test("成功路径:body 形状对 + 返回 image_urls", async () => {
    let captured: any
    const fetchImpl = (async (url: string, init: any) => {
      captured = { url, body: JSON.parse(init.body), headers: init.headers }
      return res(200, {
        base_resp: { status_code: 0, status_msg: "success" },
        data: { image_urls: ["https://oss/a.jpg", "https://oss/b.jpg"] },
      })
    }) as unknown as typeof fetch

    const out = await generateImage({ apiKey: "k", prompt: "一只狐狸", n: 2, fetchImpl })
    expect(out.urls).toEqual(["https://oss/a.jpg", "https://oss/b.jpg"])
    expect(out.model).toBe("image-01")
    expect(captured.url).toContain("/v1/image_generation")
    expect(captured.headers.Authorization).toBe("Bearer k")
    expect(captured.body.model).toBe("image-01")
    expect(captured.body.prompt).toBe("一只狐狸")
    expect(captured.body.aspect_ratio).toBe("1:1")
    expect(captured.body.n).toBe(2)
    expect(captured.body.response_format).toBe("url")
  })

  test("size '1280*720' 转 aspect_ratio '16:9'", async () => {
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { base_resp: { status_code: 0 }, data: { image_urls: ["https://x"] } })
    }) as unknown as typeof fetch

    await generateImage({ apiKey: "k", prompt: "p", size: "1280*720", fetchImpl })
    expect(captured.aspect_ratio).toBe("16:9")
  })

  test("1008 余额不足 → MinimaxError 友好文案", async () => {
    const fetchImpl = (async () =>
      res(200, {
        base_resp: { status_code: 1008, status_msg: "insufficient balance" },
      })) as unknown as typeof fetch

    const p = generateImage({ apiKey: "k", prompt: "p", fetchImpl })
    await expect(p).rejects.toThrow(/余额不足|订阅套餐失效/)
    await expect(p).rejects.toBeInstanceOf(MinimaxError)
  })

  test("HTTP 401 → auth_failed 错误", async () => {
    const fetchImpl = (async () => res(401, { error: "unauthorized" })) as unknown as typeof fetch
    const p = generateImage({ apiKey: "bad", prompt: "p", fetchImpl })
    await expect(p).rejects.toThrow(/API Key/)
  })

  test("status_code=0 但 image_urls 空 → no_image 错误", async () => {
    const fetchImpl = (async () =>
      res(200, { base_resp: { status_code: 0 }, data: { image_urls: [] } })) as unknown as typeof fetch

    const p = generateImage({ apiKey: "k", prompt: "p", fetchImpl })
    await expect(p).rejects.toThrow(/没返回图片链接/)
  })

  test("自定义 aspectRatio 覆盖 size 推断", async () => {
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { base_resp: { status_code: 0 }, data: { image_urls: ["u"] } })
    }) as unknown as typeof fetch

    await generateImage({ apiKey: "k", prompt: "p", size: "1024*1024", aspectRatio: "9:16", fetchImpl })
    expect(captured.aspect_ratio).toBe("9:16")
  })
})
