// FORK: merge-forward-fetcher 单测(F1-F5)
// [feat: feishu-merge-forward] 2026-05-26

import { describe, expect, test } from "bun:test"
import { fetchMergeForwardItems } from "../merge-forward-fetcher"

// 造 fake larkClient(只需要 im.v1.message.get 函数)
function fakeClient(getImpl: (path: { path: { message_id: string } }) => Promise<unknown>) {
  return {
    im: { v1: { message: { get: getImpl } } },
  } as unknown as Parameters<typeof fetchMergeForwardItems>[1]
}

describe("F1 — SDK 返 N items 含容器 + N-1 子消息", () => {
  test("filter upper_message_id 返子消息", async () => {
    const client = fakeClient(async () => ({
      data: {
        items: [
          // 容器(无 upper_message_id)
          { message_id: "om_container", msg_type: "merge_forward" },
          // 子消息(有 upper_message_id)
          {
            message_id: "om_sub_1",
            msg_type: "text",
            upper_message_id: "om_container",
            body: { content: JSON.stringify({ text: "hi" }) },
          },
          {
            message_id: "om_sub_2",
            msg_type: "image",
            upper_message_id: "om_container",
            body: { content: JSON.stringify({ image_key: "img_x" }) },
          },
        ],
      },
    }))
    const items = await fetchMergeForwardItems("om_container", client)
    expect(items).toHaveLength(2)
    expect(items[0]!.message_id).toBe("om_sub_1")
    expect(items[1]!.message_id).toBe("om_sub_2")
  })
})

describe("F2 — SDK 返空 items", () => {
  test("data.items=[] → 返 []", async () => {
    const client = fakeClient(async () => ({ data: { items: [] } }))
    const items = await fetchMergeForwardItems("om_x", client)
    expect(items).toEqual([])
  })

  test("data 缺失 → 返 []", async () => {
    const client = fakeClient(async () => ({}))
    const items = await fetchMergeForwardItems("om_x", client)
    expect(items).toEqual([])
  })

  test("只容器无子消息 → 返 []", async () => {
    const client = fakeClient(async () => ({
      data: { items: [{ message_id: "om_container", msg_type: "merge_forward" }] },
    }))
    const items = await fetchMergeForwardItems("om_container", client)
    expect(items).toEqual([])
  })
})

describe("F3 — SDK 抛 error", () => {
  test("SDK reject → 包装 + 含 messageId", async () => {
    const client = fakeClient(async () => {
      throw new Error("Network ECONNREFUSED")
    })
    await expect(fetchMergeForwardItems("om_neterror", client)).rejects.toThrow(
      /merge_forward 拉取失败.*om_neterror.*ECONNREFUSED/,
    )
  })

  test("SDK 返业务错(code != 0)→ 抛业务错", async () => {
    const client = fakeClient(async () => ({
      code: 230006,
      msg: "message not found",
    }))
    await expect(fetchMergeForwardItems("om_notfound", client)).rejects.toThrow(
      /merge_forward 拉取业务错 code=230006 msg=message not found.*om_notfound/,
    )
  })

  test("SDK 返 null / 非对象 → 抛响应非法", async () => {
    const client = fakeClient(async () => null)
    await expect(fetchMergeForwardItems("om_null", client)).rejects.toThrow(
      /merge_forward 拉取响应非法.*om_null/,
    )
  })
})

describe("F4 — timeout(R1)", () => {
  test("SDK 拖 > timeoutMs → '超时' error", async () => {
    const client = fakeClient(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    )
    await expect(fetchMergeForwardItems("om_slow", client, 100)).rejects.toThrow(
      /merge_forward 拉取超时 \(100ms\) for message_id=om_slow/,
    )
  })

  test("SDK 在 timeoutMs 内 resolve → 正常", async () => {
    const client = fakeClient(
      async () =>
        new Promise<unknown>((resolve) => {
          setTimeout(
            () =>
              resolve({
                data: {
                  items: [
                    {
                      message_id: "om_sub",
                      msg_type: "text",
                      upper_message_id: "om_c",
                      body: { content: "{}" },
                    },
                  ],
                },
              }),
            10,
          )
        }),
    )
    const items = await fetchMergeForwardItems("om_fast", client, 500)
    expect(items).toHaveLength(1)
  })
})

describe("F5 — 边界:upper_message_id 是空字符串 / undefined", () => {
  test("upper_message_id=空字符串 → 不算子消息", async () => {
    const client = fakeClient(async () => ({
      data: {
        items: [
          { message_id: "om_1", upper_message_id: "" },
          { message_id: "om_2", upper_message_id: "om_c" },
        ],
      },
    }))
    const items = await fetchMergeForwardItems("om_c", client)
    expect(items).toHaveLength(1)
    expect(items[0]!.message_id).toBe("om_2")
  })

  test("upper_message_id 缺失 → 不算子消息", async () => {
    const client = fakeClient(async () => ({
      data: {
        items: [
          { message_id: "om_1" /* no upper_message_id */ },
          { message_id: "om_2", upper_message_id: "om_c" },
        ],
      },
    }))
    const items = await fetchMergeForwardItems("om_c", client)
    expect(items).toHaveLength(1)
    expect(items[0]!.message_id).toBe("om_2")
  })
})
