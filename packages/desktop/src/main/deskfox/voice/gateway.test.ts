// [fork-only] REQ-102 语音派活 — Gateway 托管的纯逻辑单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 1-spec §4·S3;R8 用例 T17/T18 里可自动化的判定部分(真机点击那半留给验收)。
import { describe, expect, test } from "bun:test"
import { buildGatewayArgs, deriveStatus, gatewayHealthUrl, parseSetupJson } from "./gateway"

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

describe("deriveStatus", () => {
  const base = { available: null, running: false, starting: false, lastError: "" }

  test("默认 off,tooltip 是「点击开启」", () => {
    expect(deriveStatus(base)).toMatchObject({ state: "off" })
  })

  test("没装好 → unavailable,并把原因带上(不能点了没反应)", () => {
    const r = deriveStatus({ ...base, available: { ready: false, issue: "未安装 qwen-audio-agent" } })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("未安装")
  })

  test("启动中 / 已开启", () => {
    expect(deriveStatus({ ...base, available: { ready: true, issue: "" }, starting: true }).state).toBe("starting")
    const on = deriveStatus({ ...base, available: { ready: true, issue: "" }, running: true })
    expect(on.state).toBe("on")
    expect(on.gatewayUrl).toBe("http://127.0.0.1:3101")
  })

  test("错误压过一切 —— 出过错必须让用户看见,而不是显示成「关」", () => {
    const r = deriveStatus({ ...base, available: { ready: true, issue: "" }, running: true, lastError: "网关意外退出" })
    expect(r.state).toBe("error")
    expect(r.detail).toBe("网关意外退出")
  })
})
