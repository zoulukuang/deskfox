import { Effect, Semaphore } from "effect"

const locks = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>()

// Share operations are process-global by Session ID, independent of Location layers.
export function serialize<A, E, R>(sessionID: string, task: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const entry = locks.get(sessionID) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
      entry.users++
      locks.set(sessionID, entry)
      return entry
    }),
    (entry) => entry.semaphore.withPermits(1)(task),
    (entry) =>
      Effect.sync(() => {
        entry.users--
        if (entry.users === 0) locks.delete(sessionID)
      }),
  )
}

export * as ShareCoordinator from "./coordinator"
