import { beforeEach, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ShareNext } from "@/share/share-next"
import { Session } from "@/session/session"
import { MessageID, PartID } from "@/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node])))
const live = process.env.DESKFOX_PUBLIC_SHARE_SMOKE === "1" ? it.live : it.live.skip
beforeEach(resetDatabase)

for (const target of ["cn", "global"] as const)
  live(
    `synthetic removed-model history publishes and cancels on live ${target}`,
    () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const client = yield* HttpClient.HttpClient
          yield* Effect.gen(function* () {
            const sessions = yield* Session.Service
            const sharing = yield* ShareNext.Service
            const info = yield* sessions.create({ title: "Synthetic historical-model deployment check" })
            const messageID = MessageID.ascending()
            yield* sessions.updateMessage({
              id: messageID,
              sessionID: info.id,
              role: "user",
              agent: "build",
              time: { created: Date.now() },
              model: {
                providerID: ProviderV2.ID.make("removed-synthetic-provider"),
                modelID: ModelV2.ID.make("removed-synthetic-model"),
              },
            })
            yield* sessions.updatePart({
              id: PartID.ascending(),
              sessionID: info.id,
              messageID,
              type: "text",
              text: "PUBLIC_SYNTHETIC_REMOVED_MODEL_HISTORY_OK",
            })
            yield* Effect.acquireUseRelease(
              sharing.create(info.id, target),
              (published) =>
                Effect.promise(async () => {
                  const origin = target === "cn" ? "https://deskfox.cn" : "https://deskfox.ai"
                  expect(published.url).toStartWith(origin + "/share/")
                  const page = await fetch(published.url)
                  expect(page.status).toBe(200)
                  expect(page.headers.get("cache-control")).toContain("no-store")
                  expect(await page.text()).toContain("PUBLIC_SYNTHETIC_REMOVED_MODEL_HISTORY_OK")
                  const data = await fetch(`${origin}/api/share/${published.id}/data`)
                  expect(data.status).toBe(200)
                  const text = await data.text()
                  expect(text).toContain("removed-synthetic-model")
                  expect(text).toContain('"type":"model","data":[]')
                  expect(text).not.toContain(published.secret)
                }),
              () => sharing.remove(info.id).pipe(Effect.orDie),
            )
            expect((yield* sessions.get(info.id)).share).toBeUndefined()
          }).pipe(
            Effect.provide(
              LayerNode.compile(LayerNode.group([ShareNext.node, Session.node, SessionProjector.node]), [
                [httpClient, Layer.succeed(HttpClient.HttpClient, client)],
              ]),
            ),
          )
        }).pipe(Effect.provide(FetchHttpClient.layer)),
      ),
    { timeout: 90_000 },
  )
