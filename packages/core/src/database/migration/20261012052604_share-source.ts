import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261012052604_share-source",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`share_operation\` (
          \`session_id\` text PRIMARY KEY,
          \`operation_id\` text NOT NULL UNIQUE,
          \`status\` text NOT NULL,
          \`base_url\` text,
          \`api_resource\` text,
          \`account_id\` text,
          \`org_id\` text,
          \`remote_id\` text,
          \`secret\` text,
          \`url\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_share\` ADD \`base_url\` text;`)
      yield* tx.run(`ALTER TABLE \`session_share\` ADD \`api_resource\` text;`)
      yield* tx.run(`ALTER TABLE \`session_share\` ADD \`account_id\` text;`)
      yield* tx.run(`ALTER TABLE \`session_share\` ADD \`org_id\` text;`)
      // FORK: preserve existing remote deletion credentials independently of Session cascade.
      yield* tx.run(`
        INSERT INTO share_operation
          (session_id, operation_id, status, remote_id, secret, url, time_created, time_updated)
        SELECT session_id, lower(hex(randomblob(32))), 'ready', id, secret, url, time_created, time_updated
        FROM session_share;
      `)
    })
  },
} satisfies DatabaseMigration.Migration
