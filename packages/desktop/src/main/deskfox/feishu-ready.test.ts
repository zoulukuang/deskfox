// [fork-only] REQ-029 feishu loadReadyFrom mtime 失效单测 — plugin 看门狗重启换端口后
// 缓存必须随 server.json mtime 失效,否则永远打旧端口(2026-05-25 user 实机撞过)。
// electron 由 bunfig.toml [test].preload 全局 mock 接管。
//   [feat: batch-port-edit-mdlink] 2026-07-07
import { describe, expect, test, beforeEach, afterAll } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"

const { loadReadyFrom, resetReadyCacheForTest } = await import("./feishu")

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-ready-"))
const file = path.join(dir, "feishu-plugin-server.json")

function writeReady(port: number, bumpMs: number) {
  fs.writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${port}`, username: "u", password: "p" }))
  // 显式抬 mtime — 同一测试内连续两次写盘可能落在同一 mtime 精度粒度里,模拟"真实重启间隔"
  const t = new Date(Date.now() + bumpMs)
  fs.utimesSync(file, t, t)
}

beforeEach(() => {
  resetReadyCacheForTest()
  fs.rmSync(file, { force: true })
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("loadReadyFrom(REQ-029 mtime 失效)", () => {
  test("T1: 首读拿到当前端口", () => {
    writeReady(10167, 0)
    expect(loadReadyFrom(file)?.url).toBe("http://127.0.0.1:10167")
  })

  test("T2: plugin 重启重写新端口(mtime 变)→ 重读拿到新端口,不残留旧值", () => {
    writeReady(10167, 0)
    expect(loadReadyFrom(file)?.url).toBe("http://127.0.0.1:10167")
    writeReady(3961, 5_000)
    expect(loadReadyFrom(file)?.url).toBe("http://127.0.0.1:3961")
  })

  test("T3a: 文件被删 → 返 null 且缓存被清(恢复后拿新值而非旧缓存)", () => {
    writeReady(10167, 0)
    expect(loadReadyFrom(file)?.url).toBe("http://127.0.0.1:10167")
    fs.rmSync(file)
    expect(loadReadyFrom(file)).toBeNull()
    writeReady(3961, 10_000)
    expect(loadReadyFrom(file)?.url).toBe("http://127.0.0.1:3961")
  })

  test("T3b: 内容损坏(非 JSON / 缺字段)→ 返 null 且缓存被清", () => {
    writeReady(10167, 0)
    expect(loadReadyFrom(file)?.url).toBe("http://127.0.0.1:10167")
    fs.writeFileSync(file, "not-json{{{")
    const t = new Date(Date.now() + 5_000)
    fs.utimesSync(file, t, t)
    expect(loadReadyFrom(file)).toBeNull()
    fs.writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:4000" })) // 缺 username
    fs.utimesSync(file, new Date(Date.now() + 10_000), new Date(Date.now() + 10_000))
    expect(loadReadyFrom(file)).toBeNull()
  })

  test("T4: 文件未变(mtime 同)→ 命中缓存返回同一对象", () => {
    writeReady(10167, 0)
    const first = loadReadyFrom(file)
    const second = loadReadyFrom(file)
    expect(second).toBe(first!)
  })

  test("文件从未存在 → null(插件还没启动)", () => {
    expect(loadReadyFrom(file)).toBeNull()
  })
})
