// FORK: REQ-064 加固 — /project update 自愈重试错误映射单测(平台无关)。
// [bug-repro: 自愈重试报回 resolved 新 id 而非客户端原始 id;非 NotFound 错误升级成 500] 2026-06-26 [feat: stale-path-hardening]
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Project } from "../../src/project/project"
import { ProjectNotFoundError } from "../../src/server/routes/instance/httpapi/errors"
import { selfHealUpdate } from "../../src/server/routes/instance/httpapi/handlers/project-update-selfheal"

const OLD = "prj_old" as unknown as ProjectV2.ID
const NEW = "prj_new" as unknown as ProjectV2.ID

const notFoundHttp = (id: ProjectV2.ID) =>
  new ProjectNotFoundError({ projectID: id as unknown as string, message: `Project not found: ${id}` })

const tagged404 = (id: ProjectV2.ID): Effect.Effect<string, Project.NotFoundError> =>
  Effect.fail(new Project.NotFoundError({ projectID: id }))

/** 成功取值。 */
const ok = <A>(eff: Effect.Effect<A, unknown>) => Effect.runSync(eff as Effect.Effect<A>)
/** 失败取错误对象(flip:失败→成功携带 error)。 */
const err = <E>(eff: Effect.Effect<unknown, E>) => Effect.runSync(Effect.flip(eff))

test("B1 首次 apply 成功 → 返回结果,不进自愈(resolveCurrentID 不被求值)", () => {
  const value = ok(
    selfHealUpdate({
      originalID: OLD,
      apply: (id): Effect.Effect<string, Project.NotFoundError> => Effect.succeed(`updated:${id}`),
      resolveCurrentID: Effect.sync(() => {
        throw new Error("resolveCurrentID 不应被调用")
      }),
      notFound: notFoundHttp(OLD),
    }),
  )
  expect(value).toBe("updated:prj_old")
})

test("B2 首次 404 → 解析新 id 重试成功 → 返回重试结果", () => {
  const value = ok(
    selfHealUpdate({
      originalID: OLD,
      apply: (id): Effect.Effect<string, Project.NotFoundError> =>
        id === OLD ? tagged404(OLD) : Effect.succeed(`updated:${id}`),
      resolveCurrentID: Effect.succeed(NEW),
      notFound: notFoundHttp(OLD),
    }),
  )
  expect(value).toBe("updated:prj_new")
})

test("B3 首次 404 → 解析失败 → 干净 404,projectID == 原始 id(不升级 500)", () => {
  const error = err(
    selfHealUpdate({
      originalID: OLD,
      apply: (id): Effect.Effect<string, Project.NotFoundError> => tagged404(id),
      resolveCurrentID: Effect.fail(new Error("instance context 不可用")),
      notFound: notFoundHttp(OLD),
    }),
  )
  expect(error).toBeInstanceOf(ProjectNotFoundError)
  expect((error as ProjectNotFoundError).projectID).toBe("prj_old")
})

test("B4 首次 404 → 重试仍 404 → 干净 404,projectID == 原始 id(非 resolved 新 id)", () => {
  const error = err(
    selfHealUpdate({
      originalID: OLD,
      apply: (id): Effect.Effect<string, Project.NotFoundError> => tagged404(id), // 任何 id 都 404
      resolveCurrentID: Effect.succeed(NEW),
      notFound: notFoundHttp(OLD),
    }),
  )
  expect(error).toBeInstanceOf(ProjectNotFoundError)
  expect((error as ProjectNotFoundError).projectID).toBe("prj_old")
  expect((error as ProjectNotFoundError).projectID).not.toBe("prj_new")
})

test("B5 首次非 NotFound 错误 → 原样透传,不触发自愈", () => {
  const boom = new Error("disk full")
  const error = err(
    selfHealUpdate({
      originalID: OLD,
      apply: (): Effect.Effect<string, Project.NotFoundError | Error> => Effect.fail(boom),
      resolveCurrentID: Effect.succeed(NEW),
      notFound: notFoundHttp(OLD),
    }),
  )
  expect(error).toBe(boom)
})
