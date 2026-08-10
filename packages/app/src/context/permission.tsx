import { type Accessor, createEffect, createMemo, getOwner, onCleanup, runWithOwner } from "solid-js"
import { createStore, produce } from "solid-js/store"
// FORK: REQ-078 方案D 共享过滤层 [feat: permission-filter-concurrency] 2026-08-02
import { candidateSignature, createResolvableCache } from "./permission-resolvable"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { Persist, persisted } from "@/utils/persist"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "./server-sync"
import { useParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import {
  acceptKey,
  directoryAcceptKey,
  isDirectoryAutoAccepting,
  autoRespondsPermission,
} from "./permission-auto-respond"

type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
}) => void

function isNonAllowRule(rule: unknown) {
  if (!rule) return false
  if (typeof rule === "string") return rule !== "allow"
  if (typeof rule !== "object") return false
  if (Array.isArray(rule)) return false

  for (const action of Object.values(rule)) {
    if (action !== "allow") return true
  }

  return false
}

function hasPermissionPromptRules(permission: unknown) {
  if (!permission) return false
  if (typeof permission === "string") return permission !== "allow"
  if (typeof permission !== "object") return false
  if (Array.isArray(permission)) return false

  const config = permission as Record<string, unknown>
  return Object.values(config).some(isNonAllowRule)
}

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  gate: false,
  init: (props: { directory?: Accessor<string | undefined> }) => {
    const params = useParams()
    const serverSDK = useServerSDK()
    const serverSync = useServerSync()

    const permissionsEnabled = createMemo(() => {
      const directory = props.directory?.() ?? decode64(params.dir)
      if (!directory) return false
      const [store] = serverSync().child(directory)
      return hasPermissionPromptRules(store.config.permission)
    })

    const [store, setStore, _, ready] = persisted(
      {
        ...Persist.serverGlobal(serverSDK().scope, "permission", ["permission.v3"]),
        migrate(value) {
          if (!value || typeof value !== "object" || Array.isArray(value)) return value

          const data = value as Record<string, unknown>
          if (data.autoAccept) return value

          return {
            ...data,
            autoAccept:
              typeof data.autoAcceptEdits === "object" && data.autoAcceptEdits && !Array.isArray(data.autoAcceptEdits)
                ? data.autoAcceptEdits
                : {},
          }
        },
      },
      createStore({
        autoAccept: {} as Record<string, boolean>,
      }),
    )

    // When config has permission: "allow", auto-enable directory-level auto-accept
    createEffect(() => {
      if (!ready()) return
      const directory = props.directory?.() ?? decode64(params.dir)
      if (!directory) return
      const [childStore] = serverSync().child(directory)
      const perm = childStore.config.permission
      if (typeof perm === "string" && perm === "allow") {
        const key = directoryAcceptKey(directory)
        if (store.autoAccept[key] === undefined) {
          setStore(
            produce((draft) => {
              draft.autoAccept[key] = true
            }),
          )
        }
      }
    })

    const MAX_RESPONDED = 1000
    const RESPONDED_TTL_MS = 60 * 60 * 1000
    const responded = new Map<string, number>()
    const enableVersion = new Map<string, number>()

    function pruneResponded(now: number) {
      for (const [id, ts] of responded) {
        if (now - ts < RESPONDED_TTL_MS) break
        responded.delete(id)
      }

      for (const id of responded.keys()) {
        if (responded.size <= MAX_RESPONDED) break
        responded.delete(id)
      }
    }

    const respond: PermissionRespondFn = (input) => {
      serverSDK()
        .client.permission.respond(input)
        .catch(() => {
          responded.delete(input.permissionID)
        })
    }

    function respondOnce(permission: PermissionRequest, directory?: string) {
      const now = Date.now()
      const hit = responded.has(permission.id)
      responded.delete(permission.id)
      responded.set(permission.id, now)
      pruneResponded(now)
      if (hit) return
      respond({
        sessionID: permission.sessionID,
        permissionID: permission.id,
        response: "once",
        directory,
      })
    }

    function isAutoAccepting(sessionID: string, directory?: string) {
      const session = directory ? serverSync().child(directory, { bootstrap: false })[0].session : []
      return autoRespondsPermission(store.autoAccept, session, { sessionID }, directory)
    }

    function isAutoAcceptingDirectory(directory: string) {
      return isDirectoryAutoAccepting(store.autoAccept, directory)
    }

    function shouldAutoRespond(permission: PermissionRequest, directory?: string) {
      const session = directory ? serverSync().child(directory, { bootstrap: false })[0].session : []
      return autoRespondsPermission(store.autoAccept, session, permission, directory)
    }

    function bumpEnableVersion(sessionID: string, directory?: string) {
      const key = acceptKey(sessionID, directory)
      const next = (enableVersion.get(key) ?? 0) + 1
      enableVersion.set(key, next)
      return next
    }

    const unsubscribe = serverSDK().event.listen((e) => {
      const event = e.details
      if (event?.type !== "permission.asked") return

      const perm = event.properties
      if (!shouldAutoRespond(perm, e.name)) return

      respondOnce(perm, e.name)
    })
    onCleanup(unsubscribe)

    function enableDirectory(directory: string) {
      const key = directoryAcceptKey(directory)
      setStore(
        produce((draft) => {
          draft.autoAccept[key] = true
        }),
      )

      serverSDK()
        .client.permission.list({ directory })
        .then((x) => {
          if (!isAutoAcceptingDirectory(directory)) return
          for (const perm of x.data ?? []) {
            if (!perm?.id) continue
            if (!shouldAutoRespond(perm, directory)) continue
            respondOnce(perm, directory)
          }
        })
        .catch(() => undefined)
    }

    function disableDirectory(directory: string) {
      const key = directoryAcceptKey(directory)
      setStore(
        produce((draft) => {
          draft.autoAccept[key] = false
        }),
      )
    }

    function enable(sessionID: string, directory: string) {
      const key = acceptKey(sessionID, directory)
      const version = bumpEnableVersion(sessionID, directory)
      setStore(
        produce((draft) => {
          draft.autoAccept[key] = true
          delete draft.autoAccept[sessionID]
        }),
      )

      serverSDK()
        .client.permission.list({ directory })
        .then((x) => {
          if (enableVersion.get(key) !== version) return
          if (!isAutoAccepting(sessionID, directory)) return
          for (const perm of x.data ?? []) {
            if (!perm?.id) continue
            if (!shouldAutoRespond(perm, directory)) continue
            respondOnce(perm, directory)
          }
        })
        .catch(() => undefined)
    }

    function disable(sessionID: string, directory?: string) {
      bumpEnableVersion(sessionID, directory)
      const key = directory ? acceptKey(sessionID, directory) : sessionID
      setStore(
        produce((draft) => {
          draft.autoAccept[key] = false
          if (!directory) return
          delete draft.autoAccept[sessionID]
        }),
      )
    }

    // FORK-BEGIN: REQ-078 方案D「谁触发谁展示」共享过滤层 [feat: permission-filter-concurrency] 2026-08-02
    // 按 directory 维护「本 instance 可 resolve 的权限 id 集」:候选权限 id 集签名任一增减即
    // refetch(修复旧 composer 布尔 source 只在 false→true 沿拉一次、并发第二个权限被陈旧快照
    // fail-closed 藏死的 bug);无候选不发请求(e2e/离线不冒网络错);失败/加载中 fail-open。
    // composer 卡片、侧栏徽标、头像指示统一走 canResolve,消灭「侧栏亮灯 composer 没卡」幻影。
    const resolvableOwner = getOwner()
    const [resolvableStore, setResolvableStore] = createStore<Record<string, string[] | null>>({})
    const resolvableCache = createResolvableCache(async (directory) => {
      const r = await serverSDK().client.permission.list({ directory })
      return ((r.data ?? []) as PermissionRequest[]).map((p) => p.id)
    })
    const resolvableTracked = new Set<string>()

    function ensureResolvableTracked(directory: string) {
      if (resolvableTracked.has(directory)) return
      resolvableTracked.add(directory)
      runWithOwner(resolvableOwner, () => {
        const [childStore] = serverSync().child(directory, { bootstrap: false })
        createEffect(() => {
          const signature = candidateSignature(childStore.permission, (item) => shouldAutoRespond(item, directory))
          void resolvableCache.sync(directory, signature, (ids) => setResolvableStore(directory, ids))
        })
      })
    }

    function canResolve(permission: PermissionRequest, directory?: string) {
      if (!directory) return true
      ensureResolvableTracked(directory)
      const ids = resolvableStore[directory]
      // undefined(未拉到)/ null(拉取失败)→ fail-open 不过滤,宁可多展示不误藏
      if (ids == null) return true
      return ids.includes(permission.id)
    }
    // FORK-END

    return {
      ready,
      respond,
      autoResponds(permission: PermissionRequest, directory?: string) {
        return shouldAutoRespond(permission, directory)
      },
      // FORK: REQ-078 [feat: permission-filter-concurrency] 2026-08-02
      canResolve,
      isAutoAccepting,
      isAutoAcceptingDirectory,
      toggleAutoAccept(sessionID: string, directory: string) {
        if (isAutoAccepting(sessionID, directory)) {
          disable(sessionID, directory)
          return
        }

        enable(sessionID, directory)
      },
      toggleAutoAcceptDirectory(directory: string) {
        if (isAutoAcceptingDirectory(directory)) {
          disableDirectory(directory)
          return
        }
        enableDirectory(directory)
      },
      enableAutoAccept(sessionID: string, directory: string) {
        if (isAutoAccepting(sessionID, directory)) return
        enable(sessionID, directory)
      },
      disableAutoAccept(sessionID: string, directory?: string) {
        disable(sessionID, directory)
      },
      permissionsEnabled,
      isPermissionAllowAll(directory: string) {
        const [childStore] = serverSync().child(directory)
        const perm = childStore.config.permission
        return typeof perm === "string" && perm === "allow"
      },
    }
  },
})
