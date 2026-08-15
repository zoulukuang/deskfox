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
// 本文件把上述链条钉成可跑的断言。**当前这些用例描述的是 bug 现状**:修复后
// "child store 收不到 permission 事件" 一条会转红,那正是修好的信号(见文件末尾说明)。

import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import type { State } from "./global-sync/types"
import { applyDirectoryEvent } from "./global-sync/event-reducer"
import { candidateSignature, createResolvableCache } from "./permission-resolvable"

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

  test("空候选源 ⇒ 签名空 ⇒ cache 恒 skip ⇒ canResolve 恒 true(过滤层失效)", async () => {
    const [store, setStore] = createStore(childState())

    // 真实事件流:权限来了,但按当前接线只落全局、不落 child
    applyDirectoryEvent({
      event: { type: "permission.asked", properties: permissionRequest("perm_foreign", "ses_1") },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      sessionContent: false,
    })

    // ensureResolvableTracked 就是拿这个 store 算签名的
    const signature = candidateSignature(store.permission, () => false)
    expect(signature).toBe("")

    let fetched = 0
    const cache = createResolvableCache(async () => {
      fetched++
      return [] // 本端可解的 id 集:这条外来权限不在其中
    })

    let applied: string[] | null | undefined = undefined
    const result = await cache.sync("/tmp", signature, (ids) => {
      applied = ids
    })

    expect(result).toBe("skip")
    expect(fetched).toBe(0)
    expect(applied).toBeUndefined() // apply 从未被调用 → resolvableStore[dir] 保持 undefined

    // 后果:外来权限被判为「可解」→ 徽标/composer 照常展示 → 点击必 404
    expect(canResolveWith(applied, "perm_foreign")).toBe(true)
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
    let applied: string[] | null | undefined = undefined
    const result = await cache.sync("/tmp", signature, (ids) => {
      applied = ids
    })

    expect(result).toBe("fetched")
    expect(applied).toEqual([])
    // 本端不可解 → 正确地被过滤掉
    expect(canResolveWith(applied, "perm_foreign")).toBe(false)
  })
})

// 修复指引:把 ensureResolvableTracked 的候选源从 child store 改为全局 session store
// (即 directory-sync.ts 的 sessionFields Proxy 所指向的 serverSync.session.data.permission,
// 并按 directory 过滤 session)。改完后第 1 条用例的前提不再成立 —— 那条断言的是
// 「child store 收不到事件」这一客观事实,可保留;真正该转绿的是第 3 条:
// 届时签名非空、cache 会 fetch、canResolve 对外来权限返回 false。
