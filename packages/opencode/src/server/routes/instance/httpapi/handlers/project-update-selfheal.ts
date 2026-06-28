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
 *  - 只在「确属找不到」时映射回 notFound(基于**客户端原始 id**):
 *      · resolveCurrentID 解析失败(拿不到当前目录现行 id)→ notFound;
 *      · 重试 apply 仍抛 Project.NotFoundError(解析出的 id 也不存在)→ notFound。
 *    映射时绝不报回客户端从未请求的 resolved 新 id(原 catchTag 用 error.projectID = 重试解析出的新 id)。
 *  - 但**重试 apply 的真实非 NotFound 错误**(磁盘满 / DB 写失败 / 校验失败等)**原样透传,绝不掩盖成 404** —
 *    否则用户看到误导的「项目不存在」、保存静默失败、真因被藏(code-review 命中:旧版 blanket catch 把重试
 *    的一切错误都吞成 notFound)。与 apply(originalID) 首次的非 NotFound 错误透传行为对称。
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
        // resolveCurrentID 拿不到当前目录现行 id → 干净 404(基于客户端原始 id)
        Effect.catch(() => Effect.fail(opts.notFound)),
        Effect.flatMap((currentID) =>
          opts.apply(currentID).pipe(
            // 重试仍 NotFound(解析出的 id 也不存在)→ 干净 404;
            // 真实非 NotFound 错误(磁盘满/DB 写失败/校验失败…)原样透传,不掩盖
            Effect.catchTag("Project.NotFoundError", () => Effect.fail(opts.notFound)),
          ),
        ),
      ),
    ),
  )
