// [fork-only] voice-acp-bridge — DeskFox 当前项目的跨进程共享 [feat: voice-acp-bridge] 2026-08-24
//
// 这个文件坏掉的后果必须是"退化",不是"崩" —— 读不到就回落 qwen 给的 cwd,派活照常。
import { describe, expect, test } from "bun:test"
import { activeProjectPath, readActiveProject, writeActiveProject } from "./active-project"

const NOW = 1_700_000_000_000

describe("activeProjectPath", () => {
  test("跟 voice-gateway.log 一个目录,统一放运行期状态", () => {
    expect(activeProjectPath({ XDG_STATE_HOME: "/s" })).toBe("/s/deskfox/voice-active-project.json")
  })

  test("没设 XDG_STATE_HOME 时回落 ~/.local/state", () => {
    expect(activeProjectPath({}, "/home/u")).toBe("/home/u/.local/state/deskfox/voice-active-project.json")
  })
})

describe("writeActiveProject", () => {
  test("写出目录 + 时间戳", () => {
    let written = ""
    expect(writeActiveProject("/proj", "/tmp/a.json", NOW, (_p, c) => (written = c))).toBe(true)
    expect(JSON.parse(written)).toEqual({ directory: "/proj", updatedAt: NOW })
  })

  test("空目录不写(没打开项目时别留个空记录)", () => {
    let called = false
    expect(writeActiveProject("  ", "/tmp/a.json", NOW, () => (called = true))).toBe(false)
    expect(called).toBe(false)
  })

  test("写失败返回 false 而不是抛 —— 跟随能力不该反过来搞垮语音", () => {
    expect(
      writeActiveProject("/proj", "/tmp/a.json", NOW, () => {
        throw new Error("只读文件系统")
      }),
    ).toBe(false)
  })
})

describe("readActiveProject", () => {
  const good = JSON.stringify({ directory: "/proj", updatedAt: NOW })
  /** 目录存在性也注入,免得用例依赖跑测机器上真有 /proj */
  const alive = () => true

  test("正常读出目录", () => {
    expect(readActiveProject("/tmp/a.json", NOW, 1000, () => good, alive)).toBe("/proj")
  })

  test("文件不存在 / 空 → 空串(调用方回落)", () => {
    expect(readActiveProject("/tmp/a.json", NOW, 1000, () => null)).toBe("")
    expect(readActiveProject("/tmp/a.json", NOW, 1000, () => "")).toBe("")
  })

  test("坏 JSON / 缺字段 → 空串,不抛", () => {
    expect(readActiveProject("/tmp/a.json", NOW, 1000, () => "{不是 json")).toBe("")
    expect(readActiveProject("/tmp/a.json", NOW, 1000, () => "{}")).toBe("")
    expect(readActiveProject("/tmp/a.json", NOW, 1000, () => '{"directory":""}')).toBe("")
  })

  // ★ 上次开语音时留下的记录、而 DeskFox 早关了 —— 拿它建 session 会落到用户此刻没在看的项目
  test("记录太旧 → 当作没有", () => {
    expect(readActiveProject("/tmp/a.json", NOW + 5000, 1000, () => good, alive)).toBe("")
    expect(readActiveProject("/tmp/a.json", NOW + 500, 1000, () => good, alive)).toBe("/proj")
  })

  test("目录已经不存在 → 空串(项目被删/移走)", () => {
    expect(
      readActiveProject(
        "/tmp/a.json",
        NOW,
        1000,
        () => good,
        () => false,
      ),
    ).toBe("")
  })

  test("时间戳非法 → 当作没有", () => {
    expect(readActiveProject("/tmp/a.json", NOW, 1000, () => '{"directory":"/proj","updatedAt":"昨天"}')).toBe("")
  })

  test("写进去再读出来能对上(往返)", () => {
    let store = ""
    writeActiveProject("/往返/项目", "/tmp/a.json", NOW, (_p, c) => (store = c))
    expect(
      readActiveProject(
        "/tmp/a.json",
        NOW + 100,
        60_000,
        () => store,
        () => true,
      ),
    ).toBe("/往返/项目")
  })
})
