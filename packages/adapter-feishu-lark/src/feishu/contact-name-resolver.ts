// [fork-only] 飞书 open_id → 真实昵称 解析底座
// [feat: feishu-desktop-session-sync REQ-055 + REQ-073-⑥] 2026-07-06
//
// 消费面:
//   - REQ-055 合并转发子消息 sender 昵称(merge-forward-flatten senderTag)
//   - REQ-073-⑥ 群 session 发送者昵称
//
// 端点(2026-07-06 真机凭证实测钉死,投资CFO 账号):
//   - 正确:GET /open-apis/contact/v3/users/batch?user_ids=…&user_id_type=open_id(批量 ≤50),取 `name`
//   - 反例:batch_get_id 是**反向接口**(email/mobile→id,需 contact:user.id:readonly),做不了 open_id→昵称
//
// 权限:需 Bot 开通 `contact:user.base:readonly`。**未开通时飞书返 code=0 但 name 字段被门控挡空**
//   → 本函数只在 name 非空时入表,caller 一律 graceful 回落 open_id 前缀,故缺 scope 也不报错。
//   同理「不在应用可用范围内的成员」也查不到 name → 同样回落。
//
// 实现:SDK 这个构建不暴露 contact 模块,复用既有模式(file-uploader.getClientAuthContext
//   拿 tokenManager 缓存的 tenant_access_token + domain)+ Bun-native fetch 打 raw 端点。

import type { Client } from "@larksuiteoapi/node-sdk"
import { getClientAuthContext } from "./file-uploader"

/** 飞书通讯录批量接口单次上限 */
const BATCH_SIZE = 50

/**
 * 批量解析 open_id → 真实昵称。
 *
 * 全程 graceful:取 token 失败 / 某批请求失败 / code≠0 / name 为空,均**跳过该条**(不抛),
 * 让 caller 回落到 open_id 前缀。返回的 Map 只含**成功解析到非空 name** 的条目。
 */
export async function resolveOpenIdNames(
  openIds: readonly string[],
  client: Client,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const unique = [...new Set(openIds.filter((id) => !!id))]
  if (unique.length === 0) return result

  let auth: { token: string; domain: string }
  try {
    auth = await getClientAuthContext(client)
  } catch (err) {
    console.warn(
      `[contact-name-resolver] 取 token 失败,全部回落 open_id 前缀:`,
      (err as Error).message,
    )
    return result
  }

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const chunk = unique.slice(i, i + BATCH_SIZE)
    const params = new URLSearchParams()
    for (const id of chunk) params.append("user_ids", id)
    params.set("user_id_type", "open_id")
    const url = `${auth.domain}/open-apis/contact/v3/users/batch?${params.toString()}`
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.token}` },
      })
      const json = (await res.json()) as {
        code?: number
        msg?: string
        data?: { items?: Array<{ open_id?: string; name?: string }> }
      }
      if (json.code !== 0) {
        // 最常见:code=99991672 缺 contact:user.base:readonly → 该批回落前缀
        console.warn(
          `[contact-name-resolver] batch code=${json.code} msg=${json.msg ?? "?"} — 该批回落前缀`,
        )
        continue
      }
      for (const item of json.data?.items ?? []) {
        // name 非空才入表:缺 scope 时飞书返 code=0 但 name 空,靠这层挡住 → 回落前缀
        if (item.open_id && item.name) result.set(item.open_id, item.name)
      }
    } catch (err) {
      console.warn(
        `[contact-name-resolver] batch 请求失败,该批回落前缀:`,
        (err as Error).message,
      )
    }
  }
  return result
}

/** 单次分页上限;群成员通常远小于此,极少分页 */
const MEMBER_PAGE_SIZE = 100
/** 分页保险丝:最多翻 20 页(2000 成员),防超大群翻页失控 */
const MAX_MEMBER_PAGES = 20

/**
 * 解析某 chat 全体成员 open_id → 昵称(REQ-073-⑥ 群 session 发送者昵称)。
 *
 * 走 `GET /im/v1/chats/{chat_id}/members` —— **无需 `contact:user.base:readonly` scope**
 * (实测该接口直接返 name),是群场景取名的首选路径,区别于合并转发陌生人才用的通讯录 API。
 *
 * 全程 graceful:取 token / 请求 / code≠0 任一失败均返回**已累积的部分结果**(不抛),
 * caller 未命中回落 open_id 前缀。
 */
export async function resolveChatMemberNames(
  chatId: string,
  client: Client,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (!chatId) return result

  let auth: { token: string; domain: string }
  try {
    auth = await getClientAuthContext(client)
  } catch (err) {
    console.warn(
      `[contact-name-resolver] chat-members 取 token 失败,回落前缀:`,
      (err as Error).message,
    )
    return result
  }

  let pageToken: string | undefined
  for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
    const params = new URLSearchParams({
      member_id_type: "open_id",
      page_size: String(MEMBER_PAGE_SIZE),
    })
    if (pageToken) params.set("page_token", pageToken)
    const url = `${auth.domain}/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members?${params.toString()}`
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } })
      const json = (await res.json()) as {
        code?: number
        msg?: string
        data?: {
          items?: Array<{ member_id?: string; name?: string }>
          has_more?: boolean
          page_token?: string
        }
      }
      if (json.code !== 0) {
        console.warn(
          `[contact-name-resolver] chat-members code=${json.code} msg=${json.msg ?? "?"} — 回落前缀`,
        )
        break
      }
      for (const item of json.data?.items ?? []) {
        if (item.member_id && item.name) result.set(item.member_id, item.name)
      }
      if (!json.data?.has_more || !json.data.page_token) break
      pageToken = json.data.page_token
    } catch (err) {
      console.warn(
        `[contact-name-resolver] chat-members 请求失败,回落已累积结果:`,
        (err as Error).message,
      )
      break
    }
  }
  return result
}
