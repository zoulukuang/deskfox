// FORK-ONLY test: REQ-096 — Session.Updated 投影取消归档必须把 time_archived 落 NULL
// (drizzle .set() 跳过 undefined 列的回归防线)[feat: session-list-ux]
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

// 2026-08-11 sync v1.17.13:上游 layer→node 体系,按 project-copy.test.ts 范式改 node 组装
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
const it = testEffect(AppNodeBuilder.build(LayerNode.group([SessionProjector.node, EventV2.node, Database.node])))

const sessionID = SessionV2.ID.make("ses_unarchive_test")

const info = (archived?: number): SessionV1.SessionInfo =>
  ({
    id: sessionID,
    projectID: Project.ID.global,
    slug: "unarchive-test",
    directory: "/project",
    title: "unarchive projection",
    version: "0",
    time: { created: 1000, updated: 2000, ...(archived !== undefined ? { archived } : {}) },
  }) as unknown as SessionV1.SessionInfo

describe("SessionProjector · REQ-096 unarchive", () => {
  it.effect("Updated 带 archived=undefined 时把 time_archived 清为 NULL", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const bus = yield* EventV2.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      yield* bus.publish(SessionV1.Event.Created, { sessionID, info: info() })
      // 归档
      yield* bus.publish(SessionV1.Event.Updated, { sessionID, info: info(12345) })
      const archivedRow = yield* db
        .select({ archived: SessionTable.time_archived })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      expect(archivedRow?.archived).toBe(12345)

      // 取消归档(archived 缺省 = undefined,修复前 drizzle 跳过该列,DB 永远清不掉)
      yield* bus.publish(SessionV1.Event.Updated, { sessionID, info: info() })
      const clearedRow = yield* db
        .select({ archived: SessionTable.time_archived })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      expect(clearedRow?.archived).toBeNull()
    }),
  )
})
