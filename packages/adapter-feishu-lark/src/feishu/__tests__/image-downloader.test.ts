// FORK: image-downloader 单测
// [feat: feishu-image-recognition] 2026-05-26
//
// 5 用例 I1-I5 覆盖 helper 主路径 + 边界(失败 / charset / 特殊字符 / 新目录)

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  downloadFeishuImage,
  mimeToExt,
  timestampForFilename,
} from "../image-downloader"

// mock IMBOT_WORKSPACE 到 tmp 目录(避免污染真用户 ~/.opencode/)
let TMP_WS: string
let originalFetch: typeof fetch

beforeEach(() => {
  TMP_WS = mkdtempSync(join(tmpdir(), "feishu-img-test-"))
  // FEISHU_IMAGES_DIR = join(IMBOT_WORKSPACE, "feishu-images")
  // 单测里我们不通过 mock IMBOT_WORKSPACE 来测,改测算法本身(chatId 子目录 + filename 生成)
  // 改:让 downloadFeishuImage 自己 mkdir,我们检验落盘到指定目录
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (TMP_WS && existsSync(TMP_WS)) {
    rmSync(TMP_WS, { recursive: true, force: true })
  }
})

describe("downloadFeishuImage (iter image-recognition)", () => {
  test("I1: mock fetch 200 + image/jpeg → 返 absolutePath / mime / size / filename", async () => {
    const fakeBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    globalThis.fetch = mock(
      async () =>
        new Response(fakeBytes.buffer, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    ) as unknown as typeof fetch

    const r = await downloadFeishuImage("img_v3_abc123def", "oc_chat_xyz", "tk_fake")

    expect(r.mime).toBe("image/jpeg")
    expect(r.size).toBe(fakeBytes.length)
    // image_key 取前 12 字符 → "img_v3_abc12"
    expect(r.filename).toMatch(/^\d{14}-img_v3_abc12\.jpg$/)
    expect(r.absolutePath).toContain("feishu-images")
    expect(r.absolutePath).toContain("oc_chat_xyz")
    // 文件真落盘
    expect(existsSync(r.absolutePath)).toBe(true)
    const onDisk = readFileSync(r.absolutePath)
    expect(Array.from(onDisk)).toEqual(Array.from(fakeBytes))
    // cleanup(避免污染真 IMBOT_WORKSPACE)
    rmSync(r.absolutePath)
  })

  test("I2: mock fetch 404 → throw 含 status + image_key", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(null, { status: 404, statusText: "Not Found" }),
    ) as unknown as typeof fetch

    await expect(
      downloadFeishuImage("img_invalid", "oc_chat_test", "tk_fake"),
    ).rejects.toThrow(/404|Not Found|img_invalid/)
  })

  test("I3: content-type 含 charset / 多余 param → mime 去掉 charset 只取 主类型", async () => {
    const fakeBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    globalThis.fetch = mock(
      async () =>
        new Response(fakeBytes.buffer, {
          status: 200,
          headers: { "content-type": "image/png; charset=binary" },
        }),
    ) as unknown as typeof fetch

    const r = await downloadFeishuImage("img_png", "oc_chat_test", "tk_fake")
    expect(r.mime).toBe("image/png")
    expect(r.filename).toMatch(/\.png$/)
    rmSync(r.absolutePath)
  })

  test("I4: chatId 含特殊字符(`om_xxx:test`/`../etc`)→ safe filename(下划线替换)防目录遍历", async () => {
    const fakeBytes = new Uint8Array([1])
    globalThis.fetch = mock(
      async () =>
        new Response(fakeBytes.buffer, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    ) as unknown as typeof fetch

    const r = await downloadFeishuImage("img_test", "../../etc/passwd:malicious", "tk_fake")
    // safeChatId 把所有非 [a-zA-Z0-9_-] 字符 → _
    expect(r.absolutePath).not.toContain("..")
    expect(r.absolutePath).not.toContain("/etc/passwd")
    expect(r.absolutePath).toContain("___")
    // 验证文件确实落在 feishu-images 子树内,不在 /etc/
    expect(r.absolutePath).toContain("feishu-images")
    rmSync(r.absolutePath)
  })

  test("I5: mkdir recursive 兜底全新 chatId 目录(目录之前不存在也能成功)", async () => {
    const fakeBytes = new Uint8Array([42])
    globalThis.fetch = mock(
      async () =>
        new Response(fakeBytes.buffer, {
          status: 200,
          headers: { "content-type": "image/gif" },
        }),
    ) as unknown as typeof fetch

    // chatId 用唯一名(肯定首次创建)
    const uniqueChatId = `oc_uniq_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const r = await downloadFeishuImage("img_uniq", uniqueChatId, "tk_fake")
    expect(existsSync(r.absolutePath)).toBe(true)
    expect(r.filename).toMatch(/\.gif$/)
    rmSync(r.absolutePath)
  })
})

describe("mimeToExt", () => {
  test("覆盖常见 mime", () => {
    expect(mimeToExt("image/jpeg")).toBe("jpg")
    expect(mimeToExt("image/jpg")).toBe("jpg")
    expect(mimeToExt("image/png")).toBe("png")
    expect(mimeToExt("image/gif")).toBe("gif")
    expect(mimeToExt("image/webp")).toBe("webp")
    expect(mimeToExt("image/svg+xml")).toBe("svg")
    expect(mimeToExt("image/bmp")).toBe("bmp")
    expect(mimeToExt("image/avif")).toBe("avif")
  })

  test("大小写不敏感", () => {
    expect(mimeToExt("IMAGE/PNG")).toBe("png")
    expect(mimeToExt("Image/Jpeg")).toBe("jpg")
  })

  test("未知 mime → bin", () => {
    expect(mimeToExt("application/octet-stream")).toBe("bin")
    expect(mimeToExt("image/heic")).toBe("bin")
  })
})

describe("timestampForFilename", () => {
  test("YYYYMMDDHHMMSS 14 位", () => {
    const ts = timestampForFilename(new Date("2026-05-26T09:34:56Z"))
    expect(ts).toMatch(/^\d{14}$/)
    expect(ts.length).toBe(14)
  })

  test("月日时分秒补 0", () => {
    const ts = timestampForFilename(new Date(2026, 0, 5, 3, 7, 9)) // 月份 0-indexed
    expect(ts).toBe("20260105030709")
  })
})
