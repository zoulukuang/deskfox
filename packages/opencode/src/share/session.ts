import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Effect, Layer, Scope, Context } from "effect"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ShareNext } from "./share-next"
import type { ShareSource } from "./source" // FORK: explicit public target 2026-10-12
import { EventV2Bridge } from "@/event-v2-bridge"

export interface Interface {
  readonly create: (input?: Session.CreateInput) => Effect.Effect<Session.Info>
  readonly share: (sessionID: SessionID, target?: ShareSource.ShareTarget) => Effect.Effect<{ url: string }, unknown>
  readonly unshare: (sessionID: SessionID) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionShare") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const session = yield* Session.Service
    const shareNext = yield* ShareNext.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const events = yield* EventV2Bridge.Service // FORK: automatic share failures are visible

    const share = Effect.fn("SessionShare.share")(function* (sessionID: SessionID, target?: ShareSource.ShareTarget) {
      const conf = yield* cfg.get()
      if (conf.share === "disabled") throw new Error("Sharing is disabled in configuration")
      return yield* shareNext.create(sessionID, target) // FORK: projection is serialized with publication/cancellation
    })

    const unshare = Effect.fn("SessionShare.unshare")(function* (sessionID: SessionID) {
      yield* shareNext.remove(sessionID)
    })

    const create = Effect.fn("SessionShare.create")(function* (input?: Session.CreateInput) {
      const result = yield* session.create(input)
      if (result.parentID) return result
      const conf = yield* cfg.get()
      if (!(flags.autoShare || conf.share === "auto")) return result
      // FORK-BEGIN: automatic publication has no click locale and must never silently fall back.
      if (flags.client === "desktop" && !conf.share_target) {
        yield* events.publish(Session.Event.Error, {
          sessionID: result.id,
          error: {
            name: "UnknownError",
            data: {
              message:
                "Automatic public sharing requires an explicit share_target (cn or global). This session was not shared.",
            },
          },
        })
        return result
      }
      yield* share(result.id, flags.client === "desktop" ? conf.share_target : undefined).pipe(
        Effect.catchCause(() =>
          events.publish(Session.Event.Error, {
            sessionID: result.id,
            error: {
              name: "UnknownError",
              data: {
                message: "Automatic sharing failed. Publish manually to retry; no successful share has been confirmed.",
              },
            },
          }),
        ),
        Effect.forkIn(scope),
      )
      // FORK-END
      return result
    })

    return Service.of({ create, share, unshare })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, Session.node, ShareNext.node, RuntimeFlags.node, EventV2Bridge.node], // FORK: visible automatic-share failure events
})

export * as SessionShare from "./session"
