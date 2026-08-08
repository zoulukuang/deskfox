// [fork-only] REQ-019 运行时验证:MCP OAuth 回调 server 真的只在环回地址上监听
//   [feat: oauth-loopback-bind] 2026-08-07
//
// 静态守卫(oauth-loopback-bind.test.ts)证明"源码里写了 127.0.0.1";这里证明"运行起来确实只绑环回"。
// 三处里选 MCP 这条做运行时验证:它的 redirect URI 本来就是 127.0.0.1 字面量(零兼容风险),
// 且 ensureRunning() 可直接调用,不需要构造完整 plugin 上下文。
import { describe, expect, test, afterAll } from "bun:test"
import { createConnection } from "node:net"
import { networkInterfaces } from "node:os"
import { ensureRunning, stop, isRunning } from "../../src/mcp/oauth-callback"

const PORT = 54193 // 避开默认 OAuth 端口,防与真在跑的实例撞
const REDIRECT = `http://127.0.0.1:${PORT}/callback`

/** 本机第一个非环回 IPv4(LAN 地址);无则返回 undefined(CI/无网环境)。 */
function lanAddress(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address
    }
  }
  return undefined
}

function probe(host: string, port: number, timeoutMs = 2000): Promise<"connected" | "refused" | "timeout"> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const done = (result: "connected" | "refused" | "timeout") => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => done("timeout"))
    socket.on("connect", () => done("connected"))
    socket.on("error", () => done("refused"))
  })
}

afterAll(async () => {
  await stop().catch(() => undefined)
})

describe("REQ-019 MCP OAuth 回调 server 监听地址(运行时)", () => {
  test("T3:127.0.0.1 连得上(回调可达,功能不回归)", async () => {
    await ensureRunning(REDIRECT)
    expect(isRunning()).toBe(true)
    expect(await probe("127.0.0.1", PORT)).toBe("connected")
  })

  test("T2:非环回本机 IP 连不上(修前绑 0.0.0.0 时这里是 connected)", async () => {
    const lan = lanAddress()
    if (!lan) {
      console.log("[skip] 本机无非环回 IPv4,跳过 LAN 可达性断言")
      return
    }
    await ensureRunning(REDIRECT)
    expect(await probe(lan, PORT)).not.toBe("connected")
  })
})
