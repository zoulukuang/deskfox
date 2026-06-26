import * as InstanceState from "@/effect/instance-state"
import { Project } from "@/project/project"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProjectNotFoundError } from "../errors"
import { markInstanceForReload } from "../lifecycle"

export const projectHandlers = HttpApiBuilder.group(InstanceHttpApi, "project", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Project.Service
    const project = yield* ProjectV2.Service

    const list = Effect.fn("ProjectHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const current = Effect.fn("ProjectHttpApi.current")(function* () {
      return (yield* InstanceState.context).project
    })

    const initGit = Effect.fn("ProjectHttpApi.initGit")(function* () {
      const ctx = yield* InstanceState.context
      const next = yield* svc.initGit({ directory: ctx.directory, project: ctx.project })
      if (next.id === ctx.project.id && next.vcs === ctx.project.vcs && next.worktree === ctx.project.worktree)
        return next
      yield* markInstanceForReload(ctx, {
        directory: ctx.directory,
        worktree: ctx.directory,
        project: next,
      })
      return next
    })

    const update = Effect.fn("ProjectHttpApi.update")(function* (ctx: {
      params: { projectID: ProjectV2.ID }
      payload: Project.UpdatePayload
    }) {
      const apply = (projectID: ProjectV2.ID) => svc.update({ ...ctx.payload, projectID })
      return yield* apply(ctx.params.projectID).pipe(
        // FORK: REQ-064 自愈 — 项目身份迁移(改名/移动后 migrateProjectId 删旧 id 行)后,侧栏仍持旧 id
        // → update 直接 404、保存静默失效。改为:首次按 URL 旧 id 失败时,用当前 instance 真实目录
        // fromDirectory 落库/迁移拿到现行 id,重试一次;仍失败才映射成 HTTP NotFound。2026-06-25 [feat: stale-path-hardening]
        Effect.catchTag("Project.NotFoundError", () =>
          Effect.gen(function* () {
            const context = yield* InstanceState.context
            const resolved = yield* svc.fromDirectory(context.directory)
            return yield* apply(resolved.project.id)
          }),
        ),
        Effect.catchTag("Project.NotFoundError", (error) =>
          Effect.fail(
            new ProjectNotFoundError({
              projectID: error.projectID,
              message: `Project not found: ${error.projectID}`,
            }),
          ),
        ),
      )
    })

    const directories = Effect.fn("ProjectHttpApi.directories")((ctx: { params: { projectID: ProjectV2.ID } }) =>
      project.directories({ projectID: ctx.params.projectID }),
    )

    return handlers
      .handle("list", list)
      .handle("current", current)
      .handle("initGit", initGit)
      .handle("update", update)
      .handle("directories", directories)
  }),
)
