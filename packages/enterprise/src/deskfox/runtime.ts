import { createRepository } from "./repository"
import { createShareApi } from "./api"

export const localShares = process.env.OPENCODE_STORAGE_ADAPTER === "filesystem"
const state: {
  service?: Promise<{
    repository: Awaited<ReturnType<typeof createRepository>>
    api: ReturnType<typeof createShareApi>
  }>
} = {}

export function shareService() {
  if (!localShares) throw new Error("Local share service is disabled")
  return (state.service ??= initialize())
}

async function initialize() {
  const directory = process.env.DESKFOX_SHARE_DIRECTORY
  const origin = process.env.DESKFOX_SHARE_PUBLIC_ORIGIN
  if (!directory || !origin) throw new Error("Share directory and public origin are required")
  const repository = await createRepository({
    directory,
    maxBytes: positive("DESKFOX_SHARE_MAX_BYTES", 64 * 1024 * 1024),
    minimumFreeBytes: positive("DESKFOX_SHARE_MIN_FREE_BYTES", 1024 * 1024 * 1024),
  })
  return {
    repository,
    api: createShareApi({
      repository,
      origin,
      requestBytes: positive("DESKFOX_SHARE_REQUEST_BYTES", 16 * 1024 * 1024),
      requestsPerMinute: positive("DESKFOX_SHARE_REQUESTS_PER_MINUTE", 120),
      createsPerMinute: positive("DESKFOX_SHARE_CREATES_PER_MINUTE", 10),
      concurrency: positive("DESKFOX_SHARE_CONCURRENCY", 16),
    }),
  }
}

function positive(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid share configuration: ${name}`)
  return value
}
