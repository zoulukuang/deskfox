// [fork-only] REQ-102 语音派活 — Gateway 托管的纯逻辑单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 1-spec §4·S3;R8 用例 T17/T18 里可自动化的判定部分(真机点击那半留给验收)。
import { describe, expect, test } from "bun:test"
import {
  buildGatewayArgs,
  deriveStatus,
  gatewayHealthUrl,
  isBackendReady,
  isRetryableStartFailure,
  parseSetupJson,
} from "./gateway"

describe("parseSetupJson", () => {
  // 这份形状取自 2026-08-21 真实跑出来的输出
  const REAL_READY = JSON.stringify({
    selected: "opencode",
    backends: [{ id: "opencode", ready: true, backend: { ready: true, source: "configured" }, issues: [] }],
  })

  test("真实就绪输出 → ready", () => {
    expect(parseSetupJson(REAL_READY)).toEqual({ ready: true, issue: "" })
  })

  test("未就绪 → 把 issue 原样带出来(tooltip 要给可执行的下一步)", () => {
    const s = JSON.stringify({ backends: [{ id: "opencode", ready: false, issue: "OpenCode 1.17.4 不兼容" }] })
    expect(parseSetupJson(s)).toEqual({ ready: false, issue: "OpenCode 1.17.4 不兼容" })
  })

  test("没有 opencode 后端 / 不是 JSON → 一律当没装好,不猜", () => {
    expect(parseSetupJson(JSON.stringify({ backends: [{ id: "codex", ready: true }] })).ready).toBe(false)
    expect(parseSetupJson("command not found").ready).toBe(false)
    expect(parseSetupJson("").ready).toBe(false)
  })

  test("ready 但没带 issue 字段也不炸", () => {
    expect(parseSetupJson(JSON.stringify({ backends: [{ id: "opencode", ready: false }] })).issue).toContain("未就绪")
  })
})

test("buildGatewayArgs / gatewayHealthUrl", () => {
  expect(buildGatewayArgs()).toEqual(["gateway", "run", "--backend", "opencode"])
  // 走 loopback,别监听 0.0.0.0(R6)
  expect(gatewayHealthUrl()).toBe("http://127.0.0.1:3101/api/health")
  expect(gatewayHealthUrl(4396)).toContain("127.0.0.1:4396")
})

// 2026-08-21 真机:语音 ACP 起来时要开和主实例同一个 db(D-A 共用的必然结果),
// opencode 启动阶段跑迁移拿排他锁,撞上就 `database is locked` 直接退。锁是瞬态的 → 值得重试。
// qwen 在 /api/health 的实现里明写 "Gateway liveness is independent from optional backend
// readiness" —— 顶层 ok 只代表 3101 活着。2026-08-21 真机就栽在这:ACP 后端建表撞车退出,
// 3101 照样 200,我们报"已开启",用户对着界面说话没人应。
describe("isBackendReady", () => {
  const ready = {
    ok: true,
    status: "ready",
    backend: { kind: "opencode", ok: true, code: "READY", agentInfo: { name: "OpenCode", version: "local" } },
  }

  test("gateway + backend 都 ok 才算就绪", () => {
    expect(isBackendReady(ready)).toBe(true)
    expect(isBackendReady({ ...ready, backend: { ok: false, code: "READY" } })).toBe(true) // code 兜底
    expect(isBackendReady({ ...ready, backend: { ok: false, code: "STARTING" } })).toBe(false)
  })

  test("只有 gateway 活着 → 不算就绪(这正是那个半死状态)", () => {
    expect(isBackendReady({ ok: true, status: "ready" })).toBe(false)
    expect(isBackendReady({ ok: true, status: "ready", backend: null })).toBe(false)
  })

  test("畸形 / 非对象一律不算就绪 —— 宁可多重试一轮", () => {
    expect(isBackendReady(null)).toBe(false)
    expect(isBackendReady("ready")).toBe(false)
    expect(isBackendReady({ ok: false, backend: { ok: true } })).toBe(false)
  })
})

describe("isRetryableStartFailure", () => {
  test("数据库锁 / SQLITE_BUSY / 就绪前退出 → 可重试", () => {
    expect(isRetryableStartFailure("Error: Unexpected error\ndatabase is locked\n")).toBe(true)
    expect(isRetryableStartFailure("SQLITE_BUSY: database is locked")).toBe(true)
    expect(isRetryableStartFailure("qwenaudio: Gateway 在就绪前退出:1")).toBe(true)
  })

  // 首次跑到全新语音库上,4396 的 backend server 和 ACP 宿主并发建表,
  // 报的是建表失败而不是锁 —— 同样是瞬态的(第二次库已建好),必须一起吃掉。
  test("首次建表撞车(Failed query / acp.initialization_failed)也可重试", () => {
    expect(isRetryableStartFailure("Failed query: \n CREATE TABLE `workspace` (")).toBe(true)
    expect(isRetryableStartFailure('ERROR gateway acp.initialization_failed {"subsystem":"acp"}')).toBe(true)
  })

  test("其它失败不瞎重试(重试改变不了结果,只会让用户多等)", () => {
    expect(isRetryableStartFailure("DASHSCOPE_API_KEY 无效")).toBe(false)
    expect(isRetryableStartFailure("")).toBe(false)
    expect(isRetryableStartFailure("command not found: qwenaudio")).toBe(false)
  })
})

describe("deriveStatus", () => {
  const base = { available: null, running: false, healthy: false, starting: false, lastError: "" }

  test("默认 off,tooltip 是「点击开启」", () => {
    expect(deriveStatus(base)).toMatchObject({ state: "off" })
  })

  test("没装好 → unavailable,并把原因带上(不能点了没反应)", () => {
    const r = deriveStatus({ ...base, available: { ready: false, issue: "未安装 qwen-audio-agent" } })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("未安装")
  })

  test("启动中", () => {
    expect(deriveStatus({ ...base, available: { ready: true, issue: "" }, starting: true }).state).toBe("starting")
  })

  // 2026-08-21 真机:qwenaudio 进程活着但 3101 从没开,按 running 判会报"已开启",
  // 用户点开却什么都没有 —— 比报错更糟。所以 on 的判据是 health 探通。
  test("进程活着但 health 没通 → starting,不是 on", () => {
    const r = deriveStatus({ ...base, available: { ready: true, issue: "" }, running: true, healthy: false })
    expect(r.state).toBe("starting")
  })

  test("running + healthy 才是 on", () => {
    const r = deriveStatus({ ...base, available: { ready: true, issue: "" }, running: true, healthy: true })
    expect(r.state).toBe("on")
    expect(r.gatewayUrl).toBe("http://127.0.0.1:3101")
  })

  test("没在跑时,错误要让用户看见,而不是显示成「关」", () => {
    const r = deriveStatus({ ...base, available: { ready: true, issue: "" }, lastError: "网关意外退出" })
    expect(r.state).toBe("error")
    expect(r.detail).toBe("网关意外退出")
  })

  // 2026-08-21 user 真机反馈:非 git 项目上点,给的是「出错了,点击重试」——
  // 而重试永远不可能成功(目录不会自己变成 git 仓库),表现就是"点了没反应"。
  // 这类"换个项目才行"的前置条件必须是 unavailable(按钮禁用 + 说清怎么办)。
  test("目录不合格 → unavailable(禁用),不是 error(可点重试)", () => {
    const r = deriveStatus({ ...base, available: { ready: true, issue: "" }, workspaceIssue: "不是 git 仓库根:/x" })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("git")
  })

  test("目录不合格但已经跑起来了 → 仍显示 on(能关掉它)", () => {
    const r = deriveStatus({ ...base, running: true, healthy: true, workspaceIssue: "不是 git 仓库根:/x" })
    expect(r.state).toBe("on")
  })
})
