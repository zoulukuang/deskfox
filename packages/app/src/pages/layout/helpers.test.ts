import { describe, expect, test } from "bun:test"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  drainPendingDeepLinks,
  parseDeepLink,
  parseNewSessionDeepLink,
} from "./deep-links"
import { type Session } from "@opencode-ai/sdk/v2/client"
import {
  childSessionOnPath,
  closeHomeProject,
  compareSessionTime,
  displayName,
  effectiveWorkspaceOrder,
  errorMessage,
  hasProjectPermissions,
  homeProjectNavigation,
  homeProjectDirectories,
  homeSessionServerStatus,
  latestRootSession,
  orphanRootSessions,
  projectForDirectory,
  projectForSession,
  sortedRootSessions,
  toggleHomeProjectSelection,
} from "./helpers"
import { pathKey } from "@/utils/path-key"
import { ServerConnection } from "@/context/server"

const serverKey = ServerConnection.Key.make

const session = (input: Partial<Session> & Pick<Session, "id" | "directory">) =>
  ({
    title: "",
    version: "v2",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    time: { created: 0, updated: 0, archived: undefined },
    ...input,
  }) as Session

describe("layout deep links", () => {
  test("parses open-project deep links", () => {
    expect(parseDeepLink("opencode://open-project?directory=/tmp/demo")).toEqual({
      directory: "/tmp/demo",
      file: undefined,
    })
  })

  // FORK: REQ-083 open-project 可选 file 参(首启把介绍文档作首个 tab)
  test("parses open-project deep links with optional file", () => {
    expect(parseDeepLink("opencode://open-project?directory=/tmp/demo&file=intro.md")).toEqual({
      directory: "/tmp/demo",
      file: "intro.md",
    })
    expect(
      parseDeepLink("opencode://open-project?directory=%2Ftmp%2FNew%20DeskFox&file=%E5%85%B3%E4%BA%8E.md"),
    ).toEqual({ directory: "/tmp/New DeskFox", file: "关于.md" })
  })

  test("ignores non-project deep links", () => {
    expect(parseDeepLink("opencode://other?directory=/tmp/demo")).toBeUndefined()
    expect(parseDeepLink("https://example.com")).toBeUndefined()
  })

  test("ignores malformed deep links safely", () => {
    expect(() => parseDeepLink("opencode://open-project/%E0%A4%A%")).not.toThrow()
    expect(parseDeepLink("opencode://open-project/%E0%A4%A%")).toBeUndefined()
  })

  test("parses links when URL.canParse is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(URL, "canParse")
    Object.defineProperty(URL, "canParse", { configurable: true, value: undefined })
    try {
      expect(parseDeepLink("opencode://open-project?directory=/tmp/demo")).toEqual({
        directory: "/tmp/demo",
        file: undefined,
      })
    } finally {
      if (original) Object.defineProperty(URL, "canParse", original)
      if (!original) Reflect.deleteProperty(URL, "canParse")
    }
  })

  test("ignores open-project deep links without directory", () => {
    expect(parseDeepLink("opencode://open-project")).toBeUndefined()
    expect(parseDeepLink("opencode://open-project?directory=")).toBeUndefined()
  })

  test("collects only valid open-project directories", () => {
    const result = collectOpenProjectDeepLinks([
      "opencode://open-project?directory=/a",
      "opencode://other?directory=/b",
      "opencode://open-project?directory=/c",
    ])
    expect(result).toEqual([
      { directory: "/a", file: undefined },
      { directory: "/c", file: undefined },
    ])
  })

  test("parses new-session deep links with optional prompt", () => {
    expect(parseNewSessionDeepLink("opencode://new-session?directory=/tmp/demo")).toEqual({ directory: "/tmp/demo" })
    expect(parseNewSessionDeepLink("opencode://new-session?directory=/tmp/demo&prompt=hello%20world")).toEqual({
      directory: "/tmp/demo",
      prompt: "hello world",
    })
  })

  test("ignores new-session deep links without directory", () => {
    expect(parseNewSessionDeepLink("opencode://new-session")).toBeUndefined()
    expect(parseNewSessionDeepLink("opencode://new-session?directory=")).toBeUndefined()
  })

  test("collects only valid new-session deep links", () => {
    const result = collectNewSessionDeepLinks([
      "opencode://new-session?directory=/a",
      "opencode://open-project?directory=/b",
      "opencode://new-session?directory=/c&prompt=ship%20it",
    ])
    expect(result).toEqual([{ directory: "/a" }, { directory: "/c", prompt: "ship it" }])
  })

  test("drains global deep links once", () => {
    const target = {
      __OPENCODE__: {
        deepLinks: ["opencode://open-project?directory=/a"],
      },
    } as unknown as Window & { __OPENCODE__?: { deepLinks?: string[] } }

    expect(drainPendingDeepLinks(target)).toEqual(["opencode://open-project?directory=/a"])
    expect(drainPendingDeepLinks(target)).toEqual([])
  })
})

describe("layout workspace helpers", () => {
  test("normalizes trailing slash in workspace key", () => {
    expect(String(pathKey("/tmp/demo///"))).toBe("/tmp/demo")
    expect(String(pathKey("C:\\tmp\\demo\\\\"))).toBe("C:/tmp/demo")
  })

  test("preserves posix and drive roots in workspace key", () => {
    expect(String(pathKey("/"))).toBe("/")
    expect(String(pathKey("///"))).toBe("/")
    expect(String(pathKey("C:\\"))).toBe("C:/")
    expect(String(pathKey("C://"))).toBe("C:/")
    expect(String(pathKey("C:///"))).toBe("C:/")
  })

  test("keeps local first while preserving known order", () => {
    const result = effectiveWorkspaceOrder("/root", ["/root", "/b", "/c"], ["/root", "/c", "/a", "/b"])
    expect(result).toEqual(["/root", "/c", "/b"])
  })

  test("finds the latest root session across workspaces", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/root" },
          session: [session({ id: "root", directory: "/root", time: { created: 1, updated: 1, archived: undefined } })],
        },
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "workspace",
              directory: "/workspace",
              time: { created: 2, updated: 2, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("workspace")
  })

  test("sorts recent sessions by persisted update time instead of id", () => {
    const result = sortedRootSessions(
      {
        path: { directory: "/workspace" },
        session: [
          session({ id: "ses_z", directory: "/workspace", time: { created: 1, updated: 2, archived: undefined } }),
          session({ id: "ses_a", directory: "/workspace", time: { created: 1, updated: 3, archived: undefined } }),
        ],
      },
      3,
    )

    expect(result.map((item) => item.id)).toEqual(["ses_a", "ses_z"])
  })

  test("uses id only to break equal session timestamps", () => {
    const sessions = [
      session({ id: "ses_z", directory: "/workspace", time: { created: 1, updated: 2, archived: undefined } }),
      session({ id: "ses_a", directory: "/workspace", time: { created: 1, updated: 2, archived: undefined } }),
    ]

    expect(sessions.sort(compareSessionTime).map((item) => item.id)).toEqual(["ses_a", "ses_z"])
  })

  test("detects project permissions with a filter", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }, { id: "perm-hidden" }],
        child: [{ id: "perm-child" }],
      },
      (item) => item.id === "perm-child",
    )

    expect(result).toBe(true)
  })

  test("ignores project permissions filtered out", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }],
      },
      () => false,
    )

    expect(result).toBe(false)
  })

  test("ignores archived and child sessions when finding latest root session", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "archived",
              directory: "/workspace",
              time: { created: 10, updated: 10, archived: 10 },
            }),
            session({
              id: "child",
              directory: "/workspace",
              parentID: "parent",
              time: { created: 20, updated: 20, archived: undefined },
            }),
            session({
              id: "root",
              directory: "/workspace",
              time: { created: 30, updated: 30, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("root")
  })

  test("finds the direct child on the active session path", () => {
    const list = [
      session({ id: "root", directory: "/workspace" }),
      session({ id: "child", directory: "/workspace", parentID: "root" }),
      session({ id: "leaf", directory: "/workspace", parentID: "child" }),
    ]

    expect(childSessionOnPath(list, "root", "leaf")?.id).toBe("child")
    expect(childSessionOnPath(list, "child", "leaf")?.id).toBe("leaf")
    expect(childSessionOnPath(list, "root", "root")).toBeUndefined()
    expect(childSessionOnPath(list, "root", "other")).toBeUndefined()
  })

  test("formats fallback project display name", () => {
    expect(displayName({ worktree: "/tmp/app" })).toBe("app")
    expect(displayName({ worktree: "/tmp/app", name: "My App" })).toBe("My App")
    expect(displayName({ worktree: "/" })).toBe("/")
  })

  test("scopes home project selection by server", () => {
    expect(
      toggleHomeProjectSelection(undefined, serverKey("https://debian.example"), "/home/luke/repos/amazon"),
    ).toEqual({
      server: serverKey("https://debian.example"),
      directory: "/home/luke/repos/amazon",
    })
    expect(
      toggleHomeProjectSelection(
        { server: serverKey("https://windows.example"), directory: "/home/luke/repos/amazon" },
        serverKey("https://debian.example"),
        "/home/luke/repos/amazon",
      ),
    ).toEqual({ server: serverKey("https://debian.example"), directory: "/home/luke/repos/amazon" })
    expect(
      toggleHomeProjectSelection(
        { server: serverKey("https://debian.example"), directory: "/home/luke/repos/amazon" },
        serverKey("https://debian.example"),
        "/home/luke/repos/amazon",
      ),
    ).toEqual({ server: serverKey("https://debian.example") })
  })

  test("closes a home project through its server context", () => {
    const closed: string[] = []

    expect(
      closeHomeProject(
        { server: serverKey("https://windows.example"), directory: "/shared" },
        serverKey("https://debian.example"),
        { close: (directory) => closed.push(directory) },
        "/shared",
      ),
    ).toEqual({ server: serverKey("https://windows.example"), directory: "/shared" })
    expect(closed).toEqual(["/shared"])
    expect(
      closeHomeProject(
        { server: serverKey("https://debian.example"), directory: "/shared" },
        serverKey("https://debian.example"),
        { close: (directory) => closed.push(directory) },
        "/shared",
      ),
    ).toEqual({ server: serverKey("https://debian.example") })
  })

  test("defers home project navigation until its server is active", () => {
    expect(
      homeProjectNavigation(serverKey("sidecar"), serverKey("https://debian.example"), "/YW1hem9u/session"),
    ).toEqual({
      server: serverKey("https://debian.example"),
      href: "/YW1hem9u/session",
    })
    expect(
      homeProjectNavigation(
        serverKey("https://debian.example"),
        serverKey("https://debian.example"),
        "/YW1hem9u/session",
      ),
    ).toEqual({
      href: "/YW1hem9u/session",
    })
  })

  test("preserves picker order when adding multiple projects", () => {
    expect(homeProjectDirectories(["/first", "/second"])).toEqual(["/first", "/second"])
    expect(homeProjectDirectories("/only")).toEqual(["/only"])
    expect(homeProjectDirectories(null)).toEqual([])
  })

  test("hides status derived from an inactive server", () => {
    let reads = 0
    const status = () => {
      reads++
      return { working: true, tint: "red" }
    }
    expect(homeSessionServerStatus(false, status)).toEqual({
      working: false,
      tint: undefined,
    })
    expect(reads).toBe(0)
    expect(homeSessionServerStatus(true, status)).toEqual({
      working: true,
      tint: "red",
    })
    expect(reads).toBe(1)
  })

  test("extracts api error message and fallback", () => {
    expect(errorMessage({ data: { message: "boom" } }, "fallback")).toBe("boom")
    expect(errorMessage(new Error("broken"), "fallback")).toBe("broken")
    expect(errorMessage("unknown", "fallback")).toBe("fallback")
  })
})

// FORK: REQ-072 复制项目独立展示 — projectForDirectory 解析优先级
describe("projectForDirectory", () => {
  const original = {
    id: "shared-id",
    worktree: "/Users/u/Projects/original",
    sandboxes: ["/Users/u/copy"],
    expanded: true,
  }
  const copy = { id: "shared-id", worktree: "/Users/u/copy", sandboxes: ["/Users/u/copy"], expanded: true }

  test("自身条目优先:副本目录有独立条目时解析到副本,不跳回原项目", () => {
    // 副本被后端登记为原项目 sandbox;两个条目都在(顺序不限)
    expect(projectForDirectory([original, copy], "/Users/u/copy")).toBe(copy)
    expect(projectForDirectory([copy, original], "/Users/u/copy")).toBe(copy)
  })

  test("sandbox 兜底:纯 workspace sandbox(无独立条目)仍归属原项目", () => {
    expect(projectForDirectory([original], "/Users/u/copy")).toBe(original)
  })

  test("原项目路径解析不受副本条目影响", () => {
    expect(projectForDirectory([copy, original], "/Users/u/Projects/original")).toBe(original)
  })

  test("未命中返回 undefined", () => {
    expect(projectForDirectory([original, copy], "/Users/u/elsewhere")).toBeUndefined()
  })

  test("projectForSession 目录兜底同样自身条目优先", () => {
    const s = session({ id: "ses_x", directory: "/Users/u/copy", projectID: "unknown-id" as never })
    expect(projectForSession(s, [original, copy])).toBe(copy)
  })
})

// FORK: REQ-072 复制项目独立展示 — 无人认领会话归主分节
describe("orphanRootSessions", () => {
  const now = 1000000
  const mk = (id: string, directory: string, extra: Partial<Session> = {}) =>
    session({ id, directory, ...extra })

  test("共享自原目录的会话(不在可见分节)归主分节显示", () => {
    const store = {
      session: [mk("ses_orig", "/Users/u/Projects/original"), mk("ses_here", "/Users/u/copy")],
      path: { directory: "/Users/u/copy" },
    }
    const orphans = orphanRootSessions(store, ["/Users/u/copy"], now)
    expect(orphans.map((s) => s.id)).toEqual(["ses_orig"])
  })

  test("被可见分节认领的会话不重复出现", () => {
    const store = {
      session: [mk("ses_a", "/w"), mk("ses_b", "/w/sandbox")],
      path: { directory: "/w" },
    }
    expect(orphanRootSessions(store, ["/w", "/w/sandbox"], now)).toEqual([])
  })

  test("子会话与已归档会话不进主分节", () => {
    const store = {
      session: [
        mk("ses_child", "/elsewhere", { parentID: "ses_x" as never }),
        mk("ses_archived", "/elsewhere", { time: { created: 1, updated: 2, archived: 3 } as never }),
        mk("ses_live", "/elsewhere"),
      ],
      path: { directory: "/w" },
    }
    expect(orphanRootSessions(store, ["/w"], now).map((s) => s.id)).toEqual(["ses_live"])
  })
})
