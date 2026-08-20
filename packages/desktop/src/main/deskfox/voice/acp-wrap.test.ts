// [fork-only] REQ-102 语音派活 — wrapper 集成测试(真 spawn) [feat: voice-dispatch-minimal] 2026-08-21
//
// 纯逻辑在 acp-frame.test.ts 里测过了;这里测的是**接线**:stdin 透传、stdout 只出协议帧、
// 噪声改道 stderr、退出码透传。用一个假宿主(可控地吐噪声+帧),不碰真 opencode。
import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const WRAPPER = path.join(import.meta.dir, "..", "..", "..", "..", "scripts", "deskfox-acp-wrap.mjs")

/** 假宿主:先吐一坨噪声(含以 { 开头的假 JSON),再吐真帧;然后把 stdin 每行回显成帧。 */
const FAKE_HOST = `
process.stdout.write("[feishu-plugin] server ready\\n")
process.stdout.write('{"level":"info","msg":"plugin loaded"}\\n')
console.log("[info]: [lark] websocket connected")
process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1, agentInfo: { name: "Fake", version: "1.18.16" } } }) + "\\n")
let buf = ""
process.stdin.on("data", (d) => {
  buf += d.toString()
  const parts = buf.split("\\n"); buf = parts.pop() ?? ""
  for (const line of parts) {
    if (!line.trim()) continue
    process.stdout.write("noise-after-echo\\n")
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 2, echo: line }) + "\\n")
    process.exit(0)
  }
})
`

function runWrapper(input: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const dir = mkdtempSync(path.join(tmpdir(), "acp-wrap-"))
  const host = path.join(dir, "fake-host.mjs")
  writeFileSync(host, FAKE_HOST)
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WRAPPER], {
      env: { ...process.env, DESKFOX_ACP_HOST_COMMAND: process.execPath, DESKFOX_ACP_HOST_ARGS: host },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += d.toString()))
    child.stderr.on("data", (d) => (stderr += d.toString()))
    child.stdin.write(input)
    child.on("close", (code) => resolve({ stdout, stderr, code }))
  })
}

describe("deskfox-acp-wrap(真 spawn)", () => {
  test("stdout 只剩协议帧,噪声全部改道 stderr", async () => {
    const { stdout, stderr } = await runWrapper('{"jsonrpc":"2.0","id":2,"method":"ping"}\n')
    const lines = stdout.split("\n").filter((l) => l.trim())

    // 每一行都必须是协议帧 —— 这就是 wrapper 的全部意义
    for (const l of lines) {
      const o = JSON.parse(l)
      expect(o.jsonrpc).toBe("2.0")
    }
    expect(lines.length).toBe(2) // initialize 响应 + echo 帧

    // 噪声一条不漏地进了 stderr(含那条以 { 开头的假 JSON —— 它正是"只 parse 不够"的理由)
    expect(stderr).toContain("[feishu-plugin] server ready")
    expect(stderr).toContain('{"level":"info","msg":"plugin loaded"}')
    expect(stderr).toContain("[lark] websocket connected")
    expect(stderr).toContain("noise-after-echo")
    expect(stdout).not.toContain("feishu")
    expect(stdout).not.toContain("noise-after-echo")
  }, 30000)

  test("stdin 原样透传给宿主(双向流没被加工)", async () => {
    const { stdout } = await runWrapper('{"jsonrpc":"2.0","id":2,"method":"ping"}\n')
    const echo = stdout
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .find((o) => o.id === 2)
    expect(echo?.echo).toBe('{"jsonrpc":"2.0","id":2,"method":"ping"}')
  }, 30000)

  test("宿主版本被核过并记在 stderr(跑到老 opencode 会告警)", async () => {
    const { stderr } = await runWrapper('{"jsonrpc":"2.0","id":2,"method":"ping"}\n')
    expect(stderr).toContain("宿主 opencode 1.18.16")
  }, 30000)

  test("退出码透传 + 收尾统计", async () => {
    const { code, stderr } = await runWrapper('{"jsonrpc":"2.0","id":2,"method":"ping"}\n')
    expect(code).toBe(0)
    expect(stderr).toMatch(/协议帧 2、噪声 \d+/)
  }, 30000)

  // qwen 的 launcher 是 spawnAndProxy(OPENCODE_BIN, ['acp']) —— 子命令由调用方给,
  // wrapper 不能再拼一次默认值,否则宿主拿到 `acp acp`。
  test("调用方传的子命令原样透传,不与默认值重复", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "acp-wrap-args-"))
    const host = path.join(dir, "argv-host.mjs")
    writeFileSync(host, `process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:9,argv:process.argv.slice(2)})+"\\n")`)
    const child = spawn(process.execPath, [WRAPPER, "acp"], {
      env: { ...process.env, DESKFOX_ACP_HOST_COMMAND: process.execPath, DESKFOX_ACP_HOST_ARGS: host },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    child.stdout.on("data", (d) => (stdout += d.toString()))
    await new Promise((r) => child.on("close", r))
    const frame = JSON.parse(stdout.split("\n").filter((l) => l.trim())[0])
    expect(frame.argv).toEqual(["acp"]) // 不是 ["acp","acp"]
  }, 30000)

  test("没配仓路径且无覆盖 → 退 3 并说人话(语音入口据此禁用)", async () => {
    const child = spawn(process.execPath, [WRAPPER], {
      env: { ...process.env, DESKFOX_ACP_HOST_COMMAND: "", DESKFOX_VOICE_REPO_ROOT: "" },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (d) => (stderr += d.toString()))
    const code = await new Promise<number | null>((r) => child.on("close", r))
    expect(code).toBe(3)
    expect(stderr).toContain("DESKFOX_VOICE_REPO_ROOT")
  }, 30000)
})
