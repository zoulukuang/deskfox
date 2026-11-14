// [fork-only] voice-acp-bridge — TC-U2 目录决策 / TC-U3 resume 透明换新 [feat: voice-acp-bridge] 2026-08-24
//
// 两条要求在这里交汇,而且**看起来互相矛盾**(见 sessions.ts 文件头):
//   · 每次网关启动重建 coordinator(否则老历史 few-shot 污染路由判断);
//   · resume 必须幂等(qwen 每轮 prompt 前都会 resume 一次,只为重注入 MCP)。
import { describe, expect, test } from "bun:test"
import { createSessionStore, resolveSessionDirectory } from "./sessions"

const QWEN_HTTP = { type: "http", name: "qwen_audio_agent", url: "http://127.0.0.1:1/mcp", headers: [] }
const BUILTIN = { name: "open-computer-use", command: "/usr/bin/node", args: [] }

const VOICE_DIR = "/home/u/.deskfox/voice"

function store(opts: { activeProject?: string } = {}) {
  const created: { directory: string; coordinator: boolean }[] = []
  const logs: string[] = []
  let seq = 0
  const s = createSessionStore({
    voiceDir: VOICE_DIR,
    readActiveProject: () => opts.activeProject ?? "",
    createSidecarSession: async (directory, coordinator) => {
      created.push({ directory, coordinator })
      return `ses_${++seq}`
    },
    log: (m) => logs.push(m),
  })
  return { s, created, logs }
}

describe("resolveSessionDirectory — TC-U2", () => {
  test("coordinator 一律落 voice 独立目录(递归防护的地基)", () => {
    expect(
      resolveSessionDirectory({
        requestedCwd: "/some/project",
        voiceDir: VOICE_DIR,
        activeProject: "/other/project",
        coordinator: true,
      }),
    ).toBe(VOICE_DIR)
  })

  // ★ 1-spec §3.5:网关工作目录启动时钉死,切项目不跟随 —— 桥无视 qwen 给的 cwd
  test("第三层优先用 DeskFox 当前项目,而不是 qwen 给的启动期 cwd", () => {
    expect(
      resolveSessionDirectory({
        requestedCwd: "/启动时那个项目",
        voiceDir: VOICE_DIR,
        activeProject: "/用户此刻在看的项目",
        coordinator: false,
      }),
    ).toBe("/用户此刻在看的项目")
  })

  test("读不到当前项目时回落 qwen 的 cwd(退化,不是失败)", () => {
    expect(
      resolveSessionDirectory({ requestedCwd: "/fallback", voiceDir: VOICE_DIR, activeProject: "", coordinator: false }),
    ).toBe("/fallback")
    expect(
      resolveSessionDirectory({
        requestedCwd: "/fallback",
        voiceDir: VOICE_DIR,
        activeProject: "   ",
        coordinator: false,
      }),
    ).toBe("/fallback")
  })

  test("两个都没有 → 空串,由调用方报错(不猜一个目录出来)", () => {
    expect(
      resolveSessionDirectory({ requestedCwd: "", voiceDir: VOICE_DIR, activeProject: "", coordinator: false }),
    ).toBe("")
  })
})

describe("session/new", () => {
  test("带 qwen_audio_agent 的 → coordinator,落 voice 目录", async () => {
    const { s, created } = store({ activeProject: "/proj" })
    const r = await s.create({ cwd: "/anything", mcpServers: [QWEN_HTTP, BUILTIN] })
    expect(r.coordinator).toBe(true)
    expect(r.directory).toBe(VOICE_DIR)
    expect(created[0]).toEqual({ directory: VOICE_DIR, coordinator: true })
  })

  test("只有 builtin 的 → 第三层,落当前项目", async () => {
    const { s } = store({ activeProject: "/proj" })
    const r = await s.create({ cwd: "/启动时的目录", mcpServers: [BUILTIN] })
    expect(r.coordinator).toBe(false)
    expect(r.directory).toBe("/proj")
  })

  test("acpId 默认就用 sidecar 的 id(一一对应,最省事)", async () => {
    const { s } = store()
    const r = await s.create({ cwd: "/p", mcpServers: [] })
    expect(r.acpId).toBe(r.sidecarId)
    expect(s.get(r.acpId)).toEqual(r)
  })

  test("目录算不出来时抛错,消息说清是哪两个来源都空了", async () => {
    const { s } = store()
    expect(s.create({ mcpServers: [] })).rejects.toThrow(/无法确定 session 目录/)
  })

  test("每次 create 都是新的一条(qwen 派多个任务就该有多条)", async () => {
    const { s, created } = store({ activeProject: "/proj" })
    const a = await s.create({ cwd: "/p", mcpServers: [] })
    const b = await s.create({ cwd: "/p", mcpServers: [] })
    expect(a.sidecarId).not.toBe(b.sidecarId)
    expect(created).toHaveLength(2)
    expect(s.all()).toHaveLength(2)
  })
})

describe("session/resume — TC-U3 透明换新 + 幂等", () => {
  // ★ 网关重启后 qwen 拿着磁盘上记的旧 id 回来;我们建新的、绑旧 id,它毫无感知
  test("第一次见到某个 id → 建新 sidecar session,但对外仍报它请求的那个 id", async () => {
    const { s, created } = store()
    const r = await s.resume({ sessionId: "上次留下的_id", cwd: "/p", mcpServers: [QWEN_HTTP] })
    expect(r.acpId).toBe("上次留下的_id")
    expect(r.sidecarId).toMatch(/^ses_/)
    expect(r.sidecarId).not.toBe("上次留下的_id")
    expect(created).toHaveLength(1)
    expect(created[0].coordinator).toBe(true)
  })

  // ★ qwen 每轮 prompt 前都会 resume 一次,只为重注入 MCP —— 每次都重建就什么历史都留不住
  test("同一个 id 反复 resume 完全幂等,不再建新 session", async () => {
    const { s, created } = store()
    const first = await s.resume({ sessionId: "coord_1", cwd: "/p", mcpServers: [QWEN_HTTP] })
    for (let i = 0; i < 5; i++) {
      const again = await s.resume({ sessionId: "coord_1", cwd: "/p", mcpServers: [QWEN_HTTP] })
      expect(again.sidecarId).toBe(first.sidecarId)
    }
    expect(created).toHaveLength(1)
  })

  test("session/new 建的 session 之后被 resume,同样复用", async () => {
    const { s, created } = store({ activeProject: "/proj" })
    const created1 = await s.create({ cwd: "/p", mcpServers: [BUILTIN] })
    const resumed = await s.resume({ sessionId: created1.acpId, cwd: "/p", mcpServers: [BUILTIN] })
    expect(resumed.sidecarId).toBe(created1.sidecarId)
    expect(created).toHaveLength(1)
  })

  test("缺 sessionId → 抛错", async () => {
    const { s } = store()
    expect(s.resume({ cwd: "/p" })).rejects.toThrow(/缺 sessionId/)
  })

  test("透明换新会留一行日志,注明是「每次启动重建」的既定行为", async () => {
    const { s, logs } = store()
    await s.resume({ sessionId: "旧id", cwd: "/p", mcpServers: [QWEN_HTTP] })
    expect(logs.join("\n")).toContain("透明换新")
  })
})

describe("查询", () => {
  test("coordinator() 找得到那条语音沟通 session", async () => {
    const { s } = store({ activeProject: "/proj" })
    await s.create({ cwd: "/p", mcpServers: [BUILTIN] })
    const coord = await s.create({ cwd: "/p", mcpServers: [QWEN_HTTP] })
    expect(s.coordinator()?.sidecarId).toBe(coord.sidecarId)
  })

  test("没有 coordinator 时返回 undefined", async () => {
    const { s } = store({ activeProject: "/proj" })
    await s.create({ cwd: "/p", mcpServers: [BUILTIN] })
    expect(s.coordinator()).toBeUndefined()
  })

  test("get 未知 id → undefined", () => {
    const { s } = store()
    expect(s.get("不存在")).toBeUndefined()
  })
})
