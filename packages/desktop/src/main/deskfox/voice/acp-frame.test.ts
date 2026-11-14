// [fork-only] REQ-102 语音派活 — ACP 帧判定/切行单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 1-spec §4·S1 的 wrapper 内核;R8 用例 T1(stdout 无噪声)的可自动化部分。
import { describe, expect, test } from "bun:test"
import { createLineSplitter, isAcpFrame, partitionLines } from "./acp-frame"

const FRAME = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } })

describe("isAcpFrame", () => {
  test("真协议帧 → true(请求 / 响应 / 通知)", () => {
    expect(isAcpFrame(FRAME)).toBe(true)
    expect(isAcpFrame('{"jsonrpc":"2.0","method":"session/update","params":{}}')).toBe(true)
    expect(isAcpFrame(`  ${FRAME}  `)).toBe(true) // 两边空白无所谓
  })

  test("插件日志一律 false", () => {
    expect(isAcpFrame("[feishu-plugin] server ready on port 5173")).toBe(false)
    expect(isAcpFrame("[info]: [lark] websocket connected")).toBe(false)
    expect(isAcpFrame("Warning: Please use the legacy build in Node.js environments.")).toBe(false)
    expect(isAcpFrame("")).toBe(false)
  })

  // REQ-102 §3.5 原话:「任何一行插件输出恰好以 { 开头就会炸」—— 所以判据必须比"能 parse"更严
  test("以 { 开头但不是协议帧的行 → false(这条是本函数存在的理由)", () => {
    expect(isAcpFrame('{"level":"info","msg":"plugin loaded"}')).toBe(false)
    expect(isAcpFrame('{"jsonrpc":"1.0","id":1}')).toBe(false)
    expect(isAcpFrame("{ 半个 json")).toBe(false)
    expect(isAcpFrame("{}")).toBe(false)
  })

  test("JSON 数组 / 裸值 → false(ACP 帧一定是对象)", () => {
    expect(isAcpFrame('[{"jsonrpc":"2.0"}]')).toBe(false)
    expect(isAcpFrame('"jsonrpc"')).toBe(false)
    expect(isAcpFrame("null")).toBe(false)
  })
})

describe("createLineSplitter", () => {
  test("整行喂 → 逐行出", () => {
    const s = createLineSplitter()
    expect(s.push("a\nb\n")).toEqual(["a", "b"])
    expect(s.flush()).toEqual([])
  })

  test("跨 chunk 的半行会被拼起来(管道随时可能在任意字节切断)", () => {
    const s = createLineSplitter()
    expect(s.push('{"jsonrpc":"2')).toEqual([])
    expect(s.push('.0","id":1}')).toEqual([])
    expect(s.push("\n")).toEqual(['{"jsonrpc":"2.0","id":1}'])
  })

  test("一个帧被切成很多段也能还原,且内容逐字节一致", () => {
    const s = createLineSplitter()
    const big = JSON.stringify({ jsonrpc: "2.0", id: 7, result: { text: "字".repeat(50000) } })
    const out: string[] = []
    for (let i = 0; i < big.length; i += 997) out.push(...s.push(big.slice(i, i + 997)))
    expect(out).toEqual([])
    expect(s.push("\n")).toEqual([big])
    expect(isAcpFrame(big)).toBe(true) // 超大帧不许被截断
  })

  test("CRLF 归一 + 空行丢弃", () => {
    const s = createLineSplitter()
    expect(s.push("a\r\n\r\nb\r\n")).toEqual(["a", "b"])
  })

  test("flush 吐出结尾没有换行的残留行(子进程被 kill 时会遇到)", () => {
    const s = createLineSplitter()
    expect(s.push("done")).toEqual([])
    expect(s.flush()).toEqual(["done"])
    expect(s.flush()).toEqual([]) // 幂等
  })
})

describe("partitionLines", () => {
  test("协议帧与噪声分流,顺序各自保持", () => {
    const r = partitionLines([
      "[feishu-plugin] starting",
      FRAME,
      '{"level":"info","msg":"x"}',
      '{"jsonrpc":"2.0","method":"session/update","params":{}}',
    ])
    expect(r.frames).toEqual([FRAME, '{"jsonrpc":"2.0","method":"session/update","params":{}}'])
    expect(r.noise).toEqual(["[feishu-plugin] starting", '{"level":"info","msg":"x"}'])
  })

  test("spike 那条基线的形状:55 行里只有 1 行是帧", () => {
    const lines = [...Array.from({ length: 54 }, (_, i) => `[plugin] noise ${i}`), FRAME]
    const r = partitionLines(lines)
    expect(r.frames.length).toBe(1)
    expect(r.noise.length).toBe(54)
  })
})
