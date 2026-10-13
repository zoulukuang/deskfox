import { beforeEach, describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Option } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"

import { AccessToken, AccountID, OrgID, RefreshToken } from "../../src/account/schema"
import { AccountRepo } from "../../src/account/repo"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Session } from "@/session/session"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ShareNext } from "@/share/share-next"
import { SessionShare } from "@/share/session"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SessionShareTable, ShareOperationTable } from "@opencode-ai/core/share/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq, sql } from "drizzle-orm"
import { provideTmpdirInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { pollWithTimeout, testEffect } from "../lib/effect"

const env = LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node]))
const it = testEffect(env)

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const none = HttpClient.make(() => Effect.die("unexpected http call"))

function requestLayer(client: HttpClient.HttpClient) {
  const replacement = [httpClient, Layer.succeed(HttpClient.HttpClient, client)] as const
  return LayerNode.compile(LayerNode.group([ShareNext.node, AccountRepo.node]), [replacement])
}

function integrationLayer(client: HttpClient.HttpClient) {
  const replacement = [httpClient, Layer.succeed(HttpClient.HttpClient, client)] as const
  return LayerNode.compile(
    LayerNode.group([
      ShareNext.node,
      EventV2Bridge.node,
      Session.node,
      SessionProjector.node,
      AccountRepo.node,
      Database.node,
    ]),
    [replacement],
  )
}

function automaticLayer(client: HttpClient.HttpClient, desktop = true) {
  return LayerNode.compile(
    LayerNode.group([SessionShare.node, EventV2Bridge.node, Session.node, SessionProjector.node, Database.node]),
    [
      [httpClient, Layer.succeed(HttpClient.HttpClient, client)],
      [RuntimeFlags.node, RuntimeFlags.layer({ client: desktop ? "desktop" : "cli" })],
    ],
  )
}

const share = (id: SessionID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select()
      .from(SessionShareTable)
      .where(eq(SessionShareTable.session_id, id))
      .get()
      .pipe(Effect.orDie)
  })

const seed = (url: string, org?: string) =>
  AccountRepo.Service.use((repo) =>
    repo.persistAccount({
      id: AccountID.make("account-1"),
      email: "user@example.com",
      url,
      accessToken: AccessToken.make("st_test_token"),
      refreshToken: RefreshToken.make("rt_test_token"),
      expiry: Date.now() + 10 * 60_000,
      orgID: org ? Option.some(OrgID.make(org)) : Option.none(),
    }),
  )

beforeEach(async () => {
  await resetDatabase()
})

// FORK-BEGIN: publication and cancellation contract regressions 2026-10-12
const publicShare = { id: "a".repeat(48), secret: "b".repeat(64), url: `https://deskfox.cn/share/${"a".repeat(48)}` }

it.live("the actual HTTP transport never forwards cancellation secrets across redirects", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const received: string[] = []
      const destination = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: async (request) => {
              received.push(await request.text())
              return Response.json({})
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const origin = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.redirect(destination.url, 307) }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const client = yield* HttpClient.HttpClient
      yield* Effect.gen(function* () {
        const sessions = yield* Session.Service
        const sharing = yield* ShareNext.Service
        const database = yield* Database.Service
        const info = yield* sessions.create({ title: "redirect test" })
        yield* database.db
          .insert(SessionShareTable)
          .values({
            session_id: info.id,
            id: "redirect",
            secret: "private-secret",
            url: `${origin.url}share/redirect`,
            base_url: origin.url.href.replace(/\/$/, ""),
            api_resource: "share",
          })
          .run()
        expect(Exit.isFailure(yield* Effect.exit(sharing.remove(info.id)))).toBe(true)
        expect(received).toEqual([])
        expect((yield* share(info.id))?.secret).toBe("private-secret")
      }).pipe(Effect.provide(integrationLayer(client)))
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  ),
)

it.live("logging out of the original organization never substitutes another account for cancellation", () =>
  provideTmpdirInstance(() => {
    const seen: HttpClientRequest.HttpClientRequest[] = []
    const client = HttpClient.make((req) => {
      seen.push(req)
      return Effect.succeed(
        json(
          req,
          req.url.endsWith("/api/shares")
            ? { id: "org_share", secret: "org_secret", url: "https://org.example/share/org_share" }
            : {},
        ),
      )
    })
    return Effect.gen(function* () {
      yield* seed("https://org.example", "original-org")
      const sessions = yield* Session.Service
      const sharing = yield* ShareNext.Service
      const accounts = yield* AccountRepo.Service
      const info = yield* sessions.create({ title: "organization" })
      yield* sharing.create(info.id)
      yield* accounts.remove(AccountID.make("account-1"))
      yield* seed("https://other.example", "other-org")
      expect(Exit.isFailure(yield* Effect.exit(sharing.remove(info.id)))).toBe(true)
      expect(seen).toHaveLength(2)
      expect(
        seen.every((req) => req.url.startsWith("https://org.example/") && req.headers["x-org-id"] === "original-org"),
      ).toBe(true)
      expect((yield* share(info.id))?.secret).toBe("org_secret")
    }).pipe(Effect.provide(integrationLayer(client)))
  }),
)

it.live("desktop auto sharing without a target emits an error and sends no request", () =>
  provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        const events = yield* EventV2Bridge.Service
        const sessions = yield* SessionShare.Service
        const errors: string[] = []
        yield* events.listen((event) =>
          Effect.sync(() => {
            if (event.type === Session.Event.Error.type) errors.push(JSON.stringify(event.data))
          }),
        )
        const info = yield* sessions.create({ title: "automatic" })
        expect(info.share).toBeUndefined()
        expect(errors).toHaveLength(1)
        expect(errors[0]).toContain("explicit share_target")
      }).pipe(Effect.provide(automaticLayer(none))),
    { config: { share: "auto" } },
  ),
)

it.live("desktop auto sharing uses only its explicit target", () =>
  provideTmpdirInstance(
    () => {
      const seen: string[] = []
      const client = HttpClient.make((req) => {
        seen.push(req.url)
        return Effect.succeed(json(req, req.url.endsWith("/api/share") ? publicShare : {}))
      })
      return Effect.gen(function* () {
        const sessions = yield* SessionShare.Service
        const info = yield* sessions.create({ title: "automatic" })
        yield* pollWithTimeout(
          share(info.id).pipe(Effect.map((value) => value?.id)),
          "auto share not published",
          "3 seconds",
        )
        expect(seen).toHaveLength(2)
        expect(seen.every((url) => url.startsWith("https://deskfox.cn/"))).toBe(true)
      }).pipe(Effect.provide(automaticLayer(client)))
    },
    { config: { share: "auto", share_target: "cn", enterprise: { url: "https://custom.example" } } },
  ),
)

it.live("CLI auto sharing retains the configured legacy service", () =>
  provideTmpdirInstance(
    () => {
      const seen: string[] = []
      const client = HttpClient.make((req) => {
        seen.push(req.url)
        return Effect.succeed(
          json(
            req,
            req.url.endsWith("/api/share")
              ? { id: "old", secret: "old_secret", url: "https://custom.example/share/old" }
              : {},
          ),
        )
      })
      return Effect.gen(function* () {
        const sessions = yield* SessionShare.Service
        const info = yield* sessions.create({ title: "automatic" })
        yield* pollWithTimeout(
          share(info.id).pipe(Effect.map((value) => value?.id)),
          "CLI share not published",
          "3 seconds",
        )
        expect(seen.every((url) => url.startsWith("https://custom.example/"))).toBe(true)
      }).pipe(Effect.provide(automaticLayer(client, false)))
    },
    { config: { share: "auto", enterprise: { url: "https://custom.example" } } },
  ),
)

it.live(
  "incremental sync retains a failed batch and retries without requiring another event",
  () =>
    provideTmpdirInstance(() => {
      const updates: string[] = []
      const client = HttpClient.make((req) => {
        if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array") {
          const body = new TextDecoder().decode(req.body.body)
          if (body.includes("updated title")) {
            updates.push(body)
            return Effect.succeed(json(req, {}, updates.length === 1 ? 503 : 200))
          }
        }
        return Effect.succeed(json(req, req.url.endsWith("/api/share") ? publicShare : {}))
      })
      return Effect.gen(function* () {
        const sessions = yield* Session.Service
        const sharing = yield* ShareNext.Service
        const info = yield* sessions.create({ title: "original title" })
        yield* sharing.init()
        yield* sharing.create(info.id, "cn")
        yield* sessions.setTitle({ sessionID: info.id, title: "updated title" })
        yield* pollWithTimeout(
          Effect.sync(() => (updates.length >= 2 ? true : undefined)),
          "sync batch was lost",
          "9 seconds",
        )
        expect(updates).toHaveLength(2)
        yield* sharing.remove(info.id)
      }).pipe(Effect.provide(integrationLayer(client)))
    }),
  { timeout: 15_000 },
)

it.live("HTML 404 retains cancellation credentials; only the service's structured 404 confirms removal", () =>
  provideTmpdirInstance(() => {
    const deletes: string[] = []
    const client = HttpClient.make((req) => {
      if (req.method !== "DELETE") return Effect.succeed(json(req, req.url.endsWith("/api/share") ? publicShare : {}))
      deletes.push(req.url)
      return Effect.succeed(
        deletes.length === 1
          ? HttpClientResponse.fromWeb(
              req,
              new Response("<h1>Missing proxy route</h1>", { status: 404, headers: { "content-type": "text/html" } }),
            )
          : json(req, { code: "ShareNotFound" }, 404),
      )
    })
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sharing = yield* ShareNext.Service
      const info = yield* sessions.create({ title: "test" })
      yield* sharing.create(info.id, "cn")
      expect(Exit.isFailure(yield* Effect.exit(sharing.remove(info.id)))).toBe(true)
      expect((yield* share(info.id))?.secret).toBe(publicShare.secret)
      expect((yield* sessions.get(info.id)).share?.url).toBe(publicShare.url)
      yield* sharing.remove(info.id)
      expect(yield* share(info.id)).toBeUndefined()
      expect((yield* sessions.get(info.id)).share).toBeUndefined()
    }).pipe(Effect.provide(integrationLayer(client)))
  }),
)

it.live("public target ignores the active organization and remains pinned after target changes", () =>
  provideTmpdirInstance(() => {
    const seen: HttpClientRequest.HttpClientRequest[] = []
    const client = HttpClient.make((req) => {
      seen.push(req)
      return Effect.succeed(json(req, req.url.endsWith("/api/share") ? publicShare : {}))
    })
    return Effect.gen(function* () {
      yield* seed("https://control.example.com", "org-1")
      const sessions = yield* Session.Service
      const sharing = yield* ShareNext.Service
      const info = yield* sessions.create({ title: "test" })
      expect((yield* sharing.create(info.id, "cn")).url).toBe(publicShare.url)
      expect((yield* sharing.create(info.id, "global")).url).toBe(publicShare.url)
      expect((yield* sessions.get(info.id)).share?.url).toBe(publicShare.url)
      yield* sharing.remove(info.id)
      expect((yield* sessions.get(info.id)).share).toBeUndefined()
      expect(seen.map((req) => req.method)).toEqual(["POST", "POST", "DELETE"])
      expect(seen.every((req) => req.url.startsWith("https://deskfox.cn/"))).toBe(true)
      expect(seen.every((req) => !req.headers.authorization && !req.headers["x-org-id"])).toBe(true)
      expect(seen[0].headers["idempotency-key"]).toHaveLength(64)
    }).pipe(Effect.provide(integrationLayer(client)))
  }),
)

it.live(
  "concurrent publication joins one share; republishing after cancellation drops the old queue and uses the new region",
  () =>
    provideTmpdirInstance(() => {
      const seen: Array<{ url: string; method: string; body: string }> = []
      const globalShare = {
        id: "c".repeat(48),
        secret: "d".repeat(64),
        url: `https://deskfox.ai/share/${"c".repeat(48)}`,
      }
      const client = HttpClient.make((req) => {
        seen.push({
          url: req.url,
          method: req.method,
          body: req.body._tag === "Uint8Array" ? new TextDecoder().decode(req.body.body) : "",
        })
        return Effect.succeed(
          json(
            req,
            req.url.endsWith("/api/share")
              ? req.url.startsWith("https://deskfox.cn/")
                ? publicShare
                : globalShare
              : {},
          ),
        )
      })
      return Effect.gen(function* () {
        const sessions = yield* Session.Service
        const sharing = yield* ShareNext.Service
        const events = yield* EventV2Bridge.Service
        const info = yield* sessions.create({ title: "republish" })
        yield* sharing.init()
        const created = yield* Effect.all([sharing.create(info.id, "cn"), sharing.create(info.id, "cn")], {
          concurrency: "unbounded",
        })
        expect(created.map((item) => item.id)).toEqual([publicShare.id, publicShare.id])
        expect(seen.filter((req) => req.url.endsWith("/api/share"))).toHaveLength(1)
        yield* events.publish(Session.Event.Diff, {
          sessionID: info.id,
          diff: [{ file: "old-only.txt", additions: 1, deletions: 0 }],
        })
        yield* sharing.remove(info.id)
        expect((yield* sharing.create(info.id, "global")).url).toBe(globalShare.url)
        yield* Effect.sleep("1200 millis")
        expect(seen.filter((req) => req.url.startsWith("https://deskfox.cn/")).map((req) => req.method)).toEqual([
          "POST",
          "POST",
          "DELETE",
        ])
        expect(
          seen
            .filter((req) => req.url.startsWith("https://deskfox.ai/"))
            .every((req) => !req.body.includes("old-only.txt")),
        ).toBe(true)
        expect((yield* sessions.get(info.id)).share?.url).toBe(globalShare.url)
      }).pipe(Effect.provide(integrationLayer(client)))
    }),
)

it.live("lost create response retries the same persisted recovery key and original origin", () =>
  provideTmpdirInstance(() => {
    const creates: HttpClientRequest.HttpClientRequest[] = []
    const client = HttpClient.make((req) => {
      if (!req.url.endsWith("/api/share")) return Effect.succeed(json(req, {}))
      creates.push(req)
      if (creates.length === 1)
        return Effect.fail(
          new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request: req }) }),
        )
      return Effect.succeed(json(req, publicShare))
    })
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sharing = yield* ShareNext.Service
      const database = yield* Database.Service
      const info = yield* sessions.create({ title: "test" })
      expect(Exit.isFailure(yield* Effect.exit(sharing.create(info.id, "cn")))).toBe(true)
      expect(yield* share(info.id)).toBeUndefined()
      const pending = yield* database.db
        .select()
        .from(ShareOperationTable)
        .where(eq(ShareOperationTable.session_id, info.id))
        .get()
      expect(pending?.status).toBe("creating")
      yield* sharing.create(info.id, "global")
      expect(creates).toHaveLength(2)
      expect(creates[1].url).toBe(creates[0].url)
      expect(creates[1].headers["idempotency-key"]).toBe(creates[0].headers["idempotency-key"])
    }).pipe(Effect.provide(integrationLayer(client)))
  }),
)

it.live("a local publication transaction failure compensates remotely without publishing a URL", () =>
  provideTmpdirInstance(() => {
    const seen: string[] = []
    const client = HttpClient.make((req) => {
      seen.push(req.method)
      return Effect.succeed(json(req, req.url.endsWith("/api/share") ? publicShare : {}))
    })
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sharing = yield* ShareNext.Service
      const database = yield* Database.Service
      const info = yield* sessions.create({ title: "local write failure" })
      yield* database.db.run(
        sql`CREATE TEMP TRIGGER reject_test_share BEFORE INSERT ON session_share BEGIN SELECT RAISE(FAIL, 'test publication failure'); END`,
      )
      const result = yield* sharing
        .create(info.id, "cn")
        .pipe(Effect.exit, Effect.ensuring(database.db.run(sql`DROP TRIGGER reject_test_share`).pipe(Effect.orDie)))
      expect(Exit.isFailure(result)).toBe(true)
      expect((yield* sessions.get(info.id)).share).toBeUndefined()
      expect(yield* share(info.id)).toBeUndefined()
      expect(
        yield* database.db.select().from(ShareOperationTable).where(eq(ShareOperationTable.session_id, info.id)).get(),
      ).toBeUndefined()
      expect(seen).toEqual(["POST", "POST", "DELETE"])
    }).pipe(Effect.provide(integrationLayer(client)))
  }),
)

it.live("a lost cancellation response retains credentials and retries only the original service", () =>
  provideTmpdirInstance(() => {
    const deletes: HttpClientRequest.HttpClientRequest[] = []
    const client = HttpClient.make((req) => {
      if (req.method !== "DELETE") return Effect.succeed(json(req, req.url.endsWith("/api/share") ? publicShare : {}))
      deletes.push(req)
      if (deletes.length === 1)
        return Effect.fail(
          new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request: req }) }),
        )
      return Effect.succeed(json(req, { code: "ShareNotFound" }, 404))
    })
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sharing = yield* ShareNext.Service
      const database = yield* Database.Service
      const info = yield* sessions.create({ title: "lost delete response" })
      yield* sharing.create(info.id, "cn")
      expect(Exit.isFailure(yield* Effect.exit(sharing.remove(info.id)))).toBe(true)
      expect((yield* share(info.id))?.secret).toBe(publicShare.secret)
      expect((yield* sessions.get(info.id)).share?.url).toBe(publicShare.url)
      expect(Exit.isFailure(yield* Effect.exit(sharing.create(info.id, "global")))).toBe(true)
      yield* sharing.remove(info.id)
      expect(yield* share(info.id)).toBeUndefined()
      expect((yield* sessions.get(info.id)).share).toBeUndefined()
      expect(
        yield* database.db.select().from(ShareOperationTable).where(eq(ShareOperationTable.session_id, info.id)).get(),
      ).toBeUndefined()
      expect(deletes.map((req) => req.url)).toEqual([
        `https://deskfox.cn/api/share/${publicShare.id}`,
        `https://deskfox.cn/api/share/${publicShare.id}`,
      ])
    }).pipe(Effect.provide(integrationLayer(client)))
  }),
)

it.live("a failed local cancellation transaction retains recovery credentials until retry", () =>
  provideTmpdirInstance(() => {
    const deletes: string[] = []
    const client = HttpClient.make((req) => {
      if (req.method !== "DELETE") return Effect.succeed(json(req, req.url.endsWith("/api/share") ? publicShare : {}))
      deletes.push(req.url)
      return Effect.succeed(deletes.length === 1 ? json(req, {}) : json(req, { code: "ShareNotFound" }, 404))
    })
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sharing = yield* ShareNext.Service
      const database = yield* Database.Service
      const info = yield* sessions.create({ title: "local cancellation failure" })
      yield* sharing.create(info.id, "cn")
      yield* database.db.run(
        sql`CREATE TEMP TRIGGER reject_test_cancel BEFORE DELETE ON session_share BEGIN SELECT RAISE(FAIL, 'test cancellation failure'); END`,
      )
      const result = yield* sharing
        .remove(info.id)
        .pipe(Effect.exit, Effect.ensuring(database.db.run(sql`DROP TRIGGER reject_test_cancel`).pipe(Effect.orDie)))
      expect(Exit.isFailure(result)).toBe(true)
      expect((yield* share(info.id))?.secret).toBe(publicShare.secret)
      const pending = yield* database.db
        .select()
        .from(ShareOperationTable)
        .where(eq(ShareOperationTable.session_id, info.id))
        .get()
      expect(pending?.status).toBe("cleanup-required")
      expect(pending?.secret).toBe(publicShare.secret)
      expect(Exit.isFailure(yield* Effect.exit(sharing.create(info.id, "global")))).toBe(true)
      yield* sharing.remove(info.id)
      expect(yield* share(info.id)).toBeUndefined()
      expect((yield* sessions.get(info.id)).share).toBeUndefined()
      expect(
        yield* database.db.select().from(ShareOperationTable).where(eq(ShareOperationTable.session_id, info.id)).get(),
      ).toBeUndefined()
      expect(deletes).toEqual([
        `https://deskfox.cn/api/share/${publicShare.id}`,
        `https://deskfox.cn/api/share/${publicShare.id}`,
      ])
    }).pipe(Effect.provide(integrationLayer(client)))
  }),
)

it.live(
  "a stalled create times out while retaining the exact recovery key",
  () =>
    provideTmpdirInstance(() => {
      const requests: HttpClientRequest.HttpClientRequest[] = []
      const client = HttpClient.make((req) => {
        if (!req.url.endsWith("/api/share")) return Effect.succeed(json(req, {}))
        requests.push(req)
        return requests.length === 1 ? Effect.never : Effect.succeed(json(req, publicShare))
      })
      return Effect.gen(function* () {
        const sessions = yield* Session.Service
        const sharing = yield* ShareNext.Service
        const database = yield* Database.Service
        const info = yield* sessions.create({ title: "timeout" })
        const started = Date.now()
        expect(Exit.isFailure(yield* Effect.exit(sharing.create(info.id, "cn")))).toBe(true)
        expect(Date.now() - started).toBeGreaterThanOrEqual(29_000)
        expect(Date.now() - started).toBeLessThan(45_000)
        expect((yield* sessions.get(info.id)).share).toBeUndefined()
        const pending = yield* database.db
          .select()
          .from(ShareOperationTable)
          .where(eq(ShareOperationTable.session_id, info.id))
          .get()
        expect(pending?.status).toBe("creating")
        yield* sharing.create(info.id, "global")
        expect(requests[1].headers["idempotency-key"]).toBe(pending!.operation_id)
        expect(requests[1].url).toBe(requests[0].url)
      }).pipe(Effect.provide(integrationLayer(client)))
    }),
  60_000,
)

it.live(
  "the overall publication deadline interrupts a stalled create response body and preserves recovery",
  () =>
    provideTmpdirInstance(() => {
      const requests: HttpClientRequest.HttpClientRequest[] = []
      const client = HttpClient.make((req) => {
        if (!req.url.endsWith("/api/share")) return Effect.succeed(json(req, {}))
        requests.push(req)
        // Headers arrive immediately, so the per-request 30s timer has completed.
        // Only the enclosing publication deadline can interrupt this unreadable body.
        return Effect.succeed(
          requests.length === 1
            ? HttpClientResponse.fromWeb(
                req,
                new Response(new ReadableStream(), {
                  headers: { "content-type": "application/json" },
                }),
              )
            : json(req, publicShare),
        )
      })
      return Effect.gen(function* () {
        const sessions = yield* Session.Service
        const sharing = yield* ShareNext.Service
        const database = yield* Database.Service
        const info = yield* sessions.create({ title: "overall publication timeout" })
        const started = Date.now()
        expect(Exit.isFailure(yield* Effect.exit(sharing.create(info.id, "cn")))).toBe(true)
        expect(Date.now() - started).toBeGreaterThanOrEqual(59_000)
        expect(Date.now() - started).toBeLessThan(75_000)
        expect((yield* sessions.get(info.id)).share).toBeUndefined()
        expect(yield* share(info.id)).toBeUndefined()
        const pending = yield* database.db
          .select()
          .from(ShareOperationTable)
          .where(eq(ShareOperationTable.session_id, info.id))
          .get()
        expect(pending?.status).toBe("creating")
        yield* sharing.create(info.id, "global")
        expect(requests[1].headers["idempotency-key"]).toBe(pending!.operation_id)
        expect(requests[1].url).toBe(requests[0].url)
        expect((yield* sessions.get(info.id)).share?.url).toBe(publicShare.url)
      }).pipe(Effect.provide(integrationLayer(client)))
    }),
  90_000,
)

it.live("initial sync failure never publishes a URL and retains failed cleanup credentials", () =>
  provideTmpdirInstance(() => {
    const client = HttpClient.make((req) =>
      Effect.succeed(
        json(req, req.url.endsWith("/api/share") ? publicShare : {}, req.url.endsWith("/api/share") ? 200 : 503),
      ),
    )
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sharing = yield* ShareNext.Service
      const database = yield* Database.Service
      const info = yield* sessions.create({ title: "test" })
      expect(Exit.isFailure(yield* Effect.exit(sharing.create(info.id, "cn")))).toBe(true)
      expect(yield* share(info.id)).toBeUndefined()
      expect((yield* sessions.get(info.id)).share).toBeUndefined()
      const pending = yield* database.db
        .select()
        .from(ShareOperationTable)
        .where(eq(ShareOperationTable.session_id, info.id))
        .get()
      expect(pending?.status).toBe("cleanup-required")
      expect(pending?.secret).toBe(publicShare.secret)
      expect(Exit.isFailure(yield* Effect.exit(sharing.create(info.id, "global")))).toBe(true)
    }).pipe(Effect.provide(integrationLayer(client)))
  }),
)

it.live("Session cascade keeps remote credentials until init completes orphan cleanup", () =>
  provideTmpdirInstance(() => {
    const seen: string[] = []
    const client = HttpClient.make((req) => {
      seen.push(req.method)
      return Effect.succeed(json(req, req.url.endsWith("/api/share") ? publicShare : {}))
    })
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sharing = yield* ShareNext.Service
      const database = yield* Database.Service
      const info = yield* sessions.create({ title: "test" })
      yield* sharing.create(info.id, "cn")
      yield* database.db.delete(SessionTable).where(eq(SessionTable.id, info.id)).run()
      expect(yield* share(info.id)).toBeUndefined()
      expect(
        (yield* database.db.select().from(ShareOperationTable).where(eq(ShareOperationTable.session_id, info.id)).get())
          ?.secret,
      ).toBe(publicShare.secret)
      yield* sharing.init()
      expect(
        yield* database.db.select().from(ShareOperationTable).where(eq(ShareOperationTable.session_id, info.id)).get(),
      ).toBeUndefined()
      expect(seen).toEqual(["POST", "POST", "DELETE"])
    }).pipe(Effect.provide(integrationLayer(client)))
  }),
)

it.live("resuming publication retains queued diffs for the same remote share", () =>
  provideTmpdirInstance(() => {
    const bodies: string[] = []
    const client = HttpClient.make((req) => {
      if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array")
        bodies.push(new TextDecoder().decode(req.body.body))
      return Effect.succeed(json(req, {}))
    })
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sharing = yield* ShareNext.Service
      const events = yield* EventV2Bridge.Service
      const database = yield* Database.Service
      const info = yield* sessions.create({ title: "resume" })
      yield* sharing.init()
      yield* database.db
        .insert(ShareOperationTable)
        .values({
          session_id: info.id,
          operation_id: "e".repeat(64),
          status: "created",
          remote_id: publicShare.id,
          secret: publicShare.secret,
          url: publicShare.url,
          base_url: "https://deskfox.cn",
          api_resource: "share",
        })
        .run()
      yield* events.publish(Session.Event.Diff, {
        sessionID: info.id,
        diff: [{ file: "queued.txt", additions: 1, deletions: 0 }],
      })
      yield* sharing.create(info.id, "global")
      yield* pollWithTimeout(
        Effect.sync(() => (bodies.some((body) => body.includes("queued.txt")) ? true : undefined)),
        "Queued diff was lost during resumed publication",
        "3 seconds",
      )
      expect(bodies.some((body) => body.includes("queued.txt"))).toBe(true)
    }).pipe(Effect.provide(integrationLayer(client)))
  }),
)

it.live("cancellation in another Location waits for initial sync and cannot be undone by a late URL projection", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const cancellingStarted = yield* Deferred.make<void>()
      const client = HttpClient.make((req) => {
        if (req.url.endsWith("/sync"))
          return Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.as(json(req, {})),
          )
        return Effect.succeed(json(req, req.url.endsWith("/api/share") ? publicShare : {}))
      })
      yield* Effect.gen(function* () {
        const sessions = yield* Session.Service
        const sharing = yield* ShareNext.Service
        const info = yield* sessions.create({ title: "test" })
        const publishing = yield* sharing.create(info.id, "cn").pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        expect((yield* sessions.get(info.id)).share).toBeUndefined()
        const cancelling = yield* provideTmpdirInstance(() =>
          ShareNext.Service.use((other) =>
            Deferred.succeed(cancellingStarted, undefined).pipe(Effect.andThen(other.remove(info.id))),
          ).pipe(Effect.provide(integrationLayer(client))),
        ).pipe(Effect.forkChild)
        yield* Deferred.await(cancellingStarted)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(publishing)
        yield* Fiber.join(cancelling)
        expect((yield* sessions.get(info.id)).share).toBeUndefined()
        expect(yield* share(info.id)).toBeUndefined()
      }).pipe(Effect.provide(integrationLayer(client)))
    }),
  ),
)
// FORK-END

describe("ShareNext", () => {
  it.live("request uses legacy share API without active org account", () =>
    provideTmpdirInstance(
      () =>
        ShareNext.Service.use((svc) =>
          Effect.gen(function* () {
            const req = yield* svc.request()

            expect(req.api.create).toBe("/api/share")
            expect(req.api.sync("shr_123")).toBe("/api/share/shr_123/sync")
            expect(req.api.remove("shr_123")).toBe("/api/share/shr_123")
            expect(req.api.data("shr_123")).toBe("/api/share/shr_123/data")
            expect(req.baseUrl).toBe("https://legacy-share.example.com")
            expect(req.headers).toEqual({})
          }),
        ).pipe(Effect.provide(requestLayer(none))),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("request uses default URL when no enterprise config", () =>
    provideTmpdirInstance(() =>
      ShareNext.Service.use((svc) =>
        Effect.gen(function* () {
          const req = yield* svc.request()

          expect(req.baseUrl).toBe("https://opncd.ai")
          expect(req.api.create).toBe("/api/share")
          expect(req.headers).toEqual({})
        }),
      ).pipe(Effect.provide(requestLayer(none))),
    ),
  )

  it.live("request uses org share API with auth headers when account is active", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        yield* seed("https://control.example.com", "org-1")

        const req = yield* ShareNext.use.request()

        expect(req.api.create).toBe("/api/shares")
        expect(req.api.sync("shr_123")).toBe("/api/shares/shr_123/sync")
        expect(req.api.remove("shr_123")).toBe("/api/shares/shr_123")
        expect(req.api.data("shr_123")).toBe("/api/shares/shr_123/data")
        expect(req.baseUrl).toBe("https://control.example.com")
        expect(req.headers).toEqual({
          authorization: "Bearer st_test_token",
          "x-org-id": "org-1",
        })
      }).pipe(Effect.provide(requestLayer(none))),
    ),
  )

  it.live("create posts share, persists it, and returns the result", () =>
    provideTmpdirInstance(
      () => {
        const createRequests: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/api/share")) {
            createRequests.push(req)
            return Effect.succeed(
              json(req, {
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              }),
            )
          }
          return Effect.succeed(json(req, { ok: true }))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })

          const result = yield* (yield* ShareNext.Service).create(session.id)

          expect(result.id).toBe("shr_abc")
          expect(result.url).toBe("https://legacy-share.example.com/share/abc")
          expect(result.secret).toBe("sec_123")

          const row = yield* share(session.id)
          expect(row?.id).toBe("shr_abc")
          expect(row?.url).toBe("https://legacy-share.example.com/share/abc")
          expect(row?.secret).toBe("sec_123")

          expect(createRequests).toHaveLength(1)
          expect(createRequests[0].method).toBe("POST")
          expect(createRequests[0].url).toBe("https://legacy-share.example.com/api/share")
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("remove deletes the persisted share and calls the delete endpoint", () =>
    provideTmpdirInstance(
      () => {
        const seen: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((req) => {
          seen.push(req)
          if (req.method === "POST") {
            return Effect.succeed(
              json(req, {
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              }),
            )
          }
          return Effect.succeed(HttpClientResponse.fromWeb(req, new Response(null, { status: 200 })))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })
          const service = yield* ShareNext.Service

          yield* service.create(session.id)
          yield* service.remove(session.id)

          expect(yield* share(session.id)).toBeUndefined()
          expect(seen.map((req) => [req.method, req.url])).toEqual([
            ["POST", "https://legacy-share.example.com/api/share"],
            ["POST", "https://legacy-share.example.com/api/share/shr_abc/sync"], // FORK: first sync completes before publication
            ["DELETE", "https://legacy-share.example.com/api/share/shr_abc"],
          ])
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("create fails on a non-ok response and does not persist a share", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make((req) => Effect.succeed(json(req, { error: "bad" }, 500)))
      return Effect.gen(function* () {
        const session = yield* (yield* Session.Service).create({ title: "test" })

        const exit = yield* ShareNext.Service.use((svc) => Effect.exit(svc.create(session.id)))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(yield* share(session.id)).toBeUndefined()
      }).pipe(Effect.provide(integrationLayer(client)))
    }),
  )

  it.live("ShareNext coalesces rapid diff events into one delayed sync with latest data", () =>
    provideTmpdirInstance(
      () => {
        const seen: Array<{ url: string; body: string }> = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array") {
            seen.push({ url: req.url, body: new TextDecoder().decode(req.body.body) })
          }
          return Effect.succeed(json(req, { ok: true }))
        })

        return Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service

          const info = yield* session.create({ title: "first" })
          yield* share.init()
          yield* Effect.sleep(50)
          const { db } = yield* Database.Service
          yield* db
            .insert(SessionShareTable)
            .values({
              session_id: info.id,
              id: "shr_abc",
              url: "https://legacy-share.example.com/share/abc",
              secret: "sec_123",
              base_url: "https://legacy-share.example.com", // FORK: fixture is an explicitly recorded custom origin
              api_resource: "share",
            })
            .run()
            .pipe(Effect.orDie)

          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [
              {
                file: "a.ts",
                patch:
                  "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,1 +1,1 @@\n-one\n\\ No newline at end of file\n+two\n\\ No newline at end of file\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          })
          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [
              {
                file: "b.ts",
                patch:
                  "Index: b.ts\n===================================================================\n--- b.ts\t\n+++ b.ts\t\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
                additions: 2,
                deletions: 0,
                status: "modified",
              },
            ],
          })
          yield* pollWithTimeout(
            Effect.sync(() => (seen.length === 1 ? true : undefined)),
            "timed out waiting for share sync",
            "5 seconds",
          )

          expect(seen).toHaveLength(1)
          expect(seen[0].url).toBe("https://legacy-share.example.com/api/share/shr_abc/sync")

          const body = JSON.parse(seen[0].body) as {
            secret: string
            data: Array<{
              type: string
              data: Array<{
                file: string
                patch: string
                additions: number
                deletions: number
                status?: string
              }>
            }>
          }
          expect(body.secret).toBe("sec_123")
          expect(body.data).toHaveLength(1)
          expect(body.data[0].type).toBe("session_diff")
          expect(body.data[0].data).toEqual([
            {
              file: "b.ts",
              patch:
                "Index: b.ts\n===================================================================\n--- b.ts\t\n+++ b.ts\t\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
              additions: 2,
              deletions: 0,
              status: "modified",
            },
          ])
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )
})

it.live("publishes historical messages whose model is no longer configured", () =>
  provideTmpdirInstance(() => {
    const bodies: string[] = []
    const client = HttpClient.make((req) => {
      if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array")
        bodies.push(new TextDecoder().decode(req.body.body))
      return Effect.succeed(json(req, req.url.endsWith("/api/share") ? publicShare : {}))
    })
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sharing = yield* ShareNext.Service
      const info = yield* sessions.create({ title: "historical model removed" })
      const messageID = MessageID.ascending()
      yield* sessions.updateMessage({
        id: messageID,
        sessionID: info.id,
        role: "user",
        time: { created: Date.now() },
        agent: "build",
        model: {
          providerID: ProviderV2.ID.make("removed-historical-provider"),
          modelID: ModelV2.ID.make("removed-historical-model"),
        },
      })
      yield* sessions.updatePart({
        id: PartID.ascending(),
        sessionID: info.id,
        messageID,
        type: "text",
        text: "SYNTHETIC_HISTORY_MUST_REMAIN_SHAREABLE",
      })
      const published = yield* sharing.create(info.id, "cn")
      expect(published.url).toBe(publicShare.url)
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toContain("SYNTHETIC_HISTORY_MUST_REMAIN_SHAREABLE")
      expect(bodies[0]).toContain("removed-historical-model")
      expect(bodies[0]).toContain('"type":"model","data":[]')
      expect((yield* sessions.get(info.id)).share?.url).toBe(publicShare.url)
      yield* sharing.remove(info.id)
      expect((yield* sessions.get(info.id)).share).toBeUndefined()
    }).pipe(Effect.provide(integrationLayer(client)))
  }),
)
