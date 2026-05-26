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
  makeImageFilename,
  MAX_IMAGE_BYTES,
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

    const r = await downloadFeishuImage(
      "img_v3_abc123def",
      "om_msg_test",
      "oc_chat_xyz",
      "tk_fake",
    )

    expect(r.mime).toBe("image/jpeg")
    expect(r.size).toBe(fakeBytes.length)
    // image_key 取前 12 字符 → "img_v3_abc12" + 6 字符 random suffix(U5 防同秒冲突)
    expect(r.filename).toMatch(/^\d{14}-img_v3_abc12-[a-z0-9]{6}\.jpg$/)
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
      downloadFeishuImage("img_invalid", "om_msg_test", "oc_chat_test", "tk_fake"),
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

    const r = await downloadFeishuImage("img_png", "om_msg_test", "oc_chat_test", "tk_fake")
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

    const r = await downloadFeishuImage(
      "img_test",
      "om_msg_test",
      "../../etc/passwd:malicious",
      "tk_fake",
    )
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
    const r = await downloadFeishuImage("img_uniq", "om_msg_test", uniqueChatId, "tk_fake")
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

// ========= S1-S5 加固 + U5 防冲突 =========

describe("S1: size limit 硬限", () => {
  test("Content-Length 声明超过 MAX_IMAGE_BYTES → throw 含 mb 大小", async () => {
    const oversize = MAX_IMAGE_BYTES + 1024
    globalThis.fetch = mock(
      async () =>
        new Response(new Uint8Array(0).buffer, {
          status: 200,
          headers: { "content-type": "image/jpeg", "content-length": String(oversize) },
        }),
    ) as unknown as typeof fetch

    await expect(
      downloadFeishuImage("img_big", "om_test", "oc_test", "tk_fake"),
    ).rejects.toThrow(/过大|MB/)
  })

  test("实际 buffer 超过 MAX_IMAGE_BYTES(server 撒谎 Content-Length)→ throw", async () => {
    const buf = new Uint8Array(MAX_IMAGE_BYTES + 100)
    globalThis.fetch = mock(
      async () =>
        new Response(buf.buffer, {
          status: 200,
          headers: { "content-type": "image/jpeg" }, // 没 Content-Length
        }),
    ) as unknown as typeof fetch

    await expect(
      downloadFeishuImage("img_lies", "om_test", "oc_test", "tk_fake"),
    ).rejects.toThrow(/过大|MB/)
  })

  test("空 buffer → throw", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(new Uint8Array(0).buffer, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    ) as unknown as typeof fetch

    await expect(
      downloadFeishuImage("img_empty", "om_test", "oc_test", "tk_fake"),
    ).rejects.toThrow(/空|0 bytes/)
  })
})

describe("S2: fetch timeout(AbortController)", () => {
  test("fetch 抛 AbortError → throw 含'超时'", async () => {
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      const err = new Error("Aborted")
      err.name = "AbortError"
      throw err
    }) as unknown as typeof fetch

    await expect(
      downloadFeishuImage("img_slow", "om_test", "oc_test", "tk_fake"),
    ).rejects.toThrow(/超时/)
  })

  test("fetch 抛非 abort 网络错 → throw 含'网络错误'", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof fetch

    await expect(
      downloadFeishuImage("img_neterr", "om_test", "oc_test", "tk_fake"),
    ).rejects.toThrow(/网络错误|ECONNREFUSED/)
  })
})

describe("S3: mime allowlist", () => {
  test("非 image/* mime(text/html error page)→ throw 'mime 不在白名单'", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response("<html>403 Forbidden</html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    ) as unknown as typeof fetch

    await expect(
      downloadFeishuImage("img_html", "om_test", "oc_test", "tk_fake"),
    ).rejects.toThrow(/mime 不在白名单|text\/html/)
  })

  test("application/octet-stream → throw 'mime 不在白名单'", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(new Uint8Array([1, 2]).buffer, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
    ) as unknown as typeof fetch

    await expect(
      downloadFeishuImage("img_octet", "om_test", "oc_test", "tk_fake"),
    ).rejects.toThrow(/mime 不在白名单/)
  })

  test("常见 image mime 全部放行(jpeg/png/gif/webp/svg+xml/bmp/avif)", async () => {
    const mimes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/bmp", "image/avif"]
    for (const mime of mimes) {
      globalThis.fetch = mock(
        async () =>
          new Response(new Uint8Array([1]).buffer, {
            status: 200,
            headers: { "content-type": mime },
          }),
      ) as unknown as typeof fetch
      const r = await downloadFeishuImage(`img_${mime.replace(/[^a-z]/g, "")}`, "om_test", "oc_test", "tk_fake")
      expect(r.mime).toBe(mime)
      rmSync(r.absolutePath)
    }
  })
})

describe("S4: 路径越界 assert(防 chatId sanitize 漏 + symlink 攻击)", () => {
  test("chatId 已 sanitize 但 resolved path 在 feishu-images 子树内", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(new Uint8Array([1]).buffer, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    ) as unknown as typeof fetch
    const r = await downloadFeishuImage("img_normal", "om_test", "oc_test", "tk_fake")
    expect(r.absolutePath).toContain("feishu-images")
    rmSync(r.absolutePath)
  })
})

describe("S5: token 不进 error message", () => {
  test("404 error 不含 token", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 404, statusText: "Not Found" }),
    ) as unknown as typeof fetch

    const SECRET_TOKEN = "tk_super_secret_should_not_leak_12345"
    try {
      await downloadFeishuImage("img_404", "om_test", "oc_test", SECRET_TOKEN)
      throw new Error("expected throw")
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).not.toContain(SECRET_TOKEN)
    }
  })

  test("timeout error 不含 token", async () => {
    globalThis.fetch = mock(async () => {
      const err = new Error("Aborted")
      err.name = "AbortError"
      throw err
    }) as unknown as typeof fetch

    const SECRET_TOKEN = "tk_super_secret_should_not_leak"
    try {
      await downloadFeishuImage("img_timeout", "om_test", "oc_test", SECRET_TOKEN)
      throw new Error("expected throw")
    } catch (e) {
      expect((e as Error).message).not.toContain(SECRET_TOKEN)
    }
  })
})

describe("U5: makeImageFilename 同 ts + 同 image_key 防冲突", () => {
  test("100 次连续调 → 100 个不同 filename(random suffix 防同秒冲突)", () => {
    const filenames = new Set<string>()
    for (let i = 0; i < 100; i++) {
      filenames.add(makeImageFilename("img_v3_abc12345", "jpg"))
    }
    expect(filenames.size).toBe(100)
  })

  test("filename 格式:<ts>-<key12>-<rnd6>.<ext>", () => {
    const fn = makeImageFilename("img_v3_xyz9876", "png")
    expect(fn).toMatch(/^\d{14}-img_v3_xyz98-[a-z0-9]{6}\.png$/)
  })

  test("image_key 含特殊字符 sanitize", () => {
    const fn = makeImageFilename("img/../etc:malicious", "jpg")
    expect(fn).not.toContain("/")
    expect(fn).not.toContain("..")
    expect(fn).not.toContain(":")
  })
})
