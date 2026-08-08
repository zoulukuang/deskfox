// FORK: REQ-098 share 分享页 e2e 的假后端(只管 SSR 那半)[feat: chat-tilde-del-fix] 2026-08-08
//
// share 页的数据分两条链路,得分开对付:
//   ① `/s/<id>.astro` 在 **SSR 阶段** `fetch(${VITE_API_URL}/share_data?id=)` —— astro dev 的 SSR 跑在
//      Cloudflare adapter 的 workerd 里,浏览器侧 page.route 拦不到 → 由本文件这个假后端提供。
//   ② 正文消息由 `Share.tsx` 走 **WebSocket** 推送 → spec 里用 Playwright routeWebSocket 直接 mock,
//      不起真 WS 服务(它把 URL 强制成 `wss://`,真起就得配自签 TLS,得不偿失)。
//
// ⚠️ 用 node:http 而不是 Bun.serve:workerd 的 fetch 打 Bun.serve 会 `other side closed`(连接被提前关),
//    astro SSR 直接 500。node:http 正常。
//
// 用法:bun packages/app/e2e/utils/share-fixture-server.ts [port]
import { createServer } from "node:http"
import { SHARE_FIXTURE } from "./share-fixture"

const PORT = Number(process.argv[2] ?? 4322)

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`)
  console.log(`[share-fixture] ${req.method} ${url.pathname}${url.search}`)
  if (url.pathname === "/share_data") {
    const body = JSON.stringify({
      info: SHARE_FIXTURE.info,
      messages: { [SHARE_FIXTURE.message.id]: { role: "assistant", modelID: SHARE_FIXTURE.message.modelID } },
    })
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Access-Control-Allow-Origin": "*",
    })
    res.end(body)
    return
  }
  res.writeHead(404, { "Content-Type": "text/plain" })
  res.end("not found")
})

// R6:显式绑环回,别让测试假后端暴露到 LAN
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[share-fixture] http://127.0.0.1:${PORT} (session ${SHARE_FIXTURE.info.id})`)
})
