// FORK-ONLY: REQ-102 语音入口判定单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 1-spec §4·S3 的交互契约;R8 用例 T17/T18 的判定部分。
import { describe, expect, test } from "bun:test"
import { isBusy, nextAction, tooltipKey, type VoiceStatus } from "./voice-dispatch"

const s = (state: VoiceStatus["state"], detail = ""): VoiceStatus => ({ state, detail })

describe("nextAction", () => {
  test("关 → 起;开 → 停", () => {
    expect(nextAction(s("off"))).toBe("start")
    expect(nextAction(s("on"))).toBe("stop")
  })

  // 「点了没反应」是最差的表现:装不全 / 启动中一律禁用,并由 tooltip 说清原因
  test("没装好 / 启动中 → 按钮禁用", () => {
    expect(nextAction(s("unavailable"))).toBe("none")
    expect(nextAction(s("starting"))).toBe("none")
  })

  test("出错后允许再试一次(常见成因重试或换目录就好)", () => {
    expect(nextAction(s("error", "语音网关启动超时"))).toBe("start")
  })
})

test("isBusy 只在启动中为真(防连点起出两个 Gateway)", () => {
  expect(isBusy(s("starting"))).toBe(true)
  for (const st of ["off", "on", "error", "unavailable"] as const) expect(isBusy(s(st))).toBe(false)
})

describe("tooltipKey", () => {
  test("每个状态一个 key,且都在 titlebar.voice.* 命名空间下", () => {
    const keys = (["off", "on", "starting", "unavailable", "error"] as const).map((st) => tooltipKey(s(st)))
    expect(keys).toEqual([
      "titlebar.voice.off",
      "titlebar.voice.on",
      "titlebar.voice.starting",
      "titlebar.voice.unavailable",
      "titlebar.voice.error",
    ])
    expect(new Set(keys).size).toBe(5) // 不许两个状态共用一个文案
  })
})
