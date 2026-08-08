// [fork-only] REQ-099 托盘三态图标差异化断言 [feat: tray-health-status] 2026-08-07
//
// 起源:branding/src/assets/tray-icons/ 里 default/connected/offline/error 四个 PNG 的 md5
// 完全相同(同一张占位图),"四状态图标"名存实亡。本测试把"三态必须真的不一样"变成机器约束。
//
// ⚠️ 关键在【mac template 模式】:tray.ts 对 darwin 调 setTemplateImage(true),系统只用 alpha、
// 颜色全丢。所以徽标若靠颜色区分(如白色感叹号),restarting 与 gave-up 会产出同一张图。
// 这里除了比对文件 md5,还单独比对【alpha 通道】,直接覆盖 template 的实际取用方式。
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { inflateSync } from "node:zlib"

const STATES = ["ok", "restarting", "gave-up"] as const
const MODES = ["color", "template"] as const
const DIR = join(import.meta.dir, "../src/assets/tray-icons/status")

const md5 = (buf: Uint8Array) => createHash("md5").update(buf).digest("hex")
const png = (state: string, mode: string) => readFileSync(join(DIR, `${state}-${mode}.png`))

/** 极简 PNG 解码:取 IHDR 尺寸 + 逐像素 alpha(仅支持本脚本产出的 8-bit RGBA / color type 6)。 */
function alphaDigest(buf: Buffer): string {
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  const bitDepth = buf[24]
  const colorType = buf[25]
  expect({ bitDepth, colorType }).toEqual({ bitDepth: 8, colorType: 6 })

  // 收集 IDAT → inflate → 逐行去 filter → 取 alpha
  const chunks: Buffer[] = []
  let offset = 8
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii")
    if (type === "IDAT") chunks.push(buf.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(chunks)) // IDAT 是 zlib 包装(非裸 deflate)

  const bpp = 4
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0
      let value = line[x]
      switch (filter) {
        case 0:
          break
        case 1:
          value += a
          break
        case 2:
          value += b
          break
        case 3:
          value += Math.floor((a + b) / 2)
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
        default:
          throw new Error(`unsupported PNG filter ${filter}`)
      }
      out[y * stride + x] = value & 0xff
    }
  }
  const alpha = Buffer.alloc(width * height)
  for (let i = 0; i < width * height; i++) alpha[i] = out[i * bpp + 3]
  return md5(alpha)
}

describe("托盘三态图标(REQ-099)", () => {
  test("六个产物文件都存在且是 32x32 PNG", () => {
    for (const mode of MODES) {
      for (const state of STATES) {
        const buf = png(state, mode)
        expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG")
        expect(buf.readUInt32BE(16)).toBe(32)
        expect(buf.readUInt32BE(20)).toBe(32)
      }
    }
  })

  test("T4:彩色三态 md5 互不相同", () => {
    const digests = STATES.map((s) => md5(png(s, "color")))
    expect(new Set(digests).size).toBe(3)
  })

  test("T5:mac template 三态 md5 互不相同(防「四张同一图」重演)", () => {
    const digests = STATES.map((s) => md5(png(s, "template")))
    expect(new Set(digests).size).toBe(3)
  })

  test("T5':mac template 三态 alpha 通道互不相同(徽标必须挖洞,靠颜色分辨在 template 下无效)", () => {
    const digests = STATES.map((s) => alphaDigest(png(s, "template")))
    expect(new Set(digests).size).toBe(3)
  })

  test("生成物与 desktop 内联常量一致(改了 PNG 忘重生成 TS 会被抓)", async () => {
    const generated = await import("../../desktop/src/main/deskfox/tray-icons.generated")
    for (const state of STATES) {
      expect(generated.TRAY_ICON_COLOR_BASE64[state]).toBe(png(state, "color").toString("base64"))
      expect(generated.TRAY_ICON_MAC_TEMPLATE_BASE64[state]).toBe(png(state, "template").toString("base64"))
    }
  })
})
