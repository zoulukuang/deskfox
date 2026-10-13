import { createMiddleware } from "@solidjs/start/middleware"
import { localShares } from "./runtime"
import { publicShare } from "./public-share"

export default createMiddleware({
  onRequest: async (event) => {
    if (!localShares) return
    const url = new URL(event.request.url)
    if (url.pathname.startsWith("/_build/")) return
    event.response.headers.set("Cache-Control", "no-store")
    event.response.headers.set("Referrer-Policy", "no-referrer")
    event.response.headers.set("X-Content-Type-Options", "nosniff")
    if (!url.pathname.startsWith("/share/")) return
    // Resolve existence before streaming starts, so revoked links have a real HTTP 404.
    const share = await publicShare.get(url.pathname.slice("/share/".length))
    if (share) return
    // H3 treats a returned Response(404) as "try the next handler". Set the status
    // before the page's not-found renderer runs instead of returning a 404 Response.
    event.response.status = 404
  },
})
