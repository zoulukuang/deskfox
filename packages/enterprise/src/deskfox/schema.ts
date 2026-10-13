import z from "zod"
import type { Share } from "../core/share"

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const number = z.number().finite().nonnegative()
const time = z.object({ created: number }).passthrough()
const session = z
  .object({
    id,
    title: z.string().max(10_000),
    directory: z.string().max(32_768),
    version: z.string().max(128),
    slug: z.string().max(256),
    projectID: id,
    time: time.extend({ updated: number }),
  })
  .passthrough()
const tokens = z
  .object({ input: number, output: number, reasoning: number, cache: z.object({ read: number, write: number }) })
  .passthrough()
// Provider IDs are arbitrary strings in the app protocol, not filesystem storage keys.
const message = z.discriminatedUnion("role", [
  z
    .object({
      id,
      sessionID: id,
      role: z.literal("user"),
      time,
      agent: z.string(),
      model: z.object({ providerID: z.string(), modelID: z.string() }).passthrough(),
    })
    .passthrough(),
  z
    .object({
      id,
      sessionID: id,
      role: z.literal("assistant"),
      time,
      parentID: id,
      agent: z.string(),
      mode: z.string(),
      providerID: z.string(),
      modelID: z.string(),
      path: z.object({ cwd: z.string(), root: z.string() }),
      cost: number,
      tokens,
    })
    .passthrough(),
])
const model = z.object({
  id: z.string().min(1).max(512),
  name: z.string(),
  providerID: z.string(),
  api: z.object({ id: z.string(), url: z.string(), npm: z.string() }),
  cost: z.object({ input: number, output: number, cache: z.object({ read: number, write: number }) }).passthrough(),
  limit: z.object({ context: number, output: number }).passthrough(),
  capabilities: z.record(z.string(), z.unknown()),
  options: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.string()),
  status: z.enum(["alpha", "beta", "deprecated", "active"]),
  release_date: z.string(),
  family: z.string().optional(),
})
const part = z
  .object({
    id,
    sessionID: id,
    messageID: id,
    type: z.enum([
      "text",
      "reasoning",
      "file",
      "tool",
      "step-start",
      "step-finish",
      "snapshot",
      "patch",
      "agent",
      "retry",
      "compaction",
      "subtask",
    ]),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (!partFields[value.type].safeParse(value).success)
      context.addIssue({ code: "custom", message: "Invalid part fields" })
  })

const metadata = z.record(z.string(), z.unknown())
const duration = z.object({ start: number, end: number.optional() })
const fileFields = z.object({
  mime: z.string(),
  url: z.string(),
  filename: z.string().optional(),
})
// Validate fields the public renderer dereferences, including nested tool attachments.
// Tool-specific input/metadata remain extensible JSON objects, as in the SDK contract.
const partFields = {
  text: z.object({
    text: z.string(),
    synthetic: z.boolean().optional(),
    ignored: z.boolean().optional(),
    time: duration.optional(),
  }),
  reasoning: z.object({ text: z.string(), time: duration }),
  file: fileFields,
  tool: z.object({
    tool: z.string(),
    callID: z.string(),
    state: z.discriminatedUnion("status", [
      z.object({ status: z.literal("pending"), input: metadata, raw: z.string() }),
      z.object({
        status: z.literal("running"),
        input: metadata,
        title: z.string().optional(),
        metadata: metadata.optional(),
        time: z.object({ start: number }),
      }),
      z.object({
        status: z.literal("completed"),
        input: metadata,
        output: z.string(),
        title: z.string(),
        metadata,
        time: z.object({ start: number, end: number, compacted: number.optional() }),
        attachments: z.array(fileFields).optional(),
      }),
      z.object({
        status: z.literal("error"),
        input: metadata,
        error: z.string(),
        metadata: metadata.optional(),
        time: z.object({ start: number, end: number }),
      }),
    ]),
  }),
  "step-start": z.object({ snapshot: z.string().optional() }),
  "step-finish": z.object({ reason: z.string().optional(), snapshot: z.string().optional(), cost: number, tokens }),
  snapshot: z.object({ snapshot: z.string() }),
  patch: z.object({ hash: z.string(), files: z.array(z.string()) }),
  agent: z.object({ name: z.string() }),
  retry: z.object({
    attempt: number,
    error: z.object({ name: z.string(), data: z.object({ message: z.string() }).passthrough() }),
    time,
  }),
  compaction: z.object({ auto: z.boolean(), overflow: z.boolean().optional() }),
  subtask: z.object({ prompt: z.string(), description: z.string(), agent: z.string(), command: z.string().optional() }),
}

export const createSchema = z.object({ sessionID: id }).strict()
export const secretSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const shareIDSchema = z.string().regex(/^[a-f0-9]{48}$/)
export const dataSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session"), data: session }),
  z.object({ type: z.literal("message"), data: message }),
  z.object({ type: z.literal("part"), data: part }),
  z.object({
    type: z.literal("session_diff"),
    data: z
      .array(
        z
          .object({ file: z.string().optional(), patch: z.string().optional(), additions: number, deletions: number })
          .passthrough(),
      )
      .max(10_000),
  }),
  z.object({ type: z.literal("model"), data: z.array(model).max(1_000) }),
])
export const syncSchema = z.object({ secret: secretSchema, data: z.array(dataSchema).max(100_000) }).strict()

export function mergeSnapshot(sessionID: string, previous: Share.Data[], input: unknown) {
  const parsed = z.array(dataSchema).max(100_000).parse(input)
  const merged = new Map(previous.map((item) => [key(item), item]))
  for (const item of parsed) {
    if (item.type === "session" && item.data.id !== sessionID) throw new Error("Session mismatch")
    if ((item.type === "message" || item.type === "part") && item.data.sessionID !== sessionID)
      throw new Error("Session mismatch")
    // The public renderer consumes SDK payloads; the boundary validates structure and ownership,
    // retaining forward-compatible optional fields without pretending z.custom validates them.
    const value = (
      item.type === "model"
        ? {
            ...item,
            data: item.data.map((model) => ({ ...model, api: { ...model.api, url: "" }, headers: {}, options: {} })),
          }
        : item
    ) as Share.Data
    merged.set(key(value), value)
  }
  if (!merged.has("session")) throw new Error("Initial snapshot requires session")
  if (merged.size > 100_000) throw new Error("Snapshot has too many records")
  for (const item of merged.values()) {
    if (item.type === "part" && !merged.has(`message/${item.data.messageID}`)) throw new Error("Part message missing")
  }
  return [...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item)
}

function key(item: Share.Data) {
  if (item.type === "message") return `message/${item.data.id}`
  if (item.type === "part") return `part/${item.data.messageID}/${item.data.id}`
  return item.type
}
