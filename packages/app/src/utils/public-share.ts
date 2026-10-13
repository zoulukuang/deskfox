import type { ServerConnection } from "@/context/server"
import type { ServerProtocol } from "./server-protocol"
import { authTokenFromCredentials } from "./server"

function object(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
}

export function supportsPublicShare(value: unknown) {
  const paths = object(object(value)?.paths)
  const operation = object(object(paths?.["/session/{sessionID}/share"])?.post)
  const parameters = operation?.parameters
  if (!Array.isArray(parameters)) return false
  return parameters.some((value: unknown) => {
    const parameter = object(value)
    if (parameter?.name !== "shareTarget" || parameter.in !== "query") return false
    const values = object(parameter.schema)?.enum
    return Array.isArray(values) && values.includes("cn") && values.includes("global")
  })
}

// Capture the connection, locale and directory-scoped publisher before the first await.
// Probe on each click: an old server may silently discard unknown query parameters.
export async function publishPublicShare<T>(input: {
  locale: string
  server: ServerConnection.HttpBase
  protocol: Promise<ServerProtocol>
  fetch: typeof fetch
  unsupported: string
  unavailable: string
  publish: (target: "cn" | "global") => Promise<T>
}) {
  const target = input.locale === "zh" ? "cn" : "global"
  const server = { ...input.server }
  const publish = input.publish
  const request = input.fetch
  if ((await input.protocol) !== "v1") throw new Error(input.unsupported)
  const response = await request(`${server.url.replace(/\/$/, "")}/doc`, {
    headers: server.password
      ? { Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}` }
      : undefined,
    signal: AbortSignal.timeout(5_000),
    redirect: "error",
    cache: "no-store",
  }).catch(() => undefined)
  if (!response?.ok) throw new Error(input.unavailable)
  const doc: unknown = await response.json().catch(() => undefined)
  if (!supportsPublicShare(doc)) throw new Error(input.unsupported)
  return publish(target)
}
