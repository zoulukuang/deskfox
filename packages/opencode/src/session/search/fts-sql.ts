// FORK-ONLY file: REQ-095 会话记录内容搜索 — FTS5 DDL/触发器/backfill SQL 集中区 [feat: session-content-search]
//
// 设计要点(详见 docs/features/session-content-search/1-spec.md / 2-plan.md):
// - external-content FTS5(session_fts 普通表存元数据+正文,session_fts_idx 虚表只存索引),
//   tokenize='trigram' 保证中文子串命中(unicode61 会把整段中文当一个 token,子串搜不到)。
// - 索引同步走 SQL 触发器挂上游 part 表:流式 delta 是 ephemeral 事件不落库(core session/event.ts
//   EphemeralDefinitions),part 行只在 projector upsert 时写,触发器不会被逐 token 打爆。
// - 不走上游 migration 体系:fresh DB 只跑 schema.gen.ts、migration 全标完成不执行,drizzle 也表达
//   不了 FTS5 虚表 → 全部 DDL 幂等(IF NOT EXISTS),由 search.ts 在首次搜索时惰性执行。
// - part AU 触发器用显式 DELETE+INSERT,不用 INSERT OR REPLACE:recursive_triggers 默认 OFF 时
//   REPLACE 的隐式 delete 不触发 session_fts 的 AD 触发器,external-content idx 会脏。
// - 回退:依次执行 DROP_STATEMENTS 即完全卸载,不留任何痕迹。

/** bump 后 ensure() 会整体 drop + rebuild + backfill(schema 演进用) */
export const FTS_SCHEMA_VERSION = "1"

/** snippet 高亮定界符:私用区字符,正文(尤其代码)天然含 `<<`/`>>` 之类,不能用可见字符 */
export const HL_START = "\uE000"
export const HL_END = "\uE001"

/** 可索引 part 判定:text 类型、非 synthetic、非 ignored、正文非空。P = part 行别名 */
const indexable = (P: string) =>
  `json_extract(${P}.data,'$.type') = 'text'
   AND COALESCE(json_extract(${P}.data,'$.synthetic'),0) <> 1
   AND COALESCE(json_extract(${P}.data,'$.ignored'),0) <> 1
   AND COALESCE(json_extract(${P}.data,'$.text'),'') <> ''`

/** 命中锚点:该 part 所在轮次的 user 消息 id(assistant 命中也定位到发起该轮的 user 消息,
 *  前端 #message-<id> hash 锚点只存在于 user message 行)。无前置 user 消息时回退自身 message_id。
 *  message id 为 ascending 标识,同 session 内字典序 = 时间序。 */
const anchor = (P: string) =>
  `COALESCE(
     (SELECT m.id FROM message m
      WHERE m.session_id = ${P}.session_id AND m.id <= ${P}.message_id
        AND json_extract(m.data,'$.role') = 'user'
      ORDER BY m.id DESC LIMIT 1),
     ${P}.message_id
   )`

const kind = (P: string) =>
  `COALESCE((SELECT json_extract(m.data,'$.role') FROM message m WHERE m.id = ${P}.message_id), 'assistant')`

const projectId = (P: string) => `COALESCE((SELECT s.project_id FROM session s WHERE s.id = ${P}.session_id), '')`

const insertColumns = `(part_id, session_id, message_id, anchor_message_id, project_id, kind, body, time_created)`

const selectFromPartRow = (P: string) =>
  `SELECT ${P}.id, ${P}.session_id, ${P}.message_id, ${anchor(P)}, ${projectId(P)}, ${kind(P)},
     json_extract(${P}.data,'$.text'), COALESCE(${P}.time_created, 0)`

/** 幂等 DDL,按顺序执行 */
export const CREATE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS session_fts_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS session_fts (
     part_id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     anchor_message_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     body TEXT NOT NULL,
     time_created INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS session_fts_session_idx ON session_fts(session_id)`,
  `CREATE INDEX IF NOT EXISTS session_fts_project_idx ON session_fts(project_id, time_created)`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS session_fts_idx USING fts5(
     body,
     content='session_fts',
     content_rowid='rowid',
     tokenize='trigram'
   )`,

  // content 表 → idx 同步(external-content 标准三件套)
  `CREATE TRIGGER IF NOT EXISTS session_fts_ai AFTER INSERT ON session_fts BEGIN
     INSERT INTO session_fts_idx(rowid, body) VALUES (NEW.rowid, NEW.body);
   END`,
  `CREATE TRIGGER IF NOT EXISTS session_fts_ad AFTER DELETE ON session_fts BEGIN
     INSERT INTO session_fts_idx(session_fts_idx, rowid, body) VALUES ('delete', OLD.rowid, OLD.body);
   END`,
  `CREATE TRIGGER IF NOT EXISTS session_fts_au AFTER UPDATE ON session_fts BEGIN
     INSERT INTO session_fts_idx(session_fts_idx, rowid, body) VALUES ('delete', OLD.rowid, OLD.body);
     INSERT INTO session_fts_idx(rowid, body) VALUES (NEW.rowid, NEW.body);
   END`,

  // 上游 part 表 → content 表增量同步
  `CREATE TRIGGER IF NOT EXISTS part_fts_ai AFTER INSERT ON part BEGIN
     INSERT INTO session_fts ${insertColumns}
     ${selectFromPartRow("NEW")}
     WHERE ${indexable("NEW")};
   END`,
  `CREATE TRIGGER IF NOT EXISTS part_fts_au AFTER UPDATE ON part BEGIN
     DELETE FROM session_fts WHERE part_id = NEW.id;
     INSERT INTO session_fts ${insertColumns}
     ${selectFromPartRow("NEW")}
     WHERE ${indexable("NEW")};
   END`,
  `CREATE TRIGGER IF NOT EXISTS part_fts_ad AFTER DELETE ON part BEGIN
     DELETE FROM session_fts WHERE part_id = OLD.id;
   END`,
]

/** 增量 backfill:补齐触发器缺席期间(升级用户存量数据)漏掉的行,幂等 */
export const BACKFILL_STATEMENT = `
  INSERT INTO session_fts ${insertColumns}
  ${selectFromPartRow("p")}
  FROM part p
  WHERE ${indexable("p")}
    AND NOT EXISTS (SELECT 1 FROM session_fts f WHERE f.part_id = p.id)
`

/** 完全卸载(回退用),按顺序执行 */
export const DROP_STATEMENTS: string[] = [
  `DROP TRIGGER IF EXISTS part_fts_ai`,
  `DROP TRIGGER IF EXISTS part_fts_au`,
  `DROP TRIGGER IF EXISTS part_fts_ad`,
  `DROP TRIGGER IF EXISTS session_fts_ai`,
  `DROP TRIGGER IF EXISTS session_fts_ad`,
  `DROP TRIGGER IF EXISTS session_fts_au`,
  `DROP TABLE IF EXISTS session_fts_idx`,
  `DROP TABLE IF EXISTS session_fts`,
  `DROP TABLE IF EXISTS session_fts_meta`,
]

/** trigram 能力探测(temp 库,不污染主库);执行失败 = 当前 SQLite 不支持,search 降级 */
export const PROBE_STATEMENTS: string[] = [
  `CREATE VIRTUAL TABLE temp.session_fts_probe USING fts5(x, tokenize='trigram')`,
  `DROP TABLE temp.session_fts_probe`,
]

export const READ_VERSION_STATEMENT = `SELECT value FROM session_fts_meta WHERE key = 'schema_version'`
export const WRITE_VERSION_STATEMENT = `INSERT INTO session_fts_meta(key, value) VALUES ('schema_version', '${FTS_SCHEMA_VERSION}')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`
