import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import z from "zod"
import { createSchema, dataSchema, secretSchema, shareIDSchema, syncSchema } from "./schema"
import { createRepository, ShareFailure } from "./repository"

export function createShareApi(options: {
  repository: Awaited<ReturnType<typeof createRepository>>
  origin: string
  requestBytes: number
  requestsPerMinute: number
  createsPerMinute: number
  concurrency: number
}) {
  if (!["https://deskfox.cn", "https://deskfox.ai"].includes(options.origin))
    throw new Error("Invalid public share origin")
  const app = new Hono()
  const buckets = new Map<string, { time: number; count: number; creates: number }>()
  const active = { count: 0 }
  app.use(async (c, next) => {
    c.header("Cache-Control", "no-store")
    c.header("X-Content-Type-Options", "nosniff")
    c.header("Referrer-Policy", "no-referrer")
    if (active.count >= options.concurrency) return c.json({ code: "ShareBusy" }, 503)
    // Nginx overwrites X-Real-IP; this server only listens on loopback.
    const ip = c.req.header("x-real-ip") ?? "local"
    const now = Date.now()
    for (const [key, value] of buckets) if (value.time + 60_000 <= now) buckets.delete(key)
    if (!buckets.has(ip) && buckets.size >= 10_000) return c.json({ code: "ShareBusy" }, 503)
    const bucket = buckets.get(ip) ?? { time: now, count: 0, creates: 0 }
    buckets.set(ip, bucket)
    bucket.count++
    if (c.req.method === "POST" && c.req.path === "/api/share") bucket.creates++
    if (bucket.count > options.requestsPerMinute || bucket.creates > options.createsPerMinute) {
      c.header("Retry-After", "60")
      return c.json({ code: "ShareRateLimited" }, 429)
    }
    active.count++
    await next().finally(() => {
      active.count--
    })
  })
  app.use(bodyLimit({ maxSize: options.requestBytes, onError: (c) => c.json({ code: "ShareTooLarge" }, 413) }))
  app.onError((error, c) => {
    if (error instanceof ShareFailure) return c.json({ code: error.code }, error.status)
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ code: "ShareInvalid" }, 400)
    // Do not emit request bodies, URLs with recovery tokens, or storage contents to public errors/logs.
    console.error("DeskFox share operation failed", error.name)
    return c.json({ code: "ShareUnavailable" }, 503)
  })
  app.notFound((c) => c.json({ code: "ShareNotFound" }, 404))
  app.get("/api/share/health", (c) => c.json({ service: "deskfox-share", version: 1 }))
  app.get("/api/doc", (c) =>
    c.json({
      openapi: "3.1.0",
      info: { title: "DeskFox Share API", version: "1" },
      paths: {
        "/api/share": {
          post: {
            operationId: "share.create",
            requestBody: { content: { "application/json": { schema: z.toJSONSchema(createSchema) } } },
            responses: { "200": { description: "Private share allocated; requires initial sync" } },
          },
        },
        "/api/share/{id}/sync": {
          post: {
            operationId: "share.sync",
            requestBody: { content: { "application/json": { schema: z.toJSONSchema(syncSchema) } } },
            responses: { "200": { description: "Snapshot committed" } },
          },
        },
        "/api/share/{id}/data": {
          get: {
            operationId: "share.data",
            responses: {
              "200": {
                description: "Public snapshot",
                content: { "application/json": { schema: z.toJSONSchema(z.array(dataSchema)) } },
              },
            },
          },
        },
        "/api/share/{id}": {
          delete: {
            operationId: "share.remove",
            responses: { "200": { description: "Share permanently unavailable" } },
          },
        },
      },
    }),
  )
  app.post("/api/share", async (c) => {
    const share = await options.repository.create(await c.req.json(), c.req.header("idempotency-key"))
    return c.json({ id: share.id, secret: share.secret, url: `${options.origin}/share/${share.id}` })
  })
  app.post("/api/share/:id/sync", async (c) => {
    const id = shareIDSchema.parse(c.req.param("id"))
    const body = syncSchema.parse(await c.req.json())
    await options.repository.sync({ share: { id, secret: body.secret }, data: body.data })
    return c.json({})
  })
  app.get("/api/share/:id/data", async (c) =>
    c.json(await options.repository.data(shareIDSchema.parse(c.req.param("id")))),
  )
  app.delete("/api/share/:id", async (c) => {
    const id = shareIDSchema.parse(c.req.param("id"))
    const body = z
      .object({ secret: secretSchema })
      .strict()
      .parse(await c.req.json())
    await options.repository.remove({ id, secret: body.secret })
    return c.json({})
  })
  return app
}
