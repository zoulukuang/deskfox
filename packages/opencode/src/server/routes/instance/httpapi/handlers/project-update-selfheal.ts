// FORK: REQ-064 加固 — /project update 自愈重试编排(可单测,不依赖具体 service)。
// 2026-06-26 [feat: stale-path-hardening]
import { Effect } from "effect"
import type { ProjectV2 } from "@opencode-ai/core/project"
import type { Project } from "@/project/project"

/**
 * 项目身份迁移(改名/移动后 migrateProjectId 删旧 id 行)后,侧栏仍持旧 id → update 直接 404、
 * 保存静默失效。本助手封装自愈重试 + 错误映射,修掉 code-review 命中的两处:
 *
 *  - apply(originalID) 成功 → 返回。
 *  - apply(originalID) 抛 Project.NotFoundError → 用 resolveCurrentID 解析当前目录现行 id,apply 重试一次。
 *  - 自愈链任何失败(resolveCurrentID 解析失败 / 重试仍 NotFound / 其它 typed 错误)→ 一律映射回
 *    notFound(基于**客户端原始 id**),绝不:
 *      ① 把本应优雅的 404 升级成 500(非 NotFound 错误通道未映射 → 裸 500);
 *      ② 报回客户端从未请求的 resolved 新 id(原 catchTag 用 error.projectID = 重试解析出的新 id)。
 *  - apply(originalID) 的非 NotFound 错误不触发自愈、原样透传(与原 handler 行为一致)。
 *
 * 注:离线盘 sandbox exists 出错导致 fromDirectory **die→500** 的根因在 fromDirectory 本身(已由
 * project-rebind.keepSandboxUnlessConfirmedGone 修),catchAll 兜不住 defect,需该修复配合。
 */
export const selfHealUpdate = <A, EApply, R, RErr, RReq, NF>(opts: {
  originalID: ProjectV2.ID
  // 错误通道显式并入 Project.NotFoundError,使 catchTag("Project.NotFoundError") 类型合法;
  // EApply 容纳 apply 的其它错误(原样透传,不触发自愈)。
  apply: (projectID: ProjectV2.ID) => Effect.Effect<A, EApply | Project.NotFoundError, R>
  resolveCurrentID: Effect.Effect<ProjectV2.ID, RErr, RReq>
  notFound: NF
}) =>
  opts.apply(opts.originalID).pipe(
    Effect.catchTag("Project.NotFoundError", () =>
      opts.resolveCurrentID.pipe(
        Effect.flatMap(opts.apply),
        Effect.catch(() => Effect.fail(opts.notFound)),
      ),
    ),
  )
