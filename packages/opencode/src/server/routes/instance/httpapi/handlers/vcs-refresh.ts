import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Git } from "@/git"
import { InstanceState } from "@/effect/instance-state"
import { vcsRefreshRequired } from "@/project/vcs-refresh-required"
import { InstanceHttpApi } from "../api"

export const vcsRefreshHandlers = HttpApiBuilder.group(InstanceHttpApi, "vcsRefresh", (handlers) =>
  Effect.gen(function* () {
    const git = yield* Git.Service
    return handlers.handle("required", (ctx) =>
      Effect.gen(function* () {
        const instance = yield* InstanceState.context
        return { shouldRefresh: yield* vcsRefreshRequired(git, instance.directory, ctx.payload.paths) }
      }),
    )
  }),
)
