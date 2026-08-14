import type { SessionApi } from "@opencode-ai/client/promise"
import { normalizeSessionInfo } from "@/utils/session"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"

export async function loadRootSessions(input: { api: Pick<SessionApi, "list">; directory: string; limit: number }) {
  const result = await input.api.list({
    directory: input.directory,
    parentID: null,
    limit: input.limit,
    order: "desc",
  })
  return {
    data: result.data.map(normalizeSessionInfo),
    limit: input.limit,
    limited: true,
  } as const
}

export async function loadRootSessionsV1(input: { client: OpencodeClient; directory: string; limit: number }) {
  try {
    // FORK: REQ-072 — scope=project 让后端按项目身份列会话(改名/挪位/复制跟随);global 哨兵
    //   后端 gateProjectScope 自动降级 directory 过滤。spread 绕过 SDK 类型的 excess check。2026-08-11
    const result = await input.client.session.list({
      directory: input.directory,
      roots: true,
      limit: input.limit,
      ...({ scope: "project" } as object),
    })
    return { data: result.data, limit: input.limit, limited: true } as const
  } catch {
    const result = await input.client.session.list({
      directory: input.directory,
      roots: true,
      ...({ scope: "project" } as object),
    })
    return { data: result.data, limit: input.limit, limited: false } as const
  }
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}
