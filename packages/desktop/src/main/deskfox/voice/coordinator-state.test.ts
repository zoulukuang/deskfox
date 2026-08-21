// [fork-only] REQ-102 语音派活 — coordinator 作废逻辑单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 2-plan「provider 工具透传」一节:换后端模型必须连带作废 coordinator session,
// 否则 opencode 的 resumeSession 会从历史消息恢复旧模型,配置里的 model 静默失效。
import { describe, expect, test } from "bun:test"
import {
  acpSessionStatePath,
  dropOpencodeCoordinators,
  invalidateCoordinatorOnModelChange,
  voiceModelStampPath,
} from "./coordinator-state"

const STATE = {
  version: 1,
  coordinators: {
    "opencode:user_personal:backend": { sessionId: "ses_old", cwd: "/repo", updatedAt: 1 },
    "claude:user_personal:backend": { sessionId: "ses_claude", cwd: "/repo", updatedAt: 2 },
  },
  projects: { p1: { sessionId: "ses_proj" } },
}

describe("路径推导", () => {
  test("跟着 XDG 走 —— 语音进程的 XDG 已被 data-namespace 改写过,这里不能自己拼死路径", () => {
    const env = { XDG_CONFIG_HOME: "/h/.config/deskfox", XDG_STATE_HOME: "/h/state/deskfox" } as NodeJS.ProcessEnv
    expect(acpSessionStatePath(env, "/h")).toBe("/h/.config/deskfox/qwaudio/state/acp-sessions.json")
    expect(voiceModelStampPath(env, "/h")).toBe("/h/state/deskfox/deskfox/voice-backend-model")
  })

  test("没设 XDG 时回落系统默认", () => {
    expect(acpSessionStatePath({}, "/h")).toBe("/h/.config/qwaudio/state/acp-sessions.json")
    expect(voiceModelStampPath({}, "/h")).toBe("/h/.local/state/deskfox/voice-backend-model")
  })
})

describe("dropOpencodeCoordinators", () => {
  // 只摘 opencode 的:qwen 支持多后端(claude / openclaw / qoder …),
  // 我们换的是 opencode 的模型,凭什么把别人的会话也清了。
  test("只摘 opencode: 前缀,别的后端和 projects 原样保留", () => {
    const { next, dropped } = dropOpencodeCoordinators(STATE)
    expect(dropped).toEqual(["opencode:user_personal:backend"])
    const n = next as typeof STATE
    expect(Object.keys(n.coordinators)).toEqual(["claude:user_personal:backend"])
    expect(n.projects).toEqual(STATE.projects) // 第三层 session 的记录不能动
    expect(n.version).toBe(1)
  })

  test("没有 opencode 记录 / 结构不对 → 原样返回,不制造空对象", () => {
    expect(dropOpencodeCoordinators({ version: 1, coordinators: {} }).dropped).toEqual([])
    expect(dropOpencodeCoordinators(null).dropped).toEqual([])
    expect(dropOpencodeCoordinators("garbage").dropped).toEqual([])
    expect(dropOpencodeCoordinators({ version: 1 }).dropped).toEqual([])
  })
})

describe("invalidateCoordinatorOnModelChange", () => {
  const env = { XDG_CONFIG_HOME: "/c", XDG_STATE_HOME: "/s" } as NodeJS.ProcessEnv
  const make = (files: Record<string, string>) => {
    const written: Record<string, string> = {}
    const r = (p: string) => files[p] ?? null
    const w = (p: string, c: string) => {
      written[p] = c
      files[p] = c
    }
    return { written, readFile: r, writeFile: w }
  }

  test("模型没变 → 什么都不做(别每次启动都清掉 coordinator)", () => {
    const io = make({ "/s/deskfox/voice-backend-model": "alibaba-cn/qwen3.8-max" })
    const r = invalidateCoordinatorOnModelChange({ backendModel: "alibaba-cn/qwen3.8-max", env, home: "/h", ...io })
    expect(r.invalidated).toBe(false)
    expect(Object.keys(io.written)).toEqual([])
  })

  test("模型变了 → 摘掉 opencode coordinator 并记下新模型", () => {
    const io = make({
      "/s/deskfox/voice-backend-model": "claude-code/opus",
      "/c/qwaudio/state/acp-sessions.json": JSON.stringify(STATE),
    })
    const r = invalidateCoordinatorOnModelChange({ backendModel: "alibaba-cn/qwen3.8-max", env, home: "/h", ...io })
    expect(r.invalidated).toBe(true)
    expect(r.previousModel).toBe("claude-code/opus")
    expect(r.dropped).toEqual(["opencode:user_personal:backend"])
    expect(io.written["/s/deskfox/voice-backend-model"]).toBe("alibaba-cn/qwen3.8-max")
    const next = JSON.parse(io.written["/c/qwaudio/state/acp-sessions.json"])
    expect(next.coordinators["opencode:user_personal:backend"]).toBeUndefined()
    expect(next.coordinators["claude:user_personal:backend"]).toBeDefined()
  })

  // 关键:先记模型再作废。反过来的话,状态文件读失败会让每次启动都重试,coordinator 永远建不起来。
  test("状态文件缺失 / 坏掉 → 不作废,但模型仍要记下(否则每次启动都重试)", () => {
    const missing = make({ "/s/deskfox/voice-backend-model": "claude-code/opus" })
    const r1 = invalidateCoordinatorOnModelChange({ backendModel: "x/y", env, home: "/h", ...missing })
    expect(r1.invalidated).toBe(false)
    expect(missing.written["/s/deskfox/voice-backend-model"]).toBe("x/y")

    const broken = make({
      "/s/deskfox/voice-backend-model": "claude-code/opus",
      "/c/qwaudio/state/acp-sessions.json": "{ 这不是 json",
    })
    const r2 = invalidateCoordinatorOnModelChange({ backendModel: "x/y", env, home: "/h", ...broken })
    expect(r2.invalidated).toBe(false)
    expect(broken.written["/s/deskfox/voice-backend-model"]).toBe("x/y")
    expect(broken.written["/c/qwaudio/state/acp-sessions.json"]).toBeUndefined() // 坏文件不覆盖,留着给人看
  })

  test("首次运行(没有备忘)→ 作废一次,previousModel 为空", () => {
    const io = make({ "/c/qwaudio/state/acp-sessions.json": JSON.stringify(STATE) })
    const r = invalidateCoordinatorOnModelChange({ backendModel: "alibaba-cn/qwen3.8-max", env, home: "/h", ...io })
    expect(r.invalidated).toBe(true)
    expect(r.previousModel).toBe("")
  })
})
