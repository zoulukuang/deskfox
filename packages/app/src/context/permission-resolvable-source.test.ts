// FORK-ONLY: REQ-078 过滤层数据源回归复现 [feat: permission-filter-concurrency]
//
// 背景:REQ-078 的「谁触发谁展示」过滤层以 `sync.child(dir)[0].permission` 为候选源
// (permission.tsx `ensureResolvableTracked`)。2026-08 上游同步(1.17.4→1.18.16)后,
// permission 的权威源被挪到全局 session store:
//   ① 引导路径 global-sync/bootstrap.ts 走 `if (input.session) session.set(...)` 分支,
//      而 server-sync.tsx 建 child 时确实传了 session → 只写全局;
//   ② 事件路径 permission.asked / permission.replied 都在 event-reducer 的
//      SESSION_CONTENT_EVENTS 里,而两个 applyDirectoryEvent 调用点都传 sessionContent: false
//      → 在 reducer 开头就 early return。
// 两条写入路径都不落 child store ⇒ childStore.permission 恒空 ⇒ 候选签名恒空 ⇒
// resolvableCache 恒 skip ⇒ resolvableStore[dir] 恒 undefined ⇒ canResolve 恒 true(fail-open),
// 过滤层等于没有:别的 instance(飞书桥等)触发的权限会在本端显示幻影徽标,点了必 404。
//
// 本文件把上述链条钉成可跑的断言。
//
// 2026-08-17 REQ-112 已修复(`ensureResolvableTracked` 改读全局 session store + 按 directory 过滤,
// 见 permission.tsx / permission-resolvable.ts `scopePermissionsByDirectory`)。
// 下面前两条继续锁「child store 收不到 permission 事件」这一**客观接线事实**(它是根因,不是 bug 本身,
// 上游架构如此,不该被悄悄改回);第三条改锁**修好后的行为** —— 同一批权限走全局源时签名非空、
// cache 真去 fetch、外来权限被正确判为不可解。
// [feat: session-presentation-input-batch]

import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import type { State } from "./global-sync/types"
import { applyDirectoryEvent } from "./global-sync/event-reducer"
import { candidateSignature, createResolvableCache, scopePermissionsByDirectory } from "./permission-resolvable"

const permissionRequest = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    permission: id,
    patterns: ["*"],
    metadata: {},
    always: [],
  }) as PermissionRequest

const childState = () =>
  ({
    status: "complete",
    agent: [],
    command: [],
    project: "",
    path: { directory: "/tmp" },
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp: {},
    lsp: [],
    limit: 10,
    message: {},
    part: {},
  }) as unknown as State

// permission.tsx 的 canResolve 未导出,这里按 permission.tsx:455-459 的语义等价重写:
//   const ids = resolvableStore[directory]
//   if (ids == null) return true      // 未就绪 → fail-open
//   return ids.includes(permission.id)
const canResolveWith = (ids: string[] | null | undefined, permissionID: string) =>
  ids == null ? true : ids.includes(permissionID)

describe("REQ-078 过滤层候选源(2026-08 上游同步回归)", () => {
  test("真实接线(sessionContent: false)下,permission.asked 不写 child store", () => {
    const [store, setStore] = createStore(childState())

    applyDirectoryEvent({
      event: { type: "permission.asked", properties: permissionRequest("perm_1", "ses_1") },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      // server-sync.tsx 的两个调用点实际传的就是 false(session 内容已归全局 store)
      sessionContent: false,
    })

    expect(store.permission["ses_1"]).toBeUndefined()
  })

  test("对照:不传 sessionContent 时事件本身有效(排除用例构造错误)", () => {
    const [store, setStore] = createStore(childState())

    applyDirectoryEvent({
      event: { type: "permission.asked", properties: permissionRequest("perm_1", "ses_1") },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.permission["ses_1"]?.map((x) => x.id)).toEqual(["perm_1"])
  })

  test("修复后:候选源取全局 store ⇒ 签名非空 ⇒ 真去 fetch ⇒ 外来权限被判不可解", async () => {
    const [childStore, setChildStore] = createStore(childState())

    // 真实事件流:权限来了,只落全局、不落 child(下面用 childStore 空来对照)
    applyDirectoryEvent({
      event: { type: "permission.asked", properties: permissionRequest("perm_foreign", "ses_1") },
      store: childStore,
      setStore: setChildStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      sessionContent: false,
    })
    expect(candidateSignature(childStore.permission, () => false)).toBe("") // 旧源:空 → 这就是 bug

    // 新源:全局 session store 的 permission(形状 {[sessionID]: PermissionRequest[]},无 directory 维度)
    const globalPermission = { ses_1: [permissionRequest("perm_foreign", "ses_1")] }
    const scoped = scopePermissionsByDirectory(globalPermission, "/tmp", () => "/tmp")
    const signature = candidateSignature(scoped, () => false)
    expect(signature).toBe("perm_foreign")

    let fetched = 0
    const cache = createResolvableCache(async () => {
      fetched++
      return [] // 本端可解的 id 集:这条外来权限不在其中
    })

    // 用数组收集而非 `let applied = undefined`:回调内的赋值 TS 的控制流分析看不见,
    // 变量会被收窄成 undefined,后续 expect 拿不到真实类型(见下一条用例)。
    const appliedCalls: (string[] | null)[] = []
    const result = await cache.sync("/tmp", signature, (ids) => {
      appliedCalls.push(ids)
    })

    expect(result).toBe("fetched")
    expect(fetched).toBe(1)
    expect(appliedCalls).toEqual([[]])
    // 过滤层复活:外来权限判为不可解 → 不再显示幻影徽标
    expect(canResolveWith(appliedCalls[0], "perm_foreign")).toBe(false)
  })

  test("按 directory 裁切:别的目录的权限不进本目录候选", () => {
    const permissions = {
      ses_here: [permissionRequest("perm_here", "ses_here")],
      ses_there: [permissionRequest("perm_there", "ses_there")],
    }
    const directoryOf = (sessionID: string) => (sessionID === "ses_here" ? "/tmp" : "/other")

    const scoped = scopePermissionsByDirectory(permissions, "/tmp", directoryOf)
    expect(Object.keys(scoped)).toEqual(["ses_here"])
    expect(candidateSignature(scoped, () => false)).toBe("perm_here")
  })

  test("session 还没进 store(directory 未知)时保留 —— 不因暂时认不出就退回 fail-open", () => {
    const permissions = { ses_unknown: [permissionRequest("perm_x", "ses_unknown")] }
    const scoped = scopePermissionsByDirectory(permissions, "/tmp", () => undefined)
    expect(candidateSignature(scoped, () => false)).toBe("perm_x")
  })

  test("空列表不进候选(避免制造无意义签名变动触发多余 fetch)", () => {
    const scoped = scopePermissionsByDirectory({ ses_1: [], ses_2: undefined }, "/tmp", () => "/tmp")
    expect(scoped).toEqual({})
  })

  test("反证:候选源若真有数据,过滤层工作正常(证明失效只源于数据源为空)", async () => {
    const [store] = createStore(
      childState() as State & { permission: Record<string, PermissionRequest[]> },
    )
    // 手工把权限放进 child store,模拟 1.18 之前的写入行为
    const withData = { ...store.permission, ses_1: [permissionRequest("perm_foreign", "ses_1")] }

    const signature = candidateSignature(withData, () => false)
    expect(signature).toBe("perm_foreign")

    const cache = createResolvableCache(async () => [])
    const appliedCalls: (string[] | null)[] = []
    const result = await cache.sync("/tmp", signature, (ids) => {
      appliedCalls.push(ids)
    })

    expect(result).toBe("fetched")
    expect(appliedCalls).toHaveLength(1) // apply 被调用了一次
    expect(appliedCalls[0]).toEqual([])
    // 本端不可解 → 正确地被过滤掉
    expect(canResolveWith(appliedCalls[0], "perm_foreign")).toBe(false)
  })
})

// 原「修复指引」段已于 2026-08-17 落地:候选源改为全局 session store
// (directory-sync.ts 的 sessionFields Proxy 所指向的 serverSync.session.data.permission),
// 并经 session.get(id).directory 按目录裁切。见 permission.tsx `ensureResolvableTracked`
// 与 permission-resolvable.ts `scopePermissionsByDirectory`。
