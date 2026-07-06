// [fork-only] 飞书↔桌面同 session 协同呈现 单测
// [feat: feishu-desktop-session-sync] 2026-07-06
//
// 覆盖本版可程序化验的 Logic 面:
//   - REQ-073-① 停止自动归档:getOrCreateSession 新建时不再 archive
//   - REQ-073-④ bot 昵称 title:title 带 [botName] 前缀,缺省回落无前缀
//   - getOrCreateSession 共用 helper:in-memory 复用 / 创建失败回落
//   - REQ-073-⑤ 授权双端反向失效:handleExternalResolve 使卡片 settled 且不回放 opencode

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FeishuAccount } from "../../core/config-schema"
import { ChatSessionStore } from "../chat-session-store"
import { resolveChatMemberNames, resolveOpenIdNames } from "../contact-name-resolver"
import { MessagePipeline } from "../message-pipeline"
import { flattenMergeForward, type SubMessage } from "../merge-forward-flatten"
import { PermissionCardController, type PermissionRequest } from "../permission-card"
import { PromptDispatcher } from "../prompt-dispatcher"
import type { ImMessageEvent } from "../wss-client"

// ============================================================
// fixtures
// ============================================================

interface CreateCall {
  query: { directory: string }
  body: { title: string }
}

function makeFakes() {
  const created: CreateCall[] = []
  const patched: unknown[] = []
  const sentTexts: Array<{ chatId: string; text: string }> = []
  let createShouldThrow = false

  const larkClient = {
    im: {
      v1: {
        message: {
          create: async (args: any) => {
            const content = JSON.parse(args.data.content)
            sentTexts.push({ chatId: args.data.receive_id, text: content.text })
            return { data: { message_id: "om_fake" } }
          },
        },
        messageReaction: { create: async () => ({ data: {} }) },
      },
    },
  } as any

  const opencodeClient = {
    session: {
      create: async (args: CreateCall) => {
        if (createShouldThrow) throw new Error("boom-create")
        created.push(args)
        return { data: { id: `ses_new_${created.length}` } }
      },
      messages: async () => ({ data: [] }),
      promptAsync: async () => ({ data: {} }),
    },
    // 停归档后不应有人调 _client.patch;保留 spy 证明 archive 已彻底移除
    _client: {
      patch: async (a: unknown) => {
        patched.push(a)
        return {}
      },
    },
  } as any

  return {
    created,
    patched,
    sentTexts,
    larkClient,
    opencodeClient,
    setCreateThrow: (v: boolean) => {
      createShouldThrow = v
    },
  }
}

function makeAccount(overrides: Partial<FeishuAccount> = {}): FeishuAccount {
  return {
    appId: "test_app",
    appSecret: { type: "plaintext", value: "test_secret" },
    domain: "feishu",
    agent: "build",
    requireMention: true,
    ...overrides,
  } as FeishuAccount
}

function makeEvent(overrides: Partial<ImMessageEvent> = {}): ImMessageEvent {
  return {
    accountId: "acc1",
    messageId: "om_test_1",
    chatId: "oc_group_123456789",
    chatType: "group",
    messageType: "text",
    content: JSON.stringify({ text: "你好" }),
    senderOpenId: "ou_sender",
    ts: String(Date.now()),
    mentions: [],
    ...overrides,
  }
}

// ============================================================
// REQ-073-①④ + getOrCreateSession helper
// ============================================================

describe("getOrCreateSession(REQ-073-①④)", () => {
  let tmpDir: string
  let store: ChatSessionStore
  let dispatcher: PromptDispatcher
  let fakes: ReturnType<typeof makeFakes>

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "desktop-session-sync-"))
    store = new ChatSessionStore(join(tmpDir, "sessions.json"))
    dispatcher = new PromptDispatcher()
    fakes = makeFakes()
  })

  function makePipeline(botName?: string): MessagePipeline {
    return new MessagePipeline({
      account: makeAccount(botName === undefined ? {} : ({ botName } as any)),
      accountId: "acc1",
      opencodeClient: fakes.opencodeClient,
      dispatcher,
      chatSessionStore: store,
      larkClient: fakes.larkClient,
    })
  }

  test("U2 新建 session 不再 archive(REQ-073-① 停自动归档)", async () => {
    const pipeline = makePipeline("DeskFox-Mac")
    const id = await (pipeline as any).getOrCreateSession(makeEvent())
    expect(id).toBe("ses_new_1")
    expect(fakes.created).toHaveLength(1)
    // 核心断言:archive 走的 _client.patch 一次都没调
    expect(fakes.patched).toHaveLength(0)
    // 落盘仍在(第 2 项接续基础)
    expect(store.get("acc1", "oc_group_123456789")).toBe("ses_new_1")
  })

  test("U3 title 带 [botName] 前缀(REQ-073-④ 多 bot 不撞脸)", async () => {
    const pipeline = makePipeline("DeskFox-Mac")
    await (pipeline as any).getOrCreateSession(makeEvent())
    expect(fakes.created[0]!.body.title).toBe("[DeskFox-Mac] Feishu group/23456789")
  })

  test("U3b botName 缺省 → 回落无前缀(与旧 title 一致)", async () => {
    const pipeline = makePipeline(undefined)
    await (pipeline as any).getOrCreateSession(makeEvent())
    expect(fakes.created[0]!.body.title).toBe("Feishu group/23456789")
  })

  test("U1 同 chat 二次调用复用内存 session,不重复新建", async () => {
    const pipeline = makePipeline("DeskFox-Mac")
    const first = await (pipeline as any).getOrCreateSession(makeEvent())
    const second = await (pipeline as any).getOrCreateSession(makeEvent())
    expect(second).toBe(first)
    expect(fakes.created).toHaveLength(1)
  })

  test("U1b 内存 miss + store 命中 → 回读复用旧 session,不新建(REQ-073-② 跨重启接续)", async () => {
    // 模拟重启:内存空,但落盘 store 有历史映射(钉死①实证纯读盘安全)
    store.set("acc1", "oc_group_123456789", "ses_persisted_old")
    const pipeline = makePipeline("DeskFox-Mac")
    const id = await (pipeline as any).getOrCreateSession(makeEvent())
    expect(id).toBe("ses_persisted_old")
    expect(fakes.created).toHaveLength(0) // 没新建
    // 回填 sessionToChat 供 permission 路由
    expect((pipeline as any).hasSession("ses_persisted_old")).toBe(true)
  })

  test("U4 session.create 抛错 → 发飞书友好错误并返回 null", async () => {
    const pipeline = makePipeline("DeskFox-Mac")
    fakes.setCreateThrow(true)
    const id = await (pipeline as any).getOrCreateSession(makeEvent())
    expect(id).toBeNull()
    expect(fakes.sentTexts).toHaveLength(1)
    expect(fakes.sentTexts[0]!.text).toContain("DeskFox")
  })
})

// ============================================================
// REQ-073-⑤ 授权双端反向失效
// ============================================================

describe("PermissionCardController.handleExternalResolve(REQ-073-⑤)", () => {
  function makeControllerFakes() {
    const sent: Array<{ type: string }> = []
    const deleted: string[] = []
    const opencodeReplies: unknown[] = []

    const larkClient = {
      im: {
        v1: {
          message: {
            create: async (args: any) => {
              sent.push({ type: JSON.parse(args.data.content).header ? "card" : "unknown" })
              return { data: { message_id: `om_${sent.length}` } }
            },
            delete: async (args: any) => {
              deleted.push(args.path.message_id)
              return { data: {} }
            },
          },
        },
      },
    } as any

    const opencodeClient = {
      postSessionIdPermissionsPermissionId: async (a: unknown) => {
        opencodeReplies.push(a)
        return {}
      },
    } as any

    return { sent, deleted, opencodeReplies, larkClient, opencodeClient }
  }

  function makeRequest(id: string): PermissionRequest {
    return {
      id,
      sessionID: "ses_x",
      permission: "edit",
      patterns: ["/tmp/x.ts"],
      metadata: {},
      always: [],
    }
  }

  test("U5 pending 命中 → 卡片 settled + pending 清空,且不回放 opencode", async () => {
    const f = makeControllerFakes()
    const ctrl = new PermissionCardController({
      opencodeClient: f.opencodeClient,
      larkClient: f.larkClient,
      workspaceDir: "/tmp/ws",
      timeoutMs: 60_000,
    })
    await ctrl.start(makeRequest("perm_1"), "chat_1")
    expect(ctrl.size).toBe(1)
    const sentBefore = f.sent.length

    await ctrl.handleExternalResolve("perm_1", "once")

    expect(ctrl.size).toBe(0) // pending 已删
    expect(f.sent.length).toBeGreaterThan(sentBefore) // 发了 settled 卡片
    expect(f.opencodeReplies).toHaveLength(0) // 关键:没有二次回放 opencode
  })

  test("U6 pending 无此 requestID → no-op,不抛不回放", async () => {
    const f = makeControllerFakes()
    const ctrl = new PermissionCardController({
      opencodeClient: f.opencodeClient,
      larkClient: f.larkClient,
      workspaceDir: "/tmp/ws",
      timeoutMs: 60_000,
    })
    await ctrl.handleExternalResolve("nonexistent", "reject")
    expect(ctrl.size).toBe(0)
    expect(f.opencodeReplies).toHaveLength(0)
  })
})

// ============================================================
// REQ-055 + REQ-073-⑥ open_id → 昵称(flatten 查表 + resolver)
// ============================================================

describe("merge-forward senderTag 查表(REQ-055)", () => {
  function makeSub(id: string, text: string): SubMessage {
    return { message_id: `m_${id}`, msg_type: "text", sender: { id }, body: { content: JSON.stringify({ text }) }, create_time: "1" }
  }
  const baseOpts = { withSender: true, maxSubMessages: 50, maxImages: 0, depth: 0 }

  test("U9 nameMap 命中 → 显示真实昵称;未命中 → 回落 open_id 前 6 位", () => {
    const items = [makeSub("ou_alice0000", "hi"), makeSub("ou_bob111111", "yo")]
    const names = new Map([["ou_alice0000", "爱丽丝"]])
    const r = flattenMergeForward(items, { ...baseOpts, senderNames: names })
    expect(r.text).toContain("[爱丽丝]: hi") // 命中真名
    expect(r.text).toContain("[ou_bob]: yo") // 未命中回落前 6 位
  })

  test("U9b 不传 senderNames → 全回落前缀(与旧行为一致)", () => {
    const items = [makeSub("ou_alice0000", "hi")]
    const r = flattenMergeForward(items, baseOpts)
    expect(r.text).toContain("[ou_ali]: hi")
  })

  test("U9c p2p(withSender=false)→ 无 sender 前缀", () => {
    const items = [makeSub("ou_alice0000", "hi")]
    const r = flattenMergeForward(items, { ...baseOpts, withSender: false })
    expect(r.text).toBe("hi")
  })
})

describe("resolveOpenIdNames(REQ-055 底座)", () => {
  const realFetch = globalThis.fetch
  const fakeClient = { domain: "https://open.feishu.cn", tokenManager: { getTenantAccessToken: async () => "tok" } } as any

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test("U7 命中 → 返 open_id→name 映射", async () => {
    globalThis.fetch = (async () => ({
      json: async () => ({ code: 0, data: { items: [{ open_id: "ou_a", name: "阿呆" }, { open_id: "ou_b", name: "阿瓜" }] } }),
    })) as any
    const m = await resolveOpenIdNames(["ou_a", "ou_b"], fakeClient)
    expect(m.get("ou_a")).toBe("阿呆")
    expect(m.get("ou_b")).toBe("阿瓜")
  })

  test("U8 缺 scope:code=0 但 name 空 → 不入表(caller 回落前缀)", async () => {
    globalThis.fetch = (async () => ({
      json: async () => ({ code: 0, data: { items: [{ open_id: "ou_a" }] } }), // name 被字段门控挡空
    })) as any
    const m = await resolveOpenIdNames(["ou_a"], fakeClient)
    expect(m.size).toBe(0)
  })

  test("U8b code≠0(如缺权限)→ 空表,不抛", async () => {
    globalThis.fetch = (async () => ({
      json: async () => ({ code: 99991672, msg: "Access denied" }),
    })) as any
    const m = await resolveOpenIdNames(["ou_a"], fakeClient)
    expect(m.size).toBe(0)
  })

  test("U8c 空输入 → 不发请求,返空", async () => {
    let called = false
    globalThis.fetch = (async () => { called = true; return { json: async () => ({}) } }) as any
    const m = await resolveOpenIdNames([], fakeClient)
    expect(m.size).toBe(0)
    expect(called).toBe(false)
  })
})

describe("resolveChatMemberNames(REQ-073-⑥ 免-scope 群成员名)", () => {
  const realFetch = globalThis.fetch
  const fakeClient = { domain: "https://open.feishu.cn", tokenManager: { getTenantAccessToken: async () => "tok" } } as any

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test("U10 单页成员 → open_id→name 映射", async () => {
    globalThis.fetch = (async () => ({
      json: async () => ({ code: 0, data: { items: [{ member_id: "ou_a", name: "小贝" }], has_more: false } }),
    })) as any
    const m = await resolveChatMemberNames("oc_x", fakeClient)
    expect(m.get("ou_a")).toBe("小贝")
  })

  test("U10b 分页 has_more → 翻页合并", async () => {
    let call = 0
    globalThis.fetch = (async () => {
      call++
      return call === 1
        ? { json: async () => ({ code: 0, data: { items: [{ member_id: "ou_a", name: "阿" }], has_more: true, page_token: "p2" } }) }
        : { json: async () => ({ code: 0, data: { items: [{ member_id: "ou_b", name: "乙" }], has_more: false } }) }
    }) as any
    const m = await resolveChatMemberNames("oc_x", fakeClient)
    expect(m.get("ou_a")).toBe("阿")
    expect(m.get("ou_b")).toBe("乙")
    expect(call).toBe(2)
  })

  test("U10c code≠0 → 空表,不抛", async () => {
    globalThis.fetch = (async () => ({ json: async () => ({ code: 232000, msg: "chat not found" }) })) as any
    const m = await resolveChatMemberNames("oc_x", fakeClient)
    expect(m.size).toBe(0)
  })
})

describe("getGroupSenderName 注入(REQ-073-⑥)", () => {
  let tmpDir: string
  const realFetch = globalThis.fetch

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "group-sender-"))
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makePipeline() {
    // larkClient 需带 tokenManager+domain 供 getClientAuthContext
    const larkClient = {
      domain: "https://open.feishu.cn",
      tokenManager: { getTenantAccessToken: async () => "tok" },
      im: { v1: { message: { create: async () => ({ data: { message_id: "om" } }) }, messageReaction: { create: async () => ({ data: {} }) } } },
    } as any
    return new MessagePipeline({
      account: makeAccount({ botName: "投资CFO" } as any),
      accountId: "acc1",
      opencodeClient: { session: { create: async () => ({ data: { id: "ses_x" } }), messages: async () => ({ data: [] }), promptAsync: async () => ({ data: {} }) } } as any,
      dispatcher: new PromptDispatcher(),
      chatSessionStore: new ChatSessionStore(join(tmpDir, "s.json")),
      larkClient,
    })
  }

  test("U11 群消息 sender 命中成员名 → 返回真名并缓存(二次不再请求)", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return { json: async () => ({ code: 0, data: { items: [{ member_id: "ou_sender", name: "搞量化的小贝" }], has_more: false } }) }
    }) as any
    const pipeline = makePipeline()
    const ev = makeEvent({ chatType: "group", senderOpenId: "ou_sender" })
    const n1 = await (pipeline as any).getGroupSenderName(ev)
    const n2 = await (pipeline as any).getGroupSenderName(ev)
    expect(n1).toBe("搞量化的小贝")
    expect(n2).toBe("搞量化的小贝")
    expect(calls).toBe(1) // TTL 缓存命中,第二次不再翻页
  })

  test("U11b p2p → 返回 null,不发请求(不注入前缀)", async () => {
    let calls = 0
    globalThis.fetch = (async () => { calls++; return { json: async () => ({ code: 0, data: {} }) } }) as any
    const pipeline = makePipeline()
    const n = await (pipeline as any).getGroupSenderName(makeEvent({ chatType: "p2p", senderOpenId: "ou_sender" }))
    expect(n).toBeNull()
    expect(calls).toBe(0)
  })
})
