// [fork-only] REQ-102 ACP 子进程门控单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 1-spec §4·S1;R8 用例 T2/T3/T4。
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  DEFAULT_ACP_PLUGIN_ALLOWLIST,
  MEDIA_GEN_PLUGIN_ID,
  shouldSkipInAcp,
  shouldStartMediaServer,
} from "./acp-gate"

describe("shouldSkipInAcp", () => {
  test("不在 ACP 里 → 永不跳过(主实例/TUI/CLI 行为一字不变)", () => {
    expect(shouldSkipInAcp("feishu-bridge", {})).toBe(false)
    expect(shouldSkipInAcp("feishu-bridge", { OPENCODE_CLIENT: "cli" })).toBe(false)
    expect(shouldSkipInAcp("feishu-bridge", { OPENCODE_CLIENT: "tui" })).toBe(false)
    expect(shouldSkipInAcp("media-gen", { OPENCODE_CLIENT: "desktop" })).toBe(false)
  })

  test("ACP 里:飞书默认被挡,media-gen 默认放行", () => {
    const env = { OPENCODE_CLIENT: "acp" }
    expect(shouldSkipInAcp("feishu-bridge", env)).toBe(true)
    expect(shouldSkipInAcp(MEDIA_GEN_PLUGIN_ID, env)).toBe(false)
  })

  test("白名单可覆盖", () => {
    expect(shouldSkipInAcp("feishu-bridge", { OPENCODE_CLIENT: "acp", DESKFOX_ACP_PLUGINS: "feishu-bridge" })).toBe(
      false,
    )
    // 逗号分隔 + 容忍空格
    expect(
      shouldSkipInAcp("media-gen", { OPENCODE_CLIENT: "acp", DESKFOX_ACP_PLUGINS: " feishu-bridge , media-gen " }),
    ).toBe(false)
  })

  test("`*` 放行全部;空串放行零个(两个方向的逃生阀)", () => {
    expect(shouldSkipInAcp("feishu-bridge", { OPENCODE_CLIENT: "acp", DESKFOX_ACP_PLUGINS: "*" })).toBe(false)
    expect(shouldSkipInAcp("media-gen", { OPENCODE_CLIENT: "acp", DESKFOX_ACP_PLUGINS: "" })).toBe(true)
  })

  test("默认白名单常量 = media-gen(改了这条等于改产品行为,要有人看见)", () => {
    expect(DEFAULT_ACP_PLUGIN_ALLOWLIST).toBe("media-gen")
  })
})

describe("shouldStartMediaServer", () => {
  test("ACP 里不起 server(固定端口 51737 已被主实例占着)", () => {
    expect(shouldStartMediaServer({ OPENCODE_CLIENT: "acp" })).toBe(false)
  })

  test("其它场景照常起", () => {
    expect(shouldStartMediaServer({})).toBe(true)
    expect(shouldStartMediaServer({ OPENCODE_CLIENT: "desktop" })).toBe(true)
  })
})

// 跨包漂移守卫:`shouldSkipInAcp` 在 adapter-feishu-lark 有一份逐字副本(两包无共享 fork 工具包)。
// 一边改了另一边没跟 → 这条红,而不是等到线上出现"飞书被挡了/没被挡"的诡异行为。
test("与 adapter-feishu-lark 的副本逐字一致", () => {
  const grab = (file: string) => {
    const src = readFileSync(file, "utf-8")
    const m = /export function shouldSkipInAcp[\s\S]*?\n}/.exec(src)
    if (!m) throw new Error(`没在 ${file} 里找到 shouldSkipInAcp`)
    return m[0]
  }
  const mine = grab(path.join(import.meta.dir, "acp-gate.ts"))
  const theirs = grab(path.join(import.meta.dir, "..", "..", "adapter-feishu-lark", "src", "acp-gate.ts"))
  expect(mine).toBe(theirs)
})
