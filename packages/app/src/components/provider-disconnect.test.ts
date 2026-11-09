// [bug-repro: 配置型供应商断开后设置页里消失不掉 —— 写完 disabled_providers 没等服务端实例销毁就重拉列表]
import { describe, expect, test } from "bun:test"
import { disableProviderAndRefresh, nextDisabledProviders } from "./provider-disconnect"

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("nextDisabledProviders", () => {
  test("追加且不重复", () => {
    expect(nextDisabledProviders([], "getbot")).toEqual(["getbot"])
    expect(nextDisabledProviders(["openai"], "getbot")).toEqual(["openai", "getbot"])
    expect(nextDisabledProviders(["getbot"], "getbot")).toEqual(["getbot"])
  })

  test("不改动传入数组", () => {
    const before = ["openai"]
    nextDisabledProviders(before, "getbot")
    expect(before).toEqual(["openai"])
  })
})

describe("disableProviderAndRefresh", () => {
  test("R1 顺序:updateConfig → dispose → refresh,且 refresh 要等 dispose 完成", async () => {
    const calls: string[] = []
    const dispose = deferred()
    const run = disableProviderAndRefresh(
      {
        updateConfig: async (config) => {
          calls.push(`updateConfig:${config.disabled_providers.join(",")}`)
        },
        dispose: () => {
          calls.push("dispose")
          return dispose.promise
        },
        refresh: async () => {
          calls.push("refresh")
        },
      },
      "getbot",
      ["openai"],
    )
    // dispose 还没完成之前,绝不能已经去刷新(旧代码就是在这里撞到旧实例缓存)
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(["updateConfig:openai,getbot", "dispose"])
    dispose.resolve()
    const result = await run
    expect(calls).toEqual(["updateConfig:openai,getbot", "dispose", "refresh"])
    expect(result).toEqual({ ok: true, next: ["openai", "getbot"] })
  })

  test("R2 updateConfig 失败 → 返回失败且不 dispose / 不 refresh(调用方回滚本地 store)", async () => {
    const calls: string[] = []
    const error = new Error("write failed")
    const result = await disableProviderAndRefresh(
      {
        updateConfig: async () => {
          throw error
        },
        dispose: async () => {
          calls.push("dispose")
        },
        refresh: async () => {
          calls.push("refresh")
        },
      },
      "getbot",
      [],
    )
    expect(result).toEqual({ ok: false, error })
    expect(calls).toEqual([])
  })

  test("R3 dispose 失败不影响结果,仍然刷新列表", async () => {
    const calls: string[] = []
    const result = await disableProviderAndRefresh(
      {
        updateConfig: async () => {},
        dispose: async () => {
          throw new Error("dispose failed")
        },
        refresh: async () => {
          calls.push("refresh")
        },
      },
      "getbot",
      [],
    )
    expect(result.ok).toBe(true)
    expect(calls).toEqual(["refresh"])
  })

  test("R4 refresh 失败也只吞掉:配置已写入,断开事实成立", async () => {
    const result = await disableProviderAndRefresh(
      {
        updateConfig: async () => {},
        dispose: async () => {},
        refresh: async () => {
          throw new Error("refetch failed")
        },
      },
      "getbot",
      ["getbot"],
    )
    expect(result).toEqual({ ok: true, next: ["getbot"] })
  })
})
