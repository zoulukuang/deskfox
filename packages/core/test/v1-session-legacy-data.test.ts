// FORK-ONLY: 老数据容错回归测试 [feat: electron-replatform] 2026-06-12
// [bug-repro: 老会话 step-finish part 无 reason 字段 → fetchMessages BadRequest "Missing key",整个会话打不开]
// 起源:DeskFox Tauri 时代早期(上游加 reason 之前)写入的 step-finish part 只有 type/tokens/cost,
// 实测主库 511/8333 个缺 reason。schema 必填会让含这些 part 的老会话整体加载失败 → 升级"会话消失"观感。

import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Part } from "../src/v1/session"

const decode = Schema.decodeUnknownSync(Part)

describe("v1 session 老数据容错", () => {
  test("step-finish 缺 reason(早期数据真实形状)→ decode 成功且 reason 默认 unknown", () => {
    // 与 DB 实测坏 part(prt_e5df2c4ce0012eLdQCrcSn44Xu)同形:data 仅 type/tokens/cost,
    // id/sessionID/messageID 由行列回填(message-v2.ts part(row) 逻辑)
    const legacy = {
      id: "prt_legacy_test_000000000000",
      sessionID: "ses_legacy_test_0000000000",
      messageID: "msg_legacy_test_0000000000",
      type: "step-finish",
      cost: 0.01,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    const decoded = decode(legacy) as { type: string; reason: string }
    expect(decoded.type).toBe("step-finish")
    expect(decoded.reason).toBe("unknown")
  })

  test("step-finish 有 reason → 原值保留不被默认覆盖", () => {
    const part = {
      id: "prt_legacy_test_000000000001",
      sessionID: "ses_legacy_test_0000000000",
      messageID: "msg_legacy_test_0000000000",
      type: "step-finish",
      reason: "stop",
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    expect((decode(part) as { reason: string }).reason).toBe("stop")
  })
})
