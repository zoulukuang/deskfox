// FORK: 飞书 merge_forward 子消息拉取
// [feat: feishu-merge-forward] 2026-05-26
//
// 拉 merge_forward 容器的子消息列表:
//   - SDK `client.im.v1.message.get({ path: { message_id }})`
//   - response.data.items 数组 = 1 个容器 + N 个子消息
//   - filter `upper_message_id` 提子消息(容器本身 `upper_message_id` undefined)
//   - 30s timeout 兜底(R1)
//   - 失败抛 Error 含可读原因(R3 caller 转友好 reply)
//
// 走 SDK 不是 Bun-native fetch:get_message 普通 JSON 0 multipart 0 撞 axios + form-data
// 链(`feishu-attach-upload-robustness` 那条只对 multipart upload),get 历史稳定。
// 如果实测撞坑再换 Bun-native(fallback 留 backlog)。

import type { Client } from "@larksuiteoapi/node-sdk"
import type { SubMessage } from "./merge-forward-flatten"

export const FETCH_TIMEOUT_MS = 30_000

/** SDK get_message 返回结构(只声明本 fetcher 用到的字段) */
interface GetMessageResponse {
  data?: {
    items?: SubMessage[]
  }
  code?: number
  msg?: string
}

/**
 * 拉 merge_forward 容器的子消息列表。
 *
 * @returns 子消息数组(按 SDK 返回顺序,caller 用 `sortByCreateTime` 排序;0 子消息时返 [])
 * @throws Error 含 messageId / 原因(超时 / API 错 / 网络错)
 */
export async function fetchMergeForwardItems(
  messageId: string,
  larkClient: Client,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<SubMessage[]> {
  // SDK 不原生支持 AbortController,用 Promise.race 兜底超时
  // 注意:Promise.race 时 SDK 内部请求仍在跑(无法真 cancel),只是我们停等;
  // 实际飞书 API 超时约定 30s,超过基本是网络问题/server 异常,不会无限挂。
  const timeoutPromise = new Promise<never>((_, reject) => {
    const handle = setTimeout(() => {
      reject(new Error(`飞书 merge_forward 拉取超时 (${timeoutMs}ms) for message_id=${messageId}`))
    }, timeoutMs)
    // 防 timer leak — caller race resolve 时 handle 仍在,需 unref(Node)/ ignore(Bun)
    if (typeof (handle as { unref?: () => void }).unref === "function") {
      ;(handle as { unref: () => void }).unref()
    }
  })

  let response: GetMessageResponse
  try {
    response = (await Promise.race([
      larkClient.im.v1.message.get({
        path: { message_id: messageId },
      }),
      timeoutPromise,
    ])) as GetMessageResponse
  } catch (err) {
    // 超时(我们抛的)或 SDK 内部错(API 错 / 网络错 / 401 等)
    if ((err as Error).message?.includes("超时")) {
      throw err
    }
    throw new Error(
      `飞书 merge_forward 拉取失败 for message_id=${messageId}: ${(err as Error).message ?? err}`,
    )
  }

  if (!response || typeof response !== "object") {
    throw new Error(`飞书 merge_forward 拉取响应非法 for message_id=${messageId}: 非对象`)
  }

  // 飞书 API 错误码非 0 时:code/msg 字段会被 SDK 透传到顶层
  if (response.code !== undefined && response.code !== 0) {
    throw new Error(
      `飞书 merge_forward 拉取业务错 code=${response.code} msg=${response.msg ?? "unknown"} for message_id=${messageId}`,
    )
  }

  const items = response.data?.items ?? []
  // filter `upper_message_id` 提子消息(容器本身没这字段)
  return items.filter((i) => typeof i.upper_message_id === "string" && i.upper_message_id !== "")
}
