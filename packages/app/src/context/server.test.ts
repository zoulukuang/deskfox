import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createServerProjects,
  migrateCanonicalLocalServerState,
  nextServerAfterRemoval,
  resolveServerList,
  ServerConnection,
} from "./server"
import { ServerScope } from "@/utils/server-scope"

describe("resolveServerList", () => {
  test("lets startup auth_token credentials override a persisted same-url server", () => {
    const list = resolveServerList({
      stored: [{ url: "https://server.example.test" }],
      props: [
        {
          type: "http",
          authToken: true,
          http: {
            url: "https://server.example.test",
            username: "opencode",
            password: "secret",
          },
        },
      ],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
      username: "opencode",
      password: "secret",
    })
    expect(list[0]?.type === "http" ? list[0].authToken : false).toBe(true)
    expect(ServerConnection.key(list[0]!) as string).toBe("https://server.example.test")
  })

  test("keeps persisted credentials when startup has no auth_token", () => {
    const list = resolveServerList({
      stored: [
        {
          url: "https://server.example.test",
          username: "opencode",
          password: "saved",
        },
      ],
      props: [{ type: "http", http: { url: "https://server.example.test" } }],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
      username: "opencode",
      password: "saved",
    })
    expect(list[0]?.type === "http" ? list[0].authToken : true).toBeUndefined()
  })
})

test("treats WSL sidecars as remote server connections", () => {
  expect(
    ServerConnection.local({
      type: "sidecar",
      variant: "wsl",
      distro: "Debian",
      http: { url: "http://127.0.0.1:4097" },
    }),
  ).toBe(false)
  expect(ServerConnection.local({ type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } })).toBe(
    true,
  )
  expect(ServerConnection.local({ type: "http", http: { url: "http://localhost:4096" } })).toBe(true)
  expect(ServerConnection.local({ type: "http", http: { url: "https://server.example.test" } })).toBe(false)
})

test("active server removal falls back across built-in and persisted servers", () => {
  const local = { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } } as const
  const debian = {
    type: "sidecar",
    variant: "wsl",
    distro: "Debian",
    http: { url: "http://127.0.0.1:4097" },
  } as const

  expect(
    nextServerAfterRemoval(
      [local, debian],
      ServerConnection.Key.make("wsl:Debian"),
      ServerConnection.Key.make("sidecar"),
    ),
  ).toBe(ServerConnection.Key.make("sidecar"))
})

describe("createServerProjects", () => {
  test("keeps active and explicit server buckets in one reactive store", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const active = createServerProjects({ scope, store, setStore })
      const remote = createServerProjects({ scope: () => "https://debian.example" as ServerScope, store, setStore })

      remote.open("/repo")
      expect(remote.list()).toEqual([{ worktree: "/repo", expanded: true }])
      expect(active.list()).toEqual([])

      const adopted = createServerProjects({ scope: () => "https://debian.example" as ServerScope, store, setStore })
      expect(adopted.list()).toEqual([{ worktree: "/repo", expanded: true }])

      adopted.close("/repo")
      expect(remote.list()).toEqual([])
      dispose()
    })
  })

  test("tracks recently closed projects and drops them when reopened", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/a")
      projects.open("/b")
      projects.close("/a")
      expect(projects.recentlyClosed()).toEqual(["/a"])

      projects.close("/b")
      expect(projects.recentlyClosed()).toEqual(["/b", "/a"])

      projects.open("/a")
      expect(projects.recentlyClosed()).toEqual(["/b"])
      expect(projects.list()).toEqual([{ worktree: "/a", expanded: true }])
      dispose()
    })
  })

  test("remove drops a project without recording it as recently closed", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/repo/subdir")
      projects.remove("/repo/subdir")
      expect(projects.list()).toEqual([])
      expect(projects.recentlyClosed()).toEqual([])
      dispose()
    })
  })

  test("retains recently closed history beyond the visible display limit", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      // Closing 6 projects keeps all 6 in the store even though only 5 are displayed;
      // this prevents display-filtered entries from evicting still-visible ones.
      for (const dir of ["/1", "/2", "/3", "/4", "/5", "/6"]) {
        projects.open(dir)
        projects.close(dir)
      }
      expect(projects.recentlyClosed()).toEqual(["/6", "/5", "/4", "/3", "/2", "/1"])
      dispose()
    })
  })

  test("caps recently closed history at the store limit", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      for (let i = 1; i <= 20; i++) {
        projects.open(`/p${i}`)
        projects.close(`/p${i}`)
      }
      expect(projects.recentlyClosed()).toHaveLength(16)
      expect(projects.recentlyClosed()[0]).toBe("/p20")
      expect(projects.recentlyClosed().at(-1)).toBe("/p5")
      dispose()
    })
  })

  test("dedupes recently closed entries by normalized path", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.close("/repo")
      projects.close("/repo/")
      expect(projects.recentlyClosed()).toEqual(["/repo/"])
      dispose()
    })
  })

  // FORK: win-anchor-hide-case-fold — 持久化匹配层大小写不敏感(Windows 盘符/大小写不受控)
  describe("case-insensitive matching (windows paths)", () => {
    // TC-R1:持久化 D:\Proj + relocate(d:\proj → D:\Proj2)→ 命中旧条目并改成新路径(不静默失效)
    test("TC-R1: relocate matches persisted worktree case-insensitively", () => {
      createRoot((dispose) => {
        const [scope] = createSignal(ServerScope.local)
        const [store, setStore] = createStore({
          recentlyClosed: {},
          projects: { local: [{ worktree: "D:\\Proj", expanded: true }] },
          lastProject: { local: "D:\\Proj" },
        })
        const projects = createServerProjects({ scope, store, setStore })

        // relocate 用小写盘符调用,应命中 D:\Proj 条目
        projects.relocate("d:\\proj", "D:\\Proj2")
        expect(projects.list()).toEqual([{ worktree: "D:\\Proj2", expanded: true }])
        expect(store.lastProject.local).toBe("D:\\Proj2")
        dispose()
      })
    })

    // TC-R1b:纯大小写改名不误删条目(D:\Foo → D:\foo)
    test("TC-R1b: case-only rename updates in place (does not drop entry)", () => {
      createRoot((dispose) => {
        const [scope] = createSignal(ServerScope.local)
        const [store, setStore] = createStore({
          recentlyClosed: {},
          projects: { local: [{ worktree: "D:\\Foo", expanded: true, id: "fld_x" }] },
          lastProject: {},
        })
        const projects = createServerProjects({ scope, store, setStore })

        projects.relocate("D:\\Foo", "D:\\foo")
        expect(projects.list()).toEqual([{ worktree: "D:\\foo", expanded: true, id: "fld_x" }])
        dispose()
      })
    })

    // TC-R2:setId 大小写差异仍能回写 id
    test("TC-R2: setId matches worktree case-insensitively", () => {
      createRoot((dispose) => {
        const [scope] = createSignal(ServerScope.local)
        const [store, setStore] = createStore({
          recentlyClosed: {},
          projects: { local: [{ worktree: "D:\\Proj", expanded: true }] },
          lastProject: {},
        })
        const projects = createServerProjects({ scope, store, setStore })

        projects.setId("d:\\proj", "fld_abc")
        expect(projects.list()[0]?.id).toBe("fld_abc")
        dispose()
      })
    })

    // TC-R3:不同 server scope 隔离(不跨 server 误匹配)
    test("TC-R3: scopes stay isolated under case-folding", () => {
      createRoot((dispose) => {
        const [scope] = createSignal(ServerScope.local)
        const [store, setStore] = createStore({
          recentlyClosed: {},
          projects: { local: [{ worktree: "D:\\Proj", expanded: true }] },
          lastProject: {},
        })
        const localProjects = createServerProjects({ scope, store, setStore })
        const remoteProjects = createServerProjects({
          scope: () => "https://debian.example" as ServerScope,
          store,
          setStore,
        })

        // 在 remote scope 上 relocate 同名(小写)路径,不应动 local scope 的条目
        remoteProjects.relocate("d:\\proj", "D:\\Proj2")
        expect(localProjects.list()).toEqual([{ worktree: "D:\\Proj", expanded: true }])
        expect(remoteProjects.list()).toEqual([])
        dispose()
      })
    })

    // POSIX 回归:大小写敏感不折叠(Mac/Linux 行为不变)
    test("posix paths remain case-sensitive (no regression)", () => {
      createRoot((dispose) => {
        const [scope] = createSignal(ServerScope.local)
        const [store, setStore] = createStore({
          recentlyClosed: {},
          projects: { local: [{ worktree: "/home/User/Proj", expanded: true }] },
          lastProject: {},
        })
        const projects = createServerProjects({ scope, store, setStore })

        // 不同大小写在 POSIX 是不同目录 → relocate 不命中 → 原条目不变
        projects.relocate("/home/user/proj", "/home/user/proj2")
        expect(projects.list()).toEqual([{ worktree: "/home/User/Proj", expanded: true }])
        dispose()
      })
    })
  })
})

describe("migrateCanonicalLocalServerState", () => {
  test("moves an existing canonical web bucket into local scope", () => {
    expect(
      migrateCanonicalLocalServerState(
        {
          list: [],
          projects: { "https://opencode.example.com": [{ worktree: "/remote", expanded: true }] },
          lastProject: { "https://opencode.example.com": "/remote" },
        },
        ServerConnection.Key.make("https://opencode.example.com"),
      ),
    ).toEqual({
      list: [],
      projects: { local: [{ worktree: "/remote", expanded: true }] },
      lastProject: { local: "/remote" },
    })
  })

  test("preserves existing local state while merging a canonical web bucket", () => {
    expect(
      migrateCanonicalLocalServerState(
        {
          projects: {
            local: [{ worktree: "/local", expanded: false }],
            "https://opencode.example.com": [
              { worktree: "/local", expanded: true },
              { worktree: "/remote", expanded: true },
            ],
          },
          lastProject: { local: "/local", "https://opencode.example.com": "/remote" },
        },
        ServerConnection.Key.make("https://opencode.example.com"),
      ),
    ).toEqual({
      projects: {
        local: [
          { worktree: "/local", expanded: false },
          { worktree: "/remote", expanded: true },
        ],
      },
      lastProject: { local: "/local" },
    })
  })
})
