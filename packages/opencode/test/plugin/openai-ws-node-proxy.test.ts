import { expect, test } from "bun:test"
import { createServer } from "node:http"
import net, { type AddressInfo } from "node:net"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

test("Node WSS sends CONNECT through HTTPS_PROXY and honors NO_PROXY", async () => {
  await using tmp = await tmpdir()
  await Bun.build({
    entrypoints: [path.resolve(import.meta.dir, "../../src/plugin/openai/ws.ts")],
    outdir: tmp.path,
    target: "node",
    format: "cjs",
  })

  let directRequests = 0
  const target = net.createServer((socket) => {
    directRequests++
    socket.destroy()
  })
  const proxy = createServer()
  const tunnels: { url?: string; authorization?: string }[] = []
  proxy.on("connect", (request, socket) => {
    tunnels.push({ url: request.url, authorization: request.headers.authorization })
    socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
  })
  await Promise.all([
    new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve)),
  ])

  const authority = `127.0.0.1:${(target.address() as AddressInfo).port}`
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
  async function connect(noProxy: string) {
    const child = Bun.spawn(
      [
        "node",
        "-e",
        `require(process.argv[1]).connectResponsesWebSocket({
          url: process.argv[2], headers: { authorization: "Bearer test" }, timeout: 2500,
        }).then((socket) => socket.terminate(), (error) => console.log(error.message))`,
        path.join(tmp.path, "ws.js"),
        `wss://${authority}/v1/responses`,
      ],
      {
        env: {
          ...process.env,
          NODE_USE_ENV_PROXY: "0",
          https_proxy: proxyUrl,
          HTTPS_PROXY: proxyUrl,
          no_proxy: noProxy,
          NO_PROXY: noProxy,
        },
        stdout: "pipe",
        stderr: "inherit",
      },
    )
    const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    expect(code).toBe(0)
    return output
  }

  try {
    expect(await connect("")).toContain("502")
    expect(tunnels).toEqual([{ url: authority, authorization: undefined }])
    expect(directRequests).toBe(0)
    await connect(authority)
    expect(tunnels).toHaveLength(1)
    expect(directRequests).toBe(1)
  } finally {
    target.close()
    proxy.close()
  }
})
