// FORK: parseMessageContent 单测(U1)
// [feat: feishu-image-recognition] 2026-05-26
//
// 覆盖 text / image / post 三种 messageType,以及 post 的 5 个 edge case
// (空 content / 多图 / 嵌套段 / title-only / 多段 paragraph 多 text 拼接)

import { describe, expect, test } from "bun:test"
import {
  extractVisionSupport,
  isVisionCacheFresh,
  parseMessageContent,
  VISION_CAP_TTL_MS,
} from "../message-pipeline"

describe("parseMessageContent: text", () => {
  test("basic text → { text, imageKey:null }", () => {
    const r = parseMessageContent("text", JSON.stringify({ text: "你好" }))
    expect(r).toEqual({ text: "你好", imageKey: null })
  })

  test("trim spaces", () => {
    const r = parseMessageContent("text", JSON.stringify({ text: "  hello  " }))
    expect(r.text).toBe("hello")
  })

  test("empty text → ''", () => {
    const r = parseMessageContent("text", JSON.stringify({ text: "" }))
    expect(r.text).toBe("")
  })

  test("missing text field → ''", () => {
    const r = parseMessageContent("text", JSON.stringify({}))
    expect(r.text).toBe("")
  })

  test("invalid JSON → throw SyntaxError", () => {
    expect(() => parseMessageContent("text", "{bad json")).toThrow()
  })
})

describe("parseMessageContent: image", () => {
  test("basic image_key", () => {
    const r = parseMessageContent("image", JSON.stringify({ image_key: "img_v3_abc" }))
    expect(r).toEqual({ text: "", imageKey: "img_v3_abc" })
  })

  test("image + caption(飞书偶尔 image event 带 text)", () => {
    const r = parseMessageContent(
      "image",
      JSON.stringify({ image_key: "img_v3_abc", text: "看这张" }),
    )
    expect(r).toEqual({ text: "看这张", imageKey: "img_v3_abc" })
  })

  test("missing image_key → imageKey:null", () => {
    const r = parseMessageContent("image", JSON.stringify({}))
    expect(r.imageKey).toBeNull()
  })
})

// ========= U1 post edge cases(图文混合) =========

describe("parseMessageContent: post(U1 edge cases)", () => {
  test("U1.1 标准 post 1 段 1 text + 1 img → 拼 text + 取 image_key", () => {
    const content = JSON.stringify({
      content: [
        [
          { tag: "text", text: "图里说啥?" },
          { tag: "img", image_key: "img_v3_001" },
        ],
      ],
    })
    const r = parseMessageContent("post", content)
    expect(r.imageKey).toBe("img_v3_001")
    expect(r.text).toContain("图里说啥?")
  })

  test("U1.2 多段 paragraph 多 text 段 → 全部 join 空格", () => {
    const content = JSON.stringify({
      content: [
        [{ tag: "text", text: "第一段" }],
        [{ tag: "text", text: "第二段" }, { tag: "text", text: "第三段" }],
      ],
    })
    const r = parseMessageContent("post", content)
    expect(r.text).toBe("第一段 第二段 第三段")
    expect(r.imageKey).toBeNull()
  })

  test("U1.3 多图 → 只取首张 image_key", () => {
    const content = JSON.stringify({
      content: [
        [
          { tag: "img", image_key: "img_v3_first" },
          { tag: "img", image_key: "img_v3_second" },
          { tag: "image", image_key: "img_v3_third" }, // 兼容 "image" 标签
        ],
      ],
    })
    const r = parseMessageContent("post", content)
    expect(r.imageKey).toBe("img_v3_first")
  })

  test("U1.4 title-only(无 content)→ text=title, imageKey=null", () => {
    const content = JSON.stringify({ title: "标题" })
    const r = parseMessageContent("post", content)
    expect(r.text).toBe("标题")
    expect(r.imageKey).toBeNull()
  })

  test("U1.5 空 content → text='', imageKey=null", () => {
    const r = parseMessageContent("post", JSON.stringify({ content: [] }))
    expect(r.text).toBe("")
    expect(r.imageKey).toBeNull()
  })

  test("U1.6 嵌套 at-user / link / 等其它 tag → ignore,只 text+img 段生效", () => {
    const content = JSON.stringify({
      content: [
        [
          { tag: "at", user_id: "ou_xxx" },
          { tag: "text", text: "你好" },
          { tag: "a", text: "link", href: "https://x.com" },
          { tag: "img", image_key: "img_kept" },
        ],
      ],
    })
    const r = parseMessageContent("post", content)
    expect(r.text).toBe("你好")
    expect(r.imageKey).toBe("img_kept")
  })

  test("U1.7 title + content 都有 → title 拼在 text 最前", () => {
    const content = JSON.stringify({
      title: "Bug 报告",
      content: [[{ tag: "text", text: "崩溃了" }, { tag: "img", image_key: "img_v3_bug" }]],
    })
    const r = parseMessageContent("post", content)
    expect(r.text).toBe("Bug 报告 崩溃了")
    expect(r.imageKey).toBe("img_v3_bug")
  })

  test("U1.8 malformed segment(非 object / null / 缺 tag)→ skip 不抛", () => {
    const content = JSON.stringify({
      content: [
        [
          null,
          "not an object",
          { /* no tag */ text: "ghost" },
          { tag: "text", text: "ok" },
        ],
      ],
    })
    const r = parseMessageContent("post", content)
    expect(r.text).toBe("ok")
  })

  test("U1.9 非数组 content(畸形 shape)→ skip 兜底", () => {
    const r = parseMessageContent("post", JSON.stringify({ content: "not array" }))
    expect(r.text).toBe("")
    expect(r.imageKey).toBeNull()
  })
})

describe("parseMessageContent: 其它 messageType 兜底", () => {
  test("file/audio/video/etc → 返默认空值(caller 应已先 skip)", () => {
    const r = parseMessageContent("file", JSON.stringify({ file_key: "abc" }))
    expect(r).toEqual({ text: "", imageKey: null })
  })
})

// ============================================================
// U2/U3/U4 vision capability 检测 — helper extract 后单测覆盖
// ============================================================

describe("extractVisionSupport (U2/U4)", () => {
  test("U2.1 model 声明 image=true → 返 true", () => {
    const data = {
      providers: [
        {
          id: "claude-code",
          models: {
            sonnet: { capabilities: { input: { image: true } } },
          },
        },
      ],
    }
    expect(extractVisionSupport(data, "claude-code", "sonnet")).toBe(true)
  })

  test("U2.2 model 声明 image=false → 返 false", () => {
    const data = {
      providers: [
        {
          id: "claude-code",
          models: { haiku: { capabilities: { input: { image: false } } } },
        },
      ],
    }
    expect(extractVisionSupport(data, "claude-code", "haiku")).toBe(false)
  })

  test("U2.3 model 缺 capabilities 字段 → 返 false(明确不支持)", () => {
    const data = {
      providers: [{ id: "anthropic", models: { "claude-3-haiku": {} } }],
    }
    expect(extractVisionSupport(data, "anthropic", "claude-3-haiku")).toBe(false)
  })

  test("U2.4 providers 数组里没 providerID → 返 false", () => {
    const data = {
      providers: [
        {
          id: "openai",
          models: { "gpt-4o": { capabilities: { input: { image: true } } } },
        },
      ],
    }
    expect(extractVisionSupport(data, "anthropic", "claude-sonnet")).toBe(false)
  })

  test("U2.5 provider 有但 modelID 不在 models map → 返 false", () => {
    const data = {
      providers: [
        {
          id: "openai",
          models: { "gpt-4o": { capabilities: { input: { image: true } } } },
        },
      ],
    }
    expect(extractVisionSupport(data, "openai", "gpt-3.5-turbo")).toBe(false)
  })

  test("U3.1 response data=undefined(API 失败 / 返空)→ 默认 true 放行", () => {
    expect(extractVisionSupport(undefined, "openai", "gpt-4o")).toBe(true)
  })

  test("U3.2 response data=null → 默认 true 放行", () => {
    expect(extractVisionSupport(null, "openai", "gpt-4o")).toBe(true)
  })

  test("U3.3 response data shape 不对(无 providers 字段)→ 默认 true 放行", () => {
    expect(extractVisionSupport({}, "openai", "gpt-4o")).toBe(true)
    expect(extractVisionSupport({ providers: null }, "openai", "gpt-4o")).toBe(true)
  })

  test("U4 不同 providerID 同 modelID 互不污染(cache key 应区分 provider)", () => {
    // 验 extract 阶段 — cache key 由 caller 拼 `${providerID}/${modelID}` 保证隔离
    const data = {
      providers: [
        { id: "p1", models: { m: { capabilities: { input: { image: true } } } } },
        { id: "p2", models: { m: { capabilities: { input: { image: false } } } } },
      ],
    }
    expect(extractVisionSupport(data, "p1", "m")).toBe(true)
    expect(extractVisionSupport(data, "p2", "m")).toBe(false)
  })
})

describe("isVisionCacheFresh (U2 TTL)", () => {
  test("undefined entry → false", () => {
    expect(isVisionCacheFresh(undefined)).toBe(false)
  })

  test("entry 刚写入(now=checkedAt)→ fresh", () => {
    const now = 1_000_000_000
    expect(isVisionCacheFresh({ checkedAt: now }, now)).toBe(true)
  })

  test("TTL 边界正好相等 → stale(>= 不算 fresh)", () => {
    const now = 1_000_000_000
    expect(
      isVisionCacheFresh({ checkedAt: now - VISION_CAP_TTL_MS }, now),
    ).toBe(false)
  })

  test("TTL 内(差 5 min)→ fresh", () => {
    const now = 1_000_000_000
    const fiveMinAgo = now - 5 * 60 * 1000
    expect(isVisionCacheFresh({ checkedAt: fiveMinAgo }, now)).toBe(true)
  })

  test("TTL 外(差 11 min)→ stale", () => {
    const now = 1_000_000_000
    const elevenMinAgo = now - 11 * 60 * 1000
    expect(isVisionCacheFresh({ checkedAt: elevenMinAgo }, now)).toBe(false)
  })

  test("自定义 TTL 参数 override", () => {
    const now = 1_000_000_000
    // 1 min TTL,30s 前 cache → fresh
    expect(
      isVisionCacheFresh({ checkedAt: now - 30_000 }, now, 60_000),
    ).toBe(true)
    // 1 min TTL,2 min 前 cache → stale
    expect(
      isVisionCacheFresh({ checkedAt: now - 120_000 }, now, 60_000),
    ).toBe(false)
  })
})
