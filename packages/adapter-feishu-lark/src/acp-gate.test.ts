// [fork-only] REQ-102 ACP 子进程门控单测(飞书侧) [feat: voice-dispatch-minimal] 2026-08-21
// 对应 1-spec §4·S1;R8 用例 T2/T4。跨包漂移守卫在 media-gen 侧(逐字比对两份实现)。
import { describe, expect, test } from "bun:test"
import { DEFAULT_ACP_PLUGIN_ALLOWLIST, FEISHU_PLUGIN_ID, shouldSkipInAcp } from "./acp-gate"

describe("飞书插件的 ACP 门控", () => {
  // 这条是本改动的全部意义:ACP 子进程不许再开 5 条 WSS 跟主实例抢消息
  test("ACP 子进程里被挡(默认白名单不含飞书)", () => {
    expect(shouldSkipInAcp(FEISHU_PLUGIN_ID, { OPENCODE_CLIENT: "acp" })).toBe(true)
  })

  test("主实例 / TUI / CLI 一律不挡 —— 现有飞书行为零变化", () => {
    for (const client of [undefined, "cli", "tui", "desktop", "server"]) {
      const env = client === undefined ? {} : { OPENCODE_CLIENT: client }
      expect(shouldSkipInAcp(FEISHU_PLUGIN_ID, env)).toBe(false)
    }
  })

  test("确实要在语音里用飞书时可显式放行(逃生阀)", () => {
    expect(
      shouldSkipInAcp(FEISHU_PLUGIN_ID, { OPENCODE_CLIENT: "acp", DESKFOX_ACP_PLUGINS: "media-gen,feishu-bridge" }),
    ).toBe(false)
    expect(shouldSkipInAcp(FEISHU_PLUGIN_ID, { OPENCODE_CLIENT: "acp", DESKFOX_ACP_PLUGINS: "*" })).toBe(false)
  })

  test("插件 id 与注入 config 的目录名一致", () => {
    expect(FEISHU_PLUGIN_ID).toBe("feishu-bridge")
    expect(DEFAULT_ACP_PLUGIN_ALLOWLIST).toBe("media-gen")
  })
})
