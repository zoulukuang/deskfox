// FORK: merge-forward-flatten 纯函数单测(M1-M12)
// [feat: feishu-merge-forward] 2026-05-26

import { describe, expect, test } from "bun:test"
import {
  flattenMergeForward,
  hasAnyImage,
  MAX_IMAGE_COUNT,
  MAX_NEST_DEPTH,
  MAX_SUB_MESSAGES,
  renderSubMessage,
  sortByCreateTime,
  type SubMessage,
} from "../merge-forward-flatten"

// ============================================================
// Helper: 造子消息 fixture
// ============================================================

function txt(text: string, opts: Partial<SubMessage> = {}): SubMessage {
  return {
    message_id: opts.message_id ?? `om_text_${Math.random().toString(36).slice(2, 8)}`,
    msg_type: "text",
    body: { content: JSON.stringify({ text }) },
    sender: opts.sender ?? { id: "ou_user_default" },
    create_time: opts.create_time ?? String(Date.now()),
    upper_message_id: "om_container",
    ...opts,
  }
}

function img(imageKey: string, opts: Partial<SubMessage> = {}): SubMessage {
  return {
    message_id: opts.message_id ?? `om_img_${Math.random().toString(36).slice(2, 8)}`,
    msg_type: "image",
    body: { content: JSON.stringify({ image_key: imageKey }) },
    sender: opts.sender ?? { id: "ou_user_default" },
    create_time: opts.create_time ?? String(Date.now()),
    upper_message_id: "om_container",
    ...opts,
  }
}

function file(name: string, sizeBytes: number, opts: Partial<SubMessage> = {}): SubMessage {
  return {
    message_id: opts.message_id ?? `om_file_${Math.random().toString(36).slice(2, 8)}`,
    msg_type: "file",
    body: { content: JSON.stringify({ file_name: name, file_size: String(sizeBytes) }) },
    sender: opts.sender ?? { id: "ou_user_default" },
    create_time: opts.create_time ?? String(Date.now()),
    upper_message_id: "om_container",
    ...opts,
  }
}

function audio(durationMs: number, opts: Partial<SubMessage> = {}): SubMessage {
  return {
    message_id: `om_audio_${Math.random().toString(36).slice(2, 8)}`,
    msg_type: "audio",
    body: { content: JSON.stringify({ duration: durationMs }) },
    sender: { id: "ou_user_default" },
    create_time: String(Date.now()),
    upper_message_id: "om_container",
    ...opts,
  }
}

function video(durationMs: number, opts: Partial<SubMessage> = {}): SubMessage {
  return {
    message_id: `om_video_${Math.random().toString(36).slice(2, 8)}`,
    msg_type: "video",
    body: { content: JSON.stringify({ duration: durationMs }) },
    sender: { id: "ou_user_default" },
    create_time: String(Date.now()),
    upper_message_id: "om_container",
    ...opts,
  }
}

function sticker(opts: Partial<SubMessage> = {}): SubMessage {
  return {
    message_id: `om_sticker_${Math.random().toString(36).slice(2, 8)}`,
    msg_type: "sticker",
    body: { content: JSON.stringify({}) },
    sender: { id: "ou_user_default" },
    create_time: String(Date.now()),
    upper_message_id: "om_container",
    ...opts,
  }
}

function post(content: unknown, opts: Partial<SubMessage> = {}): SubMessage {
  return {
    message_id: `om_post_${Math.random().toString(36).slice(2, 8)}`,
    msg_type: "post",
    body: { content: JSON.stringify(content) },
    sender: { id: "ou_user_default" },
    create_time: String(Date.now()),
    upper_message_id: "om_container",
    ...opts,
  }
}

function nested(opts: Partial<SubMessage> = {}): SubMessage {
  return {
    message_id: `om_nest_${Math.random().toString(36).slice(2, 8)}`,
    msg_type: "merge_forward",
    body: { content: JSON.stringify({}) },
    sender: { id: "ou_user_default" },
    create_time: String(Date.now()),
    upper_message_id: "om_container",
    ...opts,
  }
}

const baseOpts = {
  withSender: false,
  maxSubMessages: MAX_SUB_MESSAGES,
  maxImages: MAX_IMAGE_COUNT,
  depth: 0,
}

// ============================================================
// sortByCreateTime
// ============================================================

describe("sortByCreateTime (R2)", () => {
  test("乱序 → create_time 升序", () => {
    const a = txt("a", { create_time: "3000" })
    const b = txt("b", { create_time: "1000" })
    const c = txt("c", { create_time: "2000" })
    const sorted = sortByCreateTime([a, b, c])
    expect(sorted.map((i) => JSON.parse(i.body!.content!).text)).toEqual(["b", "c", "a"])
  })

  test("不动入参(immutability)", () => {
    const items = [txt("a", { create_time: "2000" }), txt("b", { create_time: "1000" })]
    const snapshot = items.map((i) => i.create_time)
    sortByCreateTime(items)
    expect(items.map((i) => i.create_time)).toEqual(snapshot)
  })

  test("create_time 缺失 → 当 0 处理", () => {
    const a = txt("a", { create_time: undefined })
    const b = txt("b", { create_time: "1000" })
    const sorted = sortByCreateTime([b, a])
    expect(sorted[0]).toBe(a) // 0 < 1000
  })
})

// ============================================================
// M1-M12 主测
// ============================================================

describe("M1 — 5 条 text 子消息(p2p 无 sender)", () => {
  test("flatten 5 行,无 sender 前缀,images=[]", () => {
    const items = [
      txt("一", { create_time: "100" }),
      txt("二", { create_time: "200" }),
      txt("三", { create_time: "300" }),
      txt("四", { create_time: "400" }),
      txt("五", { create_time: "500" }),
    ]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("一\n二\n三\n四\n五")
    expect(r.images).toEqual([])
  })
})

describe("M2 — 5 条 text 群聊带 sender", () => {
  test("每行 `[sender_6位]: text` 前缀", () => {
    const items = [
      txt("hi", { sender: { id: "ou_alice123" }, create_time: "100" }),
      txt("hello", { sender: { id: "ou_bob_456" }, create_time: "200" }),
    ]
    const r = flattenMergeForward(items, { ...baseOpts, withSender: true })
    expect(r.text).toBe("[ou_ali]: hi\n[ou_bob]: hello")
  })

  test("sender id 缺失 → '未知'", () => {
    const items = [txt("anon", { sender: undefined })]
    const r = flattenMergeForward(items, { ...baseOpts, withSender: true })
    expect(r.text).toBe("[未知]: anon")
  })
})

describe("M3 — 1 张 image", () => {
  test("text 占位 `[图片(已展开识别)]`,images=[1]", () => {
    const items = [img("img_v3_aaa")]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("[图片(已展开识别)]")
    expect(r.images).toHaveLength(1)
    expect(r.images[0]).toMatchObject({ imageKey: "img_v3_aaa", indexInForward: 1 })
    expect(r.images[0]!.subMessageId).toMatch(/^om_img_/)
  })
})

describe("M4 — 7 张 image 超 MAX=5", () => {
  test("前 5 张展开 images=[5];6/7 占位 `[图 N(未展开)]`", () => {
    const items = Array.from({ length: 7 }, (_, i) =>
      img(`img_v3_${i + 1}`, { create_time: String(100 + i) }),
    )
    const r = flattenMergeForward(items, baseOpts)
    const lines = r.text.split("\n")
    expect(lines).toHaveLength(7)
    // 前 5 行展开占位
    for (let i = 0; i < 5; i++) {
      expect(lines[i]).toBe("[图片(已展开识别)]")
    }
    // 6 7 占位序号 6 / 7
    expect(lines[5]).toBe("[图 6(未展开)]")
    expect(lines[6]).toBe("[图 7(未展开)]")
    expect(r.images).toHaveLength(5)
    expect(r.images.map((i) => i.imageKey)).toEqual([
      "img_v3_1",
      "img_v3_2",
      "img_v3_3",
      "img_v3_4",
      "img_v3_5",
    ])
  })
})

describe("M5 — text/image/file/audio/video/sticker 混合", () => {
  test("每条对应中文占位 + 元信息", () => {
    const items = [
      txt("你好", { create_time: "100" }),
      img("img_x", { create_time: "200" }),
      file("月报.docx", 1_200_000, { create_time: "300" }),
      audio(12_000, { create_time: "400" }), // 12s
      video(30_000, { create_time: "500" }), // 30s
      sticker({ create_time: "600" }),
    ]
    const r = flattenMergeForward(items, baseOpts)
    const lines = r.text.split("\n")
    expect(lines[0]).toBe("你好")
    expect(lines[1]).toBe("[图片(已展开识别)]")
    expect(lines[2]).toBe("[文件: 月报.docx 1.1MB]")
    expect(lines[3]).toBe("[语音 12s]")
    expect(lines[4]).toBe("[视频 30s]")
    expect(lines[5]).toBe("[表情]")
  })
})

describe("M6 — textOnly(maxImages=0)", () => {
  test("即使有 image,images=[];text 占位 `[图 N(未展开)]`", () => {
    const items = [
      txt("看图", { create_time: "100" }),
      img("img_x", { create_time: "200" }),
      img("img_y", { create_time: "300" }),
    ]
    const r = flattenMergeForward(items, { ...baseOpts, maxImages: 0 })
    expect(r.images).toEqual([])
    // [feat: feishu-merge-forward-image-400] 不下载(images=[])但仍计数 → 回复头部据此提示"有 N 张图读不了"
    expect(r.imageCount).toBe(2)
    const lines = r.text.split("\n")
    expect(lines[0]).toBe("看图")
    expect(lines[1]).toBe("[图 1(未展开)]")
    expect(lines[2]).toBe("[图 2(未展开)]")
  })
})

describe("M7 — 60 条混合截断到 50", () => {
  test("text 末尾 `... 还有 10 条未显示`", () => {
    const items = Array.from({ length: 60 }, (_, i) =>
      txt(`msg-${i + 1}`, { create_time: String(1000 + i) }),
    )
    const r = flattenMergeForward(items, baseOpts)
    const lines = r.text.split("\n")
    expect(lines).toHaveLength(51) // 50 + 末尾省略
    expect(lines[0]).toBe("msg-1")
    expect(lines[49]).toBe("msg-50")
    expect(lines[50]).toBe("... 还有 10 条未显示")
  })

  test("50 条恰好 → 无省略", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      txt(`msg-${i + 1}`, { create_time: String(1000 + i) }),
    )
    const r = flattenMergeForward(items, baseOpts)
    const lines = r.text.split("\n")
    expect(lines).toHaveLength(50)
    expect(lines).not.toContain("... 还有 0 条未显示")
  })
})

describe("M8 — items 乱序传入", () => {
  test("sort 后 text 时间顺序正确", () => {
    const items = [
      txt("第三", { create_time: "300" }),
      txt("第一", { create_time: "100" }),
      txt("第二", { create_time: "200" }),
    ]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("第一\n第二\n第三")
  })
})

describe("M9 — 嵌套 merge_forward", () => {
  test("depth=0 → 占位 '[嵌套合并消息(展开中)]'(pipeline 层会真递归)", () => {
    const items = [txt("hi", { create_time: "100" }), nested({ create_time: "200" })]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("hi\n[嵌套合并消息(展开中)]")
  })

  test("depth=MAX_NEST_DEPTH(1)→ 占位 '深度超限'", () => {
    const items = [nested()]
    const r = flattenMergeForward(items, { ...baseOpts, depth: MAX_NEST_DEPTH })
    expect(r.text).toBe("[嵌套合并消息(深度超限)]")
  })

  test("depth=2 → 占位 '深度超限'", () => {
    const items = [nested()]
    const r = flattenMergeForward(items, { ...baseOpts, depth: 2 })
    expect(r.text).toBe("[嵌套合并消息(深度超限)]")
  })
})

describe("M10 — post msg_type(图文混合)", () => {
  test("post 含 text + image_key → 提 textContent + 占位 '[图片(已展开识别)]'", () => {
    const items = [
      post({
        title: "Bug 报告",
        content: [[{ tag: "text", text: "崩了" }, { tag: "img", image_key: "img_post_a" }]],
      }),
    ]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("Bug 报告 崩了 [图片(已展开识别)]")
    expect(r.images).toHaveLength(1)
    expect(r.images[0]!.imageKey).toBe("img_post_a")
  })

  test("post 纯文字(无 image)→ 不占图配额", () => {
    const items = [post({ content: [[{ tag: "text", text: "hello" }]] })]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("hello")
    expect(r.images).toEqual([])
  })

  test("post 内容空 / 畸形 → 占位 '[富文本]'", () => {
    const items = [post({})]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("[富文本]")
  })

  test("post 跟 image 一起占图配额(text 占 1 + image 占 1 = 2 配额)", () => {
    const items = [
      post({
        content: [[{ tag: "text", text: "看" }, { tag: "img", image_key: "post_img" }]],
      }),
      img("img_pure", { create_time: String(Date.now() + 100) }),
    ]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.images).toHaveLength(2)
    expect(r.images[0]!.imageKey).toBe("post_img")
    expect(r.images[1]!.imageKey).toBe("img_pure")
  })
})

describe("M11 — share_chat / share_user / 未知 msg_type", () => {
  test("share_chat 带 chat_id 简显", () => {
    const items = [
      {
        message_id: "om_a",
        msg_type: "share_chat",
        body: { content: JSON.stringify({ chat_id: "oc_abcdef12345" }) },
        sender: { id: "ou_user" },
        create_time: "100",
        upper_message_id: "om_container",
      },
    ]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("[分享: 群 oc_abcde]")
  })

  test("share_user 带 user_id 简显", () => {
    const items = [
      {
        message_id: "om_a",
        msg_type: "share_user",
        body: { content: JSON.stringify({ user_id: "ou_target_x" }) },
        sender: { id: "ou_user" },
        create_time: "100",
        upper_message_id: "om_container",
      },
    ]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("[分享: 用户 ou_tar]")
  })

  test("未知 msg_type 友好占位", () => {
    const items = [
      {
        message_id: "om_a",
        msg_type: "interactive_card",
        body: { content: JSON.stringify({}) },
        sender: { id: "ou_user" },
        create_time: "100",
        upper_message_id: "om_container",
      },
    ]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("[未知消息类型: interactive_card]")
  })

  test("text 内容 invalid JSON → '[文本解析失败]'", () => {
    const items: SubMessage[] = [
      {
        message_id: "om_a",
        msg_type: "text",
        body: { content: "{bad json" },
        sender: { id: "ou_user" },
        create_time: "100",
        upper_message_id: "om_container",
      },
    ]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("[文本解析失败]")
  })
})

describe("M12 — 边界 0 items / 单个 unknown", () => {
  test("0 items → text='', images=[]", () => {
    const r = flattenMergeForward([], baseOpts)
    expect(r.text).toBe("")
    expect(r.images).toEqual([])
  })

  test("file 无 file_name 字段 → '[文件: 未命名]'", () => {
    const items: SubMessage[] = [
      {
        message_id: "om_a",
        msg_type: "file",
        body: { content: JSON.stringify({}) },
        sender: { id: "ou_user" },
        create_time: "100",
        upper_message_id: "om_container",
      },
    ]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("[文件: 未命名]")
  })

  test("audio 0 duration → '[语音]'(无时长)", () => {
    const items = [audio(0)]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toBe("[语音]")
  })
})

// ============================================================
// hasAnyImage
// ============================================================

describe("hasAnyImage", () => {
  test("纯文本 → false", () => {
    expect(hasAnyImage([txt("a"), txt("b")])).toBe(false)
  })

  test("含 image → true", () => {
    expect(hasAnyImage([txt("a"), img("img_x")])).toBe(true)
  })

  test("post 含 image_key → true", () => {
    const items = [post({ content: [[{ tag: "img", image_key: "post_img" }]] })]
    expect(hasAnyImage(items)).toBe(true)
  })

  test("post 纯文本 → false", () => {
    const items = [post({ content: [[{ tag: "text", text: "hi" }]] })]
    expect(hasAnyImage(items)).toBe(false)
  })

  test("image msg 缺 image_key → false", () => {
    const items: SubMessage[] = [
      {
        message_id: "om_a",
        msg_type: "image",
        body: { content: JSON.stringify({}) },
        sender: { id: "ou_user" },
        create_time: "100",
        upper_message_id: "om_container",
      },
    ]
    expect(hasAnyImage(items)).toBe(false)
  })

  test("嵌套 merge_forward 占位本身不算图", () => {
    expect(hasAnyImage([nested()])).toBe(false)
  })
})

// ============================================================
// renderSubMessage 直接 unit(覆盖 helper)
// ============================================================

describe("renderSubMessage 直接覆盖", () => {
  test("withSender=true 加 prefix", () => {
    const line = renderSubMessage(
      txt("hello", { sender: { id: "ou_abcdef_long" } }),
      true,
      false,
      0,
      0,
    )
    expect(line).toBe("[ou_abc]: hello")
  })

  test("withSender=false 不加 prefix", () => {
    const line = renderSubMessage(txt("hello"), false, false, 0, 0)
    expect(line).toBe("hello")
  })

  test("image imageRendered=true → '[图片(已展开识别)]'", () => {
    const line = renderSubMessage(img("img_x"), false, true, 1, 0)
    expect(line).toBe("[图片(已展开识别)]")
  })

  test("image imageRendered=false → '[图 N(未展开)]'", () => {
    const line = renderSubMessage(img("img_x"), false, false, 3, 0)
    expect(line).toBe("[图 3(未展开)]")
  })
})
