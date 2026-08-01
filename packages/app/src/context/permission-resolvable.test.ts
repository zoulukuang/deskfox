// FORK-ONLY: REQ-078 单测 [feat: permission-filter-concurrency] 2026-08-02
import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { candidateSignature, createResolvableCache } from "./permission-resolvable"

const perm = (id: string) => ({ id }) as PermissionRequest

describe("candidateSignature", () => {
  test("stable across session ordering, excludes filtered items, empty when none", () => {
    const a = candidateSignature({ s1: [perm("p2")], s2: [perm("p1")] }, () => false)
    const b = candidateSignature({ s2: [perm("p1")], s1: [perm("p2")] }, () => false)
    expect(a).toBe("p1,p2")
    expect(b).toBe(a)

    expect(candidateSignature({ s1: [perm("p1")] }, (item) => item.id === "p1")).toBe("")
    expect(candidateSignature({}, () => false)).toBe("")
  })
})

describe("createResolvableCache", () => {
  test("REQ-078 复现:先 A 后 A+B,两次签名各 fetch 一次(旧实现只 fetch 一次导致 B 被藏死)", async () => {
    let calls = 0
    const cache = createResolvableCache(async () => {
      calls++
      return calls === 1 ? ["A"] : ["A", "B"]
    })
    const applied: (string[] | null)[] = []

    expect(await cache.sync("/dir", "A", (ids) => applied.push(ids))).toBe("fetched")
    expect(await cache.sync("/dir", "A", (ids) => applied.push(ids))).toBe("skip") // 同签名不重复拉
    expect(await cache.sync("/dir", "A,B", (ids) => applied.push(ids))).toBe("fetched") // B 到达 → refetch
    expect(calls).toBe(2)
    expect(applied).toEqual([["A"], ["A", "B"]])
  })

  test("empty signature never fetches (e2e/offline gate)", async () => {
    let calls = 0
    const cache = createResolvableCache(async () => {
      calls++
      return []
    })
    expect(await cache.sync("/dir", "", () => {})).toBe("skip")
    expect(calls).toBe(0)
  })

  test("fetch failure applies null (fail-open)", async () => {
    const cache = createResolvableCache(async () => {
      throw new Error("boom")
    })
    const applied: (string[] | null)[] = []
    expect(await cache.sync("/dir", "sig", (ids) => applied.push(ids))).toBe("fetched")
    expect(applied).toEqual([null])
  })

  test("out-of-order responses: stale fetch result is discarded", async () => {
    const gates = new Map<string, { resolve: (ids: string[]) => void; promise: Promise<string[]> }>()
    const cache = createResolvableCache((directory) => {
      let resolve!: (ids: string[]) => void
      const promise = new Promise<string[]>((r) => (resolve = r))
      gates.set(gates.size === 0 ? "first" : "second", { resolve, promise })
      return promise
    })
    const applied: (string[] | null)[] = []

    const first = cache.sync("/dir", "sig1", (ids) => applied.push(ids))
    const second = cache.sync("/dir", "sig2", (ids) => applied.push(ids))
    gates.get("second")!.resolve(["new"])
    expect(await second).toBe("fetched")
    gates.get("first")!.resolve(["old"]) // 慢的旧请求后到
    expect(await first).toBe("stale")
    expect(applied).toEqual([["new"]])
  })
})
