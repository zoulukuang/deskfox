import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { createFileStore } from "./file-store"
import { createSchema, mergeSnapshot, secretSchema, shareIDSchema } from "./schema"
import type { Share } from "../core/share"
import z from "zod"

export const envelopeSchema = z.object({
  version: z.literal(1),
  id: shareIDSchema,
  recoveryHash: z.string(),
  payloadHash: z.string(),
  status: z.enum(["created", "ready", "deleted"]),
  updated: z.number(),
  info: z.object({ id: shareIDSchema, sessionID: z.string(), secret: secretSchema }).optional(),
  data: z.array(z.unknown()).optional(),
})
const locks = new Map<string, Promise<unknown>>()

export class ShareFailure extends Error {
  constructor(
    public code: "ShareNotFound" | "ShareForbidden" | "ShareConflict" | "ShareTooLarge" | "ShareInvalid",
    public status: 400 | 403 | 404 | 409 | 413,
  ) {
    super(code)
  }
}

export async function createRepository(options: { directory: string; maxBytes: number; minimumFreeBytes: number }) {
  const store = await createFileStore(options.directory, options.minimumFreeBytes)
  const run = <T>(id: string, action: () => Promise<T>) => {
    shareIDSchema.parse(id)
    const key = `${options.directory}/${id}`
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(action)
    locks.set(key, next)
    return next.finally(() => {
      if (locks.get(key) === next) locks.delete(key)
    })
  }
  const read = async (id: string) => {
    const text = await store.read(id)
    if (!text) return
    const value = envelopeSchema.parse(JSON.parse(text))
    if (value.id !== id) throw new Error("Corrupt share envelope")
    return value
  }
  const active = async (id: string, secret?: string) => {
    const value = await read(id)
    if (!value || value.status === "deleted" || !value.info) throw new ShareFailure("ShareNotFound", 404)
    if (secret !== undefined && !equal(value.info.secret, secret)) throw new ShareFailure("ShareForbidden", 403)
    return { ...value, info: value.info }
  }
  return {
    create: async (input: unknown, recoveryKey = randomBytes(32).toString("hex")) => {
      const body = createSchema.parse(input)
      secretSchema.parse(recoveryKey)
      const id = hash(`id:${recoveryKey}`).slice(0, 48)
      const recoveryHash = hash(`recovery:${recoveryKey}`)
      const payloadHash = hash(JSON.stringify(body))
      return run(id, async () => {
        const existing = await read(id)
        if (existing) {
          if (
            existing.status === "deleted" ||
            existing.payloadHash !== payloadHash ||
            existing.recoveryHash !== recoveryHash ||
            !existing.info
          )
            throw new ShareFailure("ShareConflict", 409)
          return existing.info
        }
        const info = { id, sessionID: body.sessionID, secret: randomBytes(32).toString("hex") }
        await store.write(
          id,
          JSON.stringify({
            version: 1,
            id,
            recoveryHash,
            payloadHash,
            info,
            status: "created",
            updated: Date.now(),
            data: [],
          }),
        )
        return info
      })
    },
    sync: (input: { share: { id: string; secret: string }; data: unknown }) =>
      run(input.share.id, async () => {
        const value = await active(input.share.id, input.share.secret)
        const data = await Promise.resolve()
          .then(() => mergeSnapshot(value.info.sessionID, (value.data ?? []) as Share.Data[], input.data))
          .catch(() => {
            throw new ShareFailure("ShareInvalid", 400)
          })
        const text = JSON.stringify({ ...value, status: "ready", updated: Date.now(), data })
        if (Buffer.byteLength(text) > options.maxBytes) throw new ShareFailure("ShareTooLarge", 413)
        await store.write(value.id, text)
      }),
    remove: (input: { id: string; secret: string }) =>
      run(input.id, async () => {
        const value = await active(input.id, input.secret)
        // A single durable tombstone simultaneously removes metadata and body. Recovery keys
        // remain consumed; a late sync or lost create response can never revive this share.
        await store.write(
          value.id,
          JSON.stringify({
            version: 1,
            id: value.id,
            recoveryHash: value.recoveryHash,
            payloadHash: value.payloadHash,
            status: "deleted",
            updated: Date.now(),
          }),
        )
      }),
    get: (id: string) =>
      run(id, async () => {
        const value = await read(id)
        if (value?.status !== "ready" || !value.info) return
        return { id: value.info.id, sessionID: value.info.sessionID }
      }),
    data: (id: string) =>
      run(id, async () => {
        const value = await active(id)
        if (value.status !== "ready") throw new ShareFailure("ShareNotFound", 404)
        return mergeSnapshot(value.info.sessionID, [], value.data)
      }),
  }
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function equal(a: string, b: string) {
  const actual = Buffer.from(b)
  const expected = Buffer.from(a)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
