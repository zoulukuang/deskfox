import { localShares } from "./runtime"

// SolidStart's internal H3 middleware can consume Response(404) and replace its
// headers/body. Apply the public revocation contract at the final fetch boundary.
export function withShareResponses(handler: { fetch(request: Request): Response | Promise<Response> }) {
  return {
    async fetch(request: Request) {
      const response = await handler.fetch(request)
      if (!localShares) return response
      const url = new URL(request.url)
      if (url.pathname.startsWith("/_build/")) return response
      const headers = new Headers(response.headers)
      const missing = headers.get("X-DeskFox-Share-Missing") === "1"
      headers.delete("X-DeskFox-Share-Missing")
      headers.set("Cache-Control", "no-store")
      headers.set("Referrer-Policy", "no-referrer")
      headers.set("X-Content-Type-Options", "nosniff")
      if ((response.status === 404 && url.pathname.startsWith("/api/share/")) || (missing && url.pathname.startsWith("/_server"))) {
        headers.set("Content-Type", "application/json")
        headers.delete("Content-Length")
        await response.body?.cancel()
        return new Response(JSON.stringify({ code: "ShareNotFound" }), { status: 404, headers })
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    },
  }
}
