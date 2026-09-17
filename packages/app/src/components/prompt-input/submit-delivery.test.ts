// [bug-repro: 后端半死时 prompt 请求既不 resolve 也不 reject(挂住),消息在 message 表 /
//              session_input 表 / 日志三处皆无,既不落盘也不重投也不回吐 —— 就这么蒸发了]
// REQ-100 ④ · 2026-09-17 · [feat: release-closeout-2026-09]
//
// 本测试守护的是「让失败能被判出来」这一层:回吐路径(撤乐观消息 + busy 归 idle + 上抛)
// 本来就在 sendFollowupDraft 的 catch 里,问题是请求挂住时它永远等不到。
// 超时 abort 把"挂住"翻译成一次真实的 reject,catch 才跑得起来。

import { describe, expect, test } from "bun:test"
import { isPromptNotDelivered, sendFollowupDraft, type FollowupDraft } from "./submit"

type StatusRecord = { type: string }

function harness(prompt: (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>) {
  const status: Record<string, StatusRecord> = {}
  const removed: string[] = []
  const added: string[] = []

  const draft: FollowupDraft = {
    sessionID: "ses_1",
    sessionDirectory: "/tmp/project",
    prompt: [{ type: "text", content: "按这个处理吧" } as never],
    context: [],
    agent: "build",
    model: { providerID: "anthropic", modelID: "claude-opus-5" },
  }

  const serverSync = {
    session: {
      set: (_key: string, sessionID: string, value: StatusRecord) => {
        status[sessionID] = value
      },
    },
  }

  const sync = {
    data: { command: [] as { name: string }[] },
    session: {
      optimistic: {
        add: (input: { messageID?: string; message?: { id: string } }) => {
          added.push(input.message?.id ?? "")
        },
        remove: (input: { messageID: string }) => {
          removed.push(input.messageID)
        },
      },
    },
  }

  return {
    status,
    removed,
    added,
    run: () =>
      sendFollowupDraft({
        api: { prompt } as never,
        sync: sync as never,
        serverSync: serverSync as never,
        draft,
        messageID: "msg_1",
        optimisticBusy: true,
        // 生产是 20s;测试注入 30ms,免得单测跑 20 秒
        deliveryTimeoutMs: 30,
      }),
  }
}

describe("sendFollowupDraft · 送达超时", () => {
  test("后端挂住(永不 settle)→ 超时后抛 PromptNotDeliveredError,而不是一直等下去", async () => {
    const h = harness(() => new Promise(() => {}))
    const err = await h.run().then(
      () => undefined,
      (e) => e,
    )
    expect(err).toBeDefined()
    expect(isPromptNotDelivered(err)).toBe(true)
  })

  test("超时后乐观消息被撤下 —— 不能既留在时间线又回到输入框", async () => {
    const h = harness(() => new Promise(() => {}))
    await h.run().catch(() => {})
    expect(h.added).toEqual(["msg_1"])
    expect(h.removed).toEqual(["msg_1"])
  })

  test("超时后会话 busy 回滚到 idle —— 消息都没发出去,不该留着转圈", async () => {
    const h = harness(() => new Promise(() => {}))
    await h.run().catch(() => {})
    expect(h.status["ses_1"]).toEqual({ type: "idle" })
  })

  test("超时会 abort 请求本身 —— 只 race 不 abort 的话请求可能回吐之后才落地,造成双份", async () => {
    let seen: AbortSignal | undefined
    const h = harness((_input, options) => {
      seen = options?.signal
      return new Promise(() => {})
    })
    await h.run().catch(() => {})
    expect(seen).toBeDefined()
    expect(seen!.aborted).toBe(true)
  })

  test("正常返回 → 不触发超时路径,乐观消息保留", async () => {
    const h = harness(async () => ({ ok: true }))
    await expect(h.run()).resolves.toBe(true)
    expect(h.removed).toEqual([])
    expect(h.status["ses_1"]).toEqual({ type: "busy" })
  })

  test("后端明确报错 → 原样上抛,不冒充「未送达」(两种情形文案与处置不同)", async () => {
    const boom = new Error("ProviderModelNotFoundError")
    const h = harness(async () => {
      throw boom
    })
    const err = await h.run().then(
      () => undefined,
      (e) => e,
    )
    expect(err).toBe(boom)
    expect(isPromptNotDelivered(err)).toBe(false)
    // 明确失败同样要撤乐观消息 + 归 idle
    expect(h.removed).toEqual(["msg_1"])
    expect(h.status["ses_1"]).toEqual({ type: "idle" })
  })
})

describe("isPromptNotDelivered", () => {
  test("只认自家错误,不误判", () => {
    expect(isPromptNotDelivered(new Error("boom"))).toBe(false)
    expect(isPromptNotDelivered(undefined)).toBe(false)
    expect(isPromptNotDelivered(null)).toBe(false)
    expect(isPromptNotDelivered("notDelivered")).toBe(false)
    expect(isPromptNotDelivered({ notDelivered: true })).toBe(true)
  })
})
