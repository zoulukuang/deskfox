// [fork-only] 飞书↔桌面同 session 协同呈现 单测
// [feat: feishu-desktop-session-sync] 2026-07-06
//
// 覆盖本版可程序化验的 Logic 面:
//   - REQ-073-① 停止自动归档:getOrCreateSession 新建时不再 archive
//   - REQ-073-④ bot 昵称 title:title 带 [botName] 前缀,缺省回落无前缀
//   - getOrCreateSession 共用 helper:in-memory 复用 / 创建失败回落
//   - REQ-073-⑤ 授权双端反向失效:handleExternalResolve 使卡片 settled 且不回放 opencode

import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FeishuAccount } from "../../core/config-schema"
import { ChatSessionStore } from "../chat-session-store"
import { MessagePipeline } from "../message-pipeline"
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
