import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import type * as SDK from "@opencode-ai/sdk/v2"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Effect, Exit, Layer, Option, Schema, Scope, Context, Stream, Schedule } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Account } from "@/account/account"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Provider } from "@/provider/provider"

import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import type { SessionID } from "@/session/schema"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { Config } from "@/config/config"
import { SessionShareTable, ShareOperationTable } from "@opencode-ai/core/share/sql" // FORK: durable source and recovery 2026-10-12
import { SessionTable } from "@opencode-ai/core/session/sql"
import { ShareSource } from "./source"
import { ShareCoordinator } from "./coordinator"
import { AccountID } from "@/account/schema"
import { randomBytes } from "node:crypto"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { EventV2 } from "@opencode-ai/core/event"

const disabled = process.env["OPENCODE_DISABLE_SHARE"] === "true" || process.env["OPENCODE_DISABLE_SHARE"] === "1"

export type Api = {
  create: string
  sync: (shareID: string) => string
  remove: (shareID: string) => string
  data: (shareID: string) => string
}

export type Req = {
  headers: Record<string, string>
  api: Api
  baseUrl: string
  source: ShareSource.ShareSource // FORK: persist non-secret request identity
}

const ShareSchema = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  secret: Schema.String,
})
export type Share = typeof ShareSchema.Type

type State = {
  queue: Map<SessionID, { id: string; data: Map<string, Data> }>
  scope: Scope.Closeable
}

type Data =
  | {
      type: "session"
      data: SDK.Session
    }
  | {
      type: "message"
      data: SDK.Message
    }
  | {
      type: "part"
      data: SDK.Part
    }
  | {
      type: "session_diff"
      data: SDK.SnapshotFileDiff[]
    }
  | {
      type: "model"
      data: SDK.Model[]
    }

export interface Interface {
  readonly init: () => Effect.Effect<void, unknown>
  readonly url: () => Effect.Effect<string, unknown>
  readonly request: () => Effect.Effect<Req, unknown>
  readonly create: (sessionID: SessionID, target?: ShareSource.ShareTarget) => Effect.Effect<Share, unknown>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ShareNext") {}

export const use = serviceUse(Service)

function api(resource: string): Api {
  return {
    create: `/api/${resource}`,
    sync: (shareID) => `/api/${resource}/${shareID}/sync`,
    remove: (shareID) => `/api/${resource}/${shareID}`,
    data: (shareID) => `/api/${resource}/${shareID}/data`,
  }
}

const legacyApi = api("share")
const consoleApi = api("shares")

function key(item: Data) {
  switch (item.type) {
    case "session":
      return "session"
    case "message":
      return `message/${item.data.id}`
    case "part":
      return `part/${item.data.messageID}/${item.data.id}`
    case "session_diff":
      return "session_diff"
    case "model":
      return "model"
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const account = yield* Account.Service
    const events = yield* EventV2Bridge.Service
    const cfg = yield* Config.Service
    const { db } = yield* Database.Service
    const http = yield* HttpClient.HttpClient
    const provider = yield* Provider.Service
    const session = yield* Session.Service

    function sync(sessionID: SessionID, data: Data[]) {
      return Effect.gen(function* () {
        if (disabled) return
        const share = yield* get(sessionID)
        if (!share || share.status === "cleanup-required") return

        const s = yield* InstanceState.get(state)
        const existing = s.queue.get(sessionID)
        if (existing?.id === share.id) {
          for (const item of data) {
            existing.data.set(key(item), item)
          }
          return
        }

        const next = new Map(data.map((item) => [key(item), item]))
        const queued = { id: share.id, data: next }
        s.queue.set(sessionID, queued)
        yield* flush(sessionID).pipe(
          Effect.catchCause(() => Effect.logError("share flush failed", { sessionID })), // FORK: no HTTP body/secret in logs
          // FORK: retain failed batches; one scoped worker retries until acknowledged or cancelled.
          Effect.repeat({ while: () => s.queue.get(sessionID) === queued, schedule: Schedule.spaced("5 seconds") }),
          Effect.delay(1000),
          Effect.forkIn(s.scope),
        )
      })
    }

    const state: InstanceState.InstanceState<State> = yield* InstanceState.make<State>(
      Effect.fn("ShareNext.state")(function* (_ctx) {
        const cache: State = { queue: new Map(), scope: yield* Scope.make() }

        yield* Effect.addFinalizer(() =>
          Scope.close(cache.scope, Exit.void).pipe(
            Effect.andThen(
              Effect.sync(() => {
                cache.queue.clear()
              }),
            ),
          ),
        )

        if (disabled) return cache

        const watch = <D extends EventV2.Definition>(
          def: D,
          fn: (data: EventV2.Data<D>) => Effect.Effect<void, unknown>,
        ) =>
          events.listen((event) => {
            if (event.type !== def.type || event.location?.directory !== _ctx.directory) return Effect.void
            return fn(event.data as EventV2.Data<D>).pipe(
              Effect.catchCause(() => Effect.logError("share subscriber failed", { type: def.type })),
            )
          })

        yield* watch(Session.Event.Updated, (data) =>
          Effect.gen(function* () {
            const info = data.info
            yield* sync(info.id, [{ type: "session", data: structuredClone(info) as SDK.Session }])
          }),
        )
        yield* watch(MessageV2.Event.Updated, (data) =>
          Effect.gen(function* () {
            const info = data.info
            yield* sync(info.sessionID, [{ type: "message", data: structuredClone(info) as SDK.Message }])
            if (info.role !== "user") return
            const model = yield* provider.getModel(info.model.providerID, info.model.modelID)
            yield* sync(info.sessionID, [{ type: "model", data: [model] }])
          }),
        )
        yield* watch(MessageV2.Event.PartUpdated, (data) =>
          sync(data.part.sessionID, [{ type: "part", data: structuredClone(data.part) as SDK.Part }]),
        )
        yield* watch(Session.Event.Diff, (data) =>
          sync(data.sessionID, [{ type: "session_diff", data: structuredClone(data.diff) as SDK.SnapshotFileDiff[] }]),
        )
        yield* watch(Session.Event.Deleted, (data) => remove(data.sessionID))

        return cache
      }),
    )

    const request = Effect.fn("ShareNext.request")(function* (
      target?: ShareSource.ShareTarget,
      stored?: ShareSource.ShareSource,
    ) {
      const headers: Record<string, string> = {}
      if (target || stored) {
        const source = stored ?? ShareSource.publicSource(target!)
        if (source.account_id) {
          const original = (yield* account.list()).find((item) => item.id === source.account_id)
          if (!original || ShareSource.checkedBase(original.url) !== source.base_url)
            throw new Error("Original share account is unavailable")
          const token = yield* account.token(AccountID.make(source.account_id))
          if (Option.isNone(token) || !source.org_id) throw new Error("Original share credentials are unavailable")
          headers.authorization = `Bearer ${token.value}`
          headers["x-org-id"] = source.org_id
        }
        return { headers, api: api(source.api_resource), baseUrl: source.base_url, source } satisfies Req
      }
      const active = yield* account.active()
      if (Option.isNone(active) || !active.value.active_org_id) {
        const baseUrl = ShareSource.checkedBase((yield* cfg.get()).enterprise?.url ?? "https://opncd.ai")
        return {
          headers,
          api: legacyApi,
          baseUrl,
          source: { base_url: baseUrl, api_resource: "share", account_id: null, org_id: null },
        } satisfies Req
      }

      const token = yield* account.token(active.value.id)
      if (Option.isNone(token)) {
        throw new Error("No active account token available for sharing")
      }

      headers.authorization = `Bearer ${token.value}`
      headers["x-org-id"] = active.value.active_org_id
      const baseUrl = ShareSource.checkedBase(active.value.url)
      return {
        headers,
        api: consoleApi,
        baseUrl,
        source: {
          base_url: baseUrl,
          api_resource: "shares",
          account_id: active.value.id,
          org_id: active.value.active_org_id,
        },
      } satisfies Req
    })

    const get = Effect.fnUntraced(function* (sessionID: SessionID) {
      const operation = yield* db
        .select()
        .from(ShareOperationTable)
        .where(eq(ShareOperationTable.session_id, sessionID))
        .get()
      const row = yield* db
        .select()
        .from(SessionShareTable)
        .where(eq(SessionShareTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (row) return { ...row, status: operation?.status ?? ("ready" as const) }
      if (!operation?.remote_id || !operation.secret || !operation.url) return
      return { ...operation, id: operation.remote_id, secret: operation.secret, url: operation.url }
    })

    // FORK: manual redirect handling prevents bearer/secret forwarding to a redirected origin.
    const execute = (req: HttpClientRequest.HttpClientRequest) =>
      http
        .execute(req)
        .pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }), Effect.timeout("30 seconds"))

    const flush = (sessionID: SessionID) =>
      ShareCoordinator.serialize(
        sessionID,
        Effect.gen(function* () {
          if (disabled) return
          const s = yield* InstanceState.get(state)
          const queued = s.queue.get(sessionID)
          if (!queued) return

          const share = yield* get(sessionID)
          if (!share || share.status === "cleanup-required" || share.id !== queued.id) {
            s.queue.delete(sessionID)
            return
          }
          if (share.status !== "ready") return
          const batch = new Map(queued.data)
          // Read fresh projected values for the queued keys so a delayed pre-snapshot event
          // cannot overwrite newer data from the initial publication.
          const data = (yield* full(sessionID))
            .filter((item) => batch.has(key(item)))
            .map((item) =>
              // Session.diff is currently a stub; diff events remain the authoritative source.
              item.type === "session_diff" ? (batch.get("session_diff") ?? item) : item,
            )
          if (data.length) yield* send(share, data)
          // An event received during the request replaces its entry and must survive this acknowledgement.
          batch.forEach((item, key) => {
            if (queued.data.get(key) === item) queued.data.delete(key)
          })
          if (!queued.data.size) s.queue.delete(sessionID)
        }),
      )

    const send = Effect.fn("ShareNext.send")(function* (
      share: NonNullable<Effect.Success<ReturnType<typeof get>>>,
      data: Data[],
    ) {
      const req = yield* request(undefined, ShareSource.recordedSource(share))
      const res = yield* HttpClientRequest.post(`${req.baseUrl}${req.api.sync(share.id)}`).pipe(
        HttpClientRequest.setHeaders(req.headers),
        HttpClientRequest.bodyJson({ secret: share.secret, data }),
        Effect.flatMap(execute),
      )
      if (res.status < 200 || res.status >= 300) throw new Error(`Share sync failed (${res.status})`)
    })

    const full = Effect.fn("ShareNext.full")(function* (sessionID: SessionID) {
      yield* Effect.logInfo("full sync", { sessionID: sessionID })
      const info = yield* session.get(sessionID)
      const diffs = yield* session.diff(sessionID)
      const messages = yield* session.messages({ sessionID })
      const models = yield* Effect.forEach(
        Array.from(
          new Map(
            messages
              .filter((msg) => msg.info.role === "user")
              .map((msg) => (msg.info as SDK.UserMessage).model)
              .map((item) => [`${item.providerID}/${item.modelID}`, item] as const),
          ).values(),
        ),
        // FORK: sharing saved history must not require its old provider to remain configured.
        (item) =>
          provider.getModel(ProviderV2.ID.make(item.providerID), ModelV2.ID.make(item.modelID)).pipe(
            Effect.catchTag("ProviderModelNotFoundError", () => Effect.succeed(undefined)),
          ),
        { concurrency: 8 },
      )

      return [
        { type: "session", data: info },
        ...messages.map((item) => ({ type: "message" as const, data: item.info })),
        ...messages.flatMap((item) => item.parts.map((part) => ({ type: "part" as const, data: part }))),
        { type: "session_diff", data: diffs },
        { type: "model", data: models.filter((model) => model !== undefined) },
      ] satisfies Data[]
    })

    const init = Effect.fn("ShareNext.init")(function* () {
      if (disabled) return
      yield* InstanceState.get(state)
      // FORK: cleanup recovery never starts a model or republishes a snapshot.
      const pending = yield* db
        .select({ operation: ShareOperationTable, session: SessionTable.id })
        .from(ShareOperationTable)
        .leftJoin(SessionTable, eq(SessionTable.id, ShareOperationTable.session_id))
        .all()
      for (const item of pending) {
        if (item.session && item.operation.status !== "cleanup-required") continue
        yield* remove(item.operation.session_id as SessionID).pipe(
          Effect.catchCause(() => Effect.logError("share cleanup remains pending")),
        )
      }
    })

    const url = Effect.fn("ShareNext.url")(function* () {
      return (yield* request()).baseUrl
    })

    const allocate = Effect.fn("ShareNext.allocate")(function* (sessionID: SessionID, req: Req, operationID: string) {
      const recoverable = ["https://deskfox.cn", "https://deskfox.ai"].includes(req.baseUrl)
      const result = yield* HttpClientRequest.post(`${req.baseUrl}${req.api.create}`).pipe(
        HttpClientRequest.setHeaders({ ...req.headers, ...(recoverable ? { "Idempotency-Key": operationID } : {}) }),
        HttpClientRequest.bodyJson({ sessionID }),
        Effect.flatMap(execute),
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? HttpClientResponse.schemaBodyJson(ShareSchema)(response)
            : Effect.fail(new Error(`Share create failed (${response.status})`)),
        ),
      )
      return ShareSource.checkedShare(result, req.source)
    })

    // FORK-BEGIN: durable publication, source pinning and process-global serialization.
    const create = (sessionID: SessionID, target?: ShareSource.ShareTarget) =>
      ShareCoordinator.serialize(
        sessionID,
        Effect.gen(function* () {
          if (disabled) throw new Error("Sharing is disabled")
          const current = yield* get(sessionID)
          if (current?.status === "ready") {
            yield* session.setShare({ sessionID, share: { url: current.url } })
            return { id: current.id, url: current.url, secret: current.secret }
          }
          const pending = yield* db
            .select()
            .from(ShareOperationTable)
            .where(eq(ShareOperationTable.session_id, sessionID))
            .get()
          if (pending?.status === "cleanup-required")
            throw new Error("Previous share cleanup must finish before publishing")
          const req = yield* request(
            target,
            pending
              ? ShareSource.recordedSource({ ...pending, id: pending.remote_id ?? "", url: pending.url ?? "" })
              : undefined,
          )
          const recoverable = ["https://deskfox.cn", "https://deskfox.ai"].includes(req.baseUrl)
          if (pending && !pending.remote_id && !recoverable)
            throw new Error("Previous share creation outcome is unknown; automatic retry is unsafe")
          const operationID = pending?.operation_id ?? randomBytes(32).toString("hex")
          if (!pending)
            yield* db
              .insert(ShareOperationTable)
              .values({ session_id: sessionID, operation_id: operationID, status: "creating", ...req.source })
              .run()

          return yield* Effect.gen(function* () {
            const result =
              pending?.remote_id && pending.secret && pending.url
                ? { id: pending.remote_id, secret: pending.secret, url: pending.url }
                : yield* allocate(sessionID, req, operationID)
            ShareSource.checkedShare(result, req.source)
            yield* db
              .update(ShareOperationTable)
              .set({ status: "created", remote_id: result.id, secret: result.secret, url: result.url })
              .where(eq(ShareOperationTable.session_id, sessionID))
              .run()
            const owner = yield* InstanceState.get(state)
            // Keep events already queued for this operation; only discard a previous generation.
            if (owner.queue.get(sessionID)?.id !== result.id) owner.queue.delete(sessionID)
            yield* db
              .update(ShareOperationTable)
              .set({ status: "initial-sync" })
              .where(eq(ShareOperationTable.session_id, sessionID))
              .run()
            const share = yield* get(sessionID)
            if (!share) throw new Error("Share recovery record is missing")
            yield* send(share, yield* full(sessionID))
            yield* db.transaction((tx) =>
              Effect.gen(function* () {
                yield* tx
                  .insert(SessionShareTable)
                  .values({ session_id: sessionID, ...result, ...req.source })
                  .onConflictDoUpdate({ target: SessionShareTable.session_id, set: { ...result, ...req.source } })
                  .run()
                yield* tx
                  .update(ShareOperationTable)
                  .set({ status: "ready" })
                  .where(eq(ShareOperationTable.session_id, sessionID))
                  .run()
              }),
            )
            // Projection shares the lock with cancellation; it cannot restore a link after DELETE.
            yield* session.setShare({ sessionID, share: { url: result.url } })
            return result
          }).pipe(
            Effect.timeout("60 seconds"),
            Effect.onError(() =>
              Effect.gen(function* () {
                const share = yield* get(sessionID)
                if (!share) return // Unknown create outcome: keep the recovery key for an exact retry.
                yield* db
                  .update(ShareOperationTable)
                  .set({ status: "cleanup-required" })
                  .where(eq(ShareOperationTable.session_id, sessionID))
                  .run()
                yield* cleanup(sessionID)
              }).pipe(Effect.catchCause(() => Effect.logError("share cleanup remains pending", { sessionID }))),
            ),
          )
        }),
      )

    const cleanup = Effect.fn("ShareNext.cleanup")(function* (sessionID: SessionID) {
      if (disabled) return
      const s = yield* InstanceState.get(state)
      s.queue.delete(sessionID)
      const share = yield* get(sessionID)
      if (!share) {
        const pending = yield* db
          .select()
          .from(ShareOperationTable)
          .where(eq(ShareOperationTable.session_id, sessionID))
          .get()
        if (!pending) return
        if (!pending.base_url || !["https://deskfox.cn", "https://deskfox.ai"].includes(pending.base_url))
          throw new Error("Unknown legacy create outcome cannot be retried safely")
        const req = yield* request(undefined, ShareSource.recordedSource({ ...pending, id: "", url: "" }))
        const result = yield* allocate(sessionID, req, pending.operation_id)
        yield* db
          .update(ShareOperationTable)
          .set({ status: "cleanup-required", remote_id: result.id, secret: result.secret, url: result.url })
          .where(eq(ShareOperationTable.session_id, sessionID))
          .run()
      }
      const owned = share ?? (yield* get(sessionID))
      if (!owned) throw new Error("Share recovery record is missing")
      yield* db
        .update(ShareOperationTable)
        .set({ status: "cleanup-required" })
        .where(eq(ShareOperationTable.session_id, sessionID))
        .run()
      const req = yield* request(undefined, ShareSource.recordedSource(owned))
      const response = yield* HttpClientRequest.delete(`${req.baseUrl}${req.api.remove(owned.id)}`).pipe(
        HttpClientRequest.setHeaders(req.headers),
        HttpClientRequest.bodyJson({ secret: owned.secret }),
        Effect.flatMap(execute),
      )
      const absent =
        response.status === 404 &&
        ["https://deskfox.cn", "https://deskfox.ai"].includes(req.baseUrl) &&
        response.headers["content-type"]?.startsWith("application/json") &&
        (yield* HttpClientResponse.schemaBodyJson(Schema.Struct({ code: Schema.String }))(response)).code ===
          "ShareNotFound"
      if (!absent && (response.status < 200 || response.status >= 300))
        throw new Error(`Share cancellation failed (${response.status})`)
      const existing = yield* db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
      if (existing) yield* session.setShare({ sessionID, share: undefined })
      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.delete(SessionShareTable).where(eq(SessionShareTable.session_id, sessionID)).run()
          yield* tx.delete(ShareOperationTable).where(eq(ShareOperationTable.session_id, sessionID)).run()
        }),
      )
    })
    const remove = (sessionID: SessionID) => ShareCoordinator.serialize(sessionID, cleanup(sessionID))
    // FORK-END

    return Service.of({ init, url, request, create, remove })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Account.node, EventV2Bridge.node, Config.node, Database.node, httpClient, Provider.node, Session.node],
})

export * as ShareNext from "./share-next"
