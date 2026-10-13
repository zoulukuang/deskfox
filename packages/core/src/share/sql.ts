import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/sql"
import { Timestamps } from "../database/schema.sql"

export const SessionShareTable = sqliteTable("session_share", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  id: text().notNull(),
  secret: text().notNull(),
  url: text().notNull(),
  // FORK: share mutations always use the recorded origin and original account 2026-10-12
  base_url: text(),
  api_resource: text({ enum: ["share", "shares"] }),
  account_id: text(),
  org_id: text(),
  ...Timestamps,
})

// FORK: no Session FK — remote cleanup credentials must survive Session cascade deletion.
export const ShareOperationTable = sqliteTable("share_operation", {
  session_id: text().primaryKey(),
  operation_id: text().notNull().unique(),
  status: text({ enum: ["creating", "created", "initial-sync", "ready", "cleanup-required"] }).notNull(),
  base_url: text(),
  api_resource: text({ enum: ["share", "shares"] }),
  account_id: text(),
  org_id: text(),
  remote_id: text(),
  secret: text(),
  url: text(),
  ...Timestamps,
})
