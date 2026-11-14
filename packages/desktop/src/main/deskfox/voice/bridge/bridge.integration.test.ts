// [fork-only] voice-acp-bridge — TC-E 集成:真 sidecar × 真桥进程 [feat: voice-acp-bridge] 2026-08-24
//
// 单测把每个零件都钉住了,但**整条链路是否真的通**只有起真东西才知道 ——
// 这里起一个隔离的 opencode server(独立端口 + 独立 XDG,绝不碰用户实例),
// spawn 真的桥进程,像 qwen 那样跟它说 ACP,然后回头查 sidecar 里到底有没有那条 session。
//
// 覆盖 1-spec §7 里能自动化的部分:
//   TC-E1 全链路派活:第三层 session 在 sidecar 真实出现且列表可见
//   TC-E4 取消:session/cancel → sidecar 任务真中止
//   TC-E5 递归防护:第三层目录拿不到派活工具
//   TC-E7 语音沟通留痕:coordinator 落在 voice 独立目录
//   TC-E8 切项目:换了当前项目后,新任务落到新目录
//
// TC-E2(长任务 ≥6 分钟)/ E3(并发播报)/ E6(崩溃恢复)依赖真模型与真语音端,
// 已在 2026-08-24 的 voice-lab 实测过(1-spec §4 的 E6/E7),生产复验放真机 QA(TC-M 系列)。
//
// ⚠️ **默认跳过**:起一个真 server 要几十秒,不该拖慢每次 `bun test` / pre-push。
//    按需跑:`VOICE_BRIDGE_ITEST=1 bun test bridge.integration`

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

/** 起真 server 很慢,默认不跑;`VOICE_BRIDGE_ITEST=1` 开 */
const ENABLED = String(process.env.VOICE_BRIDGE_ITEST ?? "").trim() === "1"

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..", "..", "..", "..")
const BRIDGE = join(REPO_ROOT, "packages", "desktop", "scripts", "deskfox-voice-bridge.mjs")
const SERVER_ENTRY = join(REPO_ROOT, "packages", "opencode", "src", "index.ts")
const PASSWORD = "voice-bridge-itest"
const AUTH = `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`

/** 随机高位端口,避开用户实例(4096)与语音网关(3101) */
const PORT = 4400 + Math.floor(Math.random() * 400)
const BASE = `http://127.0.0.1:${PORT}`

let root = ""
let projectA = ""
let projectB = ""
let voiceDir = ""
let activeFile = ""
let server: ChildProcess | null = null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: AUTH, "content-type": "application/json", ...((init.headers as any) ?? {}) },
  })
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text.trim() ? JSON.parse(text) : {}
}

/** 一个说 ACP 的假 gateway:spawn 真桥,收发帧。 */
class FakeGateway {
  private proc: ChildProcess
  private buf = ""
  private nextId = 1
  private waiters = new Map<number, (msg: any) => void>()
  readonly notifications: any[] = []
  readonly stderr: string[] = []

  constructor(extraEnv: Record<string, string> = {}) {
    this.proc = spawn("bun", [BRIDGE], {
      env: {
        ...process.env,
        ACP_DESKFOX_SERVER_URL: BASE,
        ACP_DESKFOX_SERVER_AUTH: AUTH,
        ACP_DESKFOX_VOICE_DIR: voiceDir,
        ACP_DESKFOX_ACTIVE_PROJECT_FILE: activeFile,
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.proc.stdout!.setEncoding("utf8")
    this.proc.stdout!.on("data", (chunk: string) => {
      this.buf += chunk
      let nl: number
      while ((nl = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, nl).trim()
        this.buf = this.buf.slice(nl + 1)
        if (!line) continue
        const msg = JSON.parse(line)
        if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
          this.waiters.get(msg.id)?.(msg)
          this.waiters.delete(msg.id)
        } else {
          this.notifications.push(msg)
        }
      }
    })
    this.proc.stderr!.setEncoding("utf8")
    this.proc.stderr!.on("data", (c: string) => this.stderr.push(c))
  }

  request(method: string, params: unknown, timeoutMs = 20_000): Promise<any> {
    const id = this.nextId++
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error(`${method} 超时`)), timeoutMs)
      this.waiters.set(id, (msg) => {
        clearTimeout(timer)
        if (msg.error) rejectPromise(new Error(`${method} → ${msg.error.message}`))
        else resolvePromise(msg.result)
      })
      this.proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    })
  }

  notify(method: string, params: unknown): void {
    this.proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`)
  }

  /** 发 prompt 但不等它回(第三层可能挂很久) */
  promptDetached(sessionId: string, text: string): { id: number; done: Promise<any> } {
    const id = this.nextId++
    const done = new Promise<any>((resolvePromise) => this.waiters.set(id, resolvePromise))
    this.proc.stdin!.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text }] },
      })}\n`,
    )
    return { id, done }
  }

  kill(): void {
    try {
      this.proc.kill("SIGKILL")
    } catch {}
  }
}

/** qwen 给 coordinator 的 MCP 描述符形态(第三层不会有这个) */
const coordinatorMcp = () => [
  { type: "http", name: "qwen_audio_agent", url: `${BASE}/__fake_mcp`, headers: [{ name: "Authorization", value: "Bearer t" }] },
]

beforeAll(async () => {
  if (!ENABLED) return
  root = mkdtempSync(join(tmpdir(), "voice-bridge-itest-"))
  projectA = join(root, "proj-a")
  projectB = join(root, "proj-b")
  voiceDir = join(root, "voice-workspace")
  activeFile = join(root, "active-project.json")
  for (const d of [projectA, projectB, voiceDir]) {
    mkdirSync(d, { recursive: true })
    execFileSync("git", ["init", "-q"], { cwd: d })
  }

  server = spawn("bun", [SERVER_ENTRY, "serve", "--port", String(PORT), "--hostname", "127.0.0.1"], {
    env: {
      ...process.env,
      XDG_DATA_HOME: join(root, "data"),
      XDG_CONFIG_HOME: join(root, "cfg"),
      XDG_STATE_HOME: join(root, "state"),
      OPENCODE_SERVER_PASSWORD: PASSWORD,
    },
    // ⚠️ 必须 "ignore" 而不是 "pipe":pipe 出来却不读,64KB 管道缓冲写满后
    //    **server 进程会在写日志时阻塞**,整个服务卡死。第一次写这个装置时就是这么挂的 ——
    //    前几个用例过、到真跑模型(日志量大)那个用例就永远等不到 session.idle,
    //    看起来像"桥收不到事件",其实是 server 根本没在跑了。
    stdio: ["ignore", "ignore", "ignore"],
  })

  const deadline = Date.now() + 90_000
  for (;;) {
    if (Date.now() > deadline) throw new Error("测试 sidecar 起不来")
    try {
      const h = await fetch(`${BASE}/global/health`, { headers: { Authorization: AUTH } })
      if (h.ok) break
    } catch {}
    await sleep(500)
  }
}, 120_000)

afterAll(() => {
  try {
    server?.kill("SIGKILL")
  } catch {}
  if (root) rmSync(root, { recursive: true, force: true })
})

/** 把「DeskFox 当前打开的项目」写成桥读的那个文件 */
function setActiveProject(dir: string): void {
  Bun.write(activeFile, JSON.stringify({ directory: dir, updatedAt: Date.now() }))
}

describe.skipIf(!ENABLED)("TC-E1 全链路:第三层 session 在 sidecar 真实出现", () => {
  test("session/new 后,DeskFox 的会话列表里立刻查得到这条 session", async () => {
    setActiveProject(projectA)
    const gw = new FakeGateway()
    try {
      const init = await gw.request("initialize", { protocolVersion: 1, clientCapabilities: {} })
      expect(init.protocolVersion).toBe(1)

      const created = await gw.request("session/new", { cwd: projectA, mcpServers: [] })
      expect(created.sessionId).toMatch(/^ses_/)

      // ★ R3 的核心验收:不是"我们记了一笔",而是 sidecar 自己的列表里真有这条
      const list = await api(`/session?directory=${encodeURIComponent(projectA)}&limit=50`)
      expect(list.map((s: any) => s.id)).toContain(created.sessionId)
      const detail = await api(`/session/${created.sessionId}?directory=${encodeURIComponent(projectA)}`)
      // sidecar 把 directory 规范成 realpath(macOS 上 /var 是 /private/var 的软链),
      // 所以比 realpath 而不是比原样字符串
      expect(realpathSync(detail.directory)).toBe(realpathSync(projectA))
    } finally {
      gw.kill()
    }
  }, 60_000)

  test("prompt 被 sidecar 真正接下(user 消息落库),桥同时开始转发进度", async () => {
    setActiveProject(projectA)
    const gw = new FakeGateway()
    try {
      await gw.request("initialize", {})
      const { sessionId } = await gw.request("session/new", { cwd: projectA, mcpServers: [] })
      gw.promptDetached(sessionId, "这是一句测试任务文本")

      // 轮询等 user message 落库(没有配 provider 时后续会失败,但这一步一定发生)
      const deadline = Date.now() + 30_000
      let messages: any[] = []
      while (Date.now() < deadline) {
        messages = await api(`/session/${sessionId}/message?directory=${encodeURIComponent(projectA)}`)
        if (messages.length > 0) break
        await sleep(400)
      }
      expect(messages.length).toBeGreaterThan(0)
      expect(messages[0].info.role).toBe("user")
      const text = messages[0].parts.find((p: any) => p.type === "text")?.text
      expect(text).toContain("这是一句测试任务文本")
    } finally {
      gw.kill()
    }
  }, 60_000)

  // ★ 这条验的是**事件流真的通**,而不只是 HTTP 调用成功。
  //   桥判断"这一轮结束了"唯一的依据就是 sidecar 事件流里的 `session.idle` / `session.error`,
  //   收不到的话 prompt 会永远悬着 —— 而悬着的 session 在 qwen 侧是永久锁死的。
  //   订阅是按 directory 过滤的,而 sidecar 会把路径规范成 realpath,这里顺带验了两边对得上。
  test("prompt 一定会收到终局:桥在事件流上等到结果并回 stopReason", async () => {
    setActiveProject(projectA)
    const gw = new FakeGateway()
    try {
      await gw.request("initialize", {})
      const { sessionId } = await gw.request("session/new", { cwd: projectA, mcpServers: [] })
      const pending = gw.promptDetached(sessionId, "回一句话就行")

      const settled = await Promise.race([
        pending.done,
        sleep(40_000).then(() => null),
      ])
      expect(settled).not.toBeNull()
      // 测试环境没配 provider,这轮多半以 session.error 收场 —— 那也是终局,
      // 关键是**桥收到了事件并回了响应**,而不是把请求挂死
      expect((settled as any).result.stopReason).toBeDefined()

      // 失败也必须"说出来",否则用户对着麦克风只会等到一片安静
      const chunks = gw.notifications.filter((n) => n.method === "session/update")
      const spoken = chunks
        .map((n) => n.params?.update?.content?.text)
        .filter((t): t is string => typeof t === "string")
        .join("")
      expect(spoken.length).toBeGreaterThan(0)
    } finally {
      gw.kill()
    }
  }, 60_000)
})

describe.skipIf(!ENABLED)("TC-E7 语音沟通留痕 + TC-E5 递归防护", () => {
  test("coordinator 落在 voice 独立目录,不混进用户项目", async () => {
    setActiveProject(projectA)
    const gw = new FakeGateway()
    try {
      await gw.request("initialize", {})
      const { sessionId } = await gw.request("session/new", { cwd: projectA, mcpServers: coordinatorMcp() })

      // ★ 1-spec §3.1:coordinator 就是语音沟通记录,且与用户项目分开
      const inVoice = await api(`/session?directory=${encodeURIComponent(voiceDir)}&limit=50`)
      expect(inVoice.map((s: any) => s.id)).toContain(sessionId)
      expect(inVoice.find((s: any) => s.id === sessionId).title).toBe("语音沟通")

      const inProject = await api(`/session?directory=${encodeURIComponent(projectA)}&limit=50`)
      expect(inProject.map((s: any) => s.id)).not.toContain(sessionId)
    } finally {
      gw.kill()
    }
  }, 60_000)

  // ★ 递归防护:派活工具只注册到 voice 目录 —— 第三层结构上拿不到 session_start
  test("派活 MCP 只出现在 voice 目录,用户项目目录一个都没有", async () => {
    setActiveProject(projectA)
    const gw = new FakeGateway()
    try {
      await gw.request("initialize", {})
      await gw.request("session/new", { cwd: projectA, mcpServers: coordinatorMcp() })
      // 第三层:同样把描述符递过去,桥也必须拒绝往项目目录注册
      await gw.request("session/new", { cwd: projectA, mcpServers: [] })

      const voiceMcp = await api(`/mcp?directory=${encodeURIComponent(voiceDir)}`)
      expect(Object.keys(voiceMcp)).toContain("qwen_audio_agent")

      const projectMcp = await api(`/mcp?directory=${encodeURIComponent(projectA)}`)
      expect(Object.keys(projectMcp)).not.toContain("qwen_audio_agent")
    } finally {
      gw.kill()
    }
  }, 60_000)
})

describe.skipIf(!ENABLED)("TC-E8 切项目", () => {
  test("换了 DeskFox 当前项目后,新任务落到新目录(不跟 qwen 给的启动期 cwd 走)", async () => {
    const gw = new FakeGateway()
    try {
      await gw.request("initialize", {})

      setActiveProject(projectA)
      const first = await gw.request("session/new", { cwd: projectA, mcpServers: [] })

      // 用户切到另一个项目;注意 qwen 给的 cwd 仍是启动时那个 projectA
      setActiveProject(projectB)
      const second = await gw.request("session/new", { cwd: projectA, mcpServers: [] })

      const inA = (await api(`/session?directory=${encodeURIComponent(projectA)}&limit=50`)).map((s: any) => s.id)
      const inB = (await api(`/session?directory=${encodeURIComponent(projectB)}&limit=50`)).map((s: any) => s.id)
      expect(inA).toContain(first.sessionId)
      expect(inB).toContain(second.sessionId)
      expect(inA).not.toContain(second.sessionId)
    } finally {
      gw.kill()
    }
  }, 60_000)
})

describe.skipIf(!ENABLED)("TC-E4 取消", () => {
  test("session/cancel → 桥立刻回 cancelled(不回的话那条 session 会永久锁死)", async () => {
    setActiveProject(projectA)
    const gw = new FakeGateway()
    try {
      await gw.request("initialize", {})
      const { sessionId } = await gw.request("session/new", { cwd: projectA, mcpServers: [] })
      const pending = gw.promptDetached(sessionId, "一个会被取消的任务")
      await sleep(1000)

      gw.notify("session/cancel", { sessionId })
      const result = await Promise.race([
        pending.done,
        sleep(15_000).then(() => ({ result: { stopReason: "没在 15 秒内回应" } })),
      ])
      expect((result as any).result.stopReason).toBe("cancelled")

      // sidecar 侧也回到 idle(abort 真发出去了)
      const status = await api(`/session/status?directory=${encodeURIComponent(projectA)}`)
      expect(status[sessionId]?.type ?? "idle").toBe("idle")
    } finally {
      gw.kill()
    }
  }, 60_000)
})

describe.skipIf(!ENABLED)("resume 的幂等与透明换新(TC-U3 的真机对照)", () => {
  test("拿一个 sidecar 里不存在的旧 id 反复 resume → 只建一条新 session,且对外沿用旧 id", async () => {
    setActiveProject(projectA)
    const gw = new FakeGateway()
    try {
      await gw.request("initialize", {})
      const before: string[] = (await api(`/session?directory=${encodeURIComponent(voiceDir)}&limit=100`)).map(
        (s: any) => s.id,
      )

      const staleId = "coord_上次网关留下的"
      // qwen 每轮 prompt 前都会 resume 一次(只为重注入 MCP),所以必须幂等
      for (let i = 0; i < 3; i++) {
        const r = await gw.request("session/resume", { sessionId: staleId, cwd: projectA, mcpServers: coordinatorMcp() })
        // result 里没有 sessionId —— qwen 沿用它自己传的那个,这正是透明换新成立的原因
        expect(r.sessionId).toBeUndefined()
      }

      const after: string[] = (await api(`/session?directory=${encodeURIComponent(voiceDir)}&limit=100`)).map(
        (s: any) => s.id,
      )
      const added = after.filter((id) => !before.includes(id))
      expect(added).toHaveLength(1) // 三次 resume 只建了一条,不是三条
      expect(added[0]).not.toBe(staleId) // 真身是新建的 sidecar session

      // 用旧 id 还能继续派活:桥内部把它映射到了新 session
      gw.promptDetached(staleId, "resume 之后还能派活")
      const deadline = Date.now() + 20_000
      let messages: any[] = []
      while (Date.now() < deadline) {
        messages = await api(`/session/${added[0]}/message?directory=${encodeURIComponent(voiceDir)}`)
        if (messages.length) break
        await sleep(400)
      }
      expect(messages.length).toBeGreaterThan(0)
      expect(messages[0].parts.find((p: any) => p.type === "text")?.text).toContain("resume 之后还能派活")
    } finally {
      gw.kill()
    }
  }, 60_000)
})
