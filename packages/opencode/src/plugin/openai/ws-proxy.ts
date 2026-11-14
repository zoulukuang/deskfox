import { Agent } from "node:https"
import { ProxyEnv } from "@/util/proxy-env"

export function responsesWebSocketProxy(url: string) {
  const endpoint = url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:")
  const proxy = ProxyEnv.getProxyForUrl(endpoint)
  if (!proxy) return {}

  // Bun requires its own proxy option. Node's default agent does not tunnel the ws upgrade here.
  if (typeof Bun !== "undefined") return { proxy }
  if (!endpoint.startsWith("https:") || !URL.canParse(proxy)) return {}
  const address = new URL(proxy)
  if (address.protocol !== "http:" && address.protocol !== "https:") return {}

  return { agent: new Agent({ proxyEnv: { HTTPS_PROXY: address.href } }) }
}
