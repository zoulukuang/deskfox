import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { DatabaseMigration } from "../src/database/migration"
import migration from "../src/database/migration/20261012052604_share-source"

test("share migration retains legacy deletion credentials through Session cascade and is idempotent", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* db.run(sql`PRAGMA foreign_keys = ON`)
      yield* db.run(sql`CREATE TABLE session (id TEXT PRIMARY KEY)`)
      yield* db.run(
        sql`CREATE TABLE session_share (session_id TEXT PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE, id TEXT NOT NULL, secret TEXT NOT NULL, url TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)`,
      )
      yield* db.run(sql`INSERT INTO session VALUES ('ses_old')`)
      yield* db.run(
        sql`INSERT INTO session_share VALUES ('ses_old', 'old_share', 'old_secret', 'https://custom.example/share/old_share', 1, 2)`,
      )
      yield* DatabaseMigration.applyOnly(db, [migration])
      const row = yield* db.get<{
        operation_id: string
        base_url: string | null
        remote_id: string
        secret: string
        status: string
      }>(sql`SELECT * FROM share_operation`)
      expect(row?.operation_id).toMatch(/^[a-f0-9]{64}$/)
      expect(row).toMatchObject({ base_url: null, remote_id: "old_share", secret: "old_secret", status: "ready" })
      yield* DatabaseMigration.applyOnly(db, [migration])
      expect(yield* db.get(sql`SELECT COUNT(*) AS count FROM share_operation`)).toEqual({ count: 1 })
      yield* db.run(sql`DELETE FROM session WHERE id = 'ses_old'`)
      expect(yield* db.get(sql`SELECT COUNT(*) AS count FROM session_share`)).toEqual({ count: 0 })
      expect(yield* db.get(sql`SELECT * FROM share_operation`)).toEqual(row)
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  ))
