// [feat: media-gen-minimax] 2026-05-28 — translateBaseResp 2056 双语义解析单测
// 起源:user 实测 Token Plan Plus 套餐 TTS/video 报 2056 但 status_msg 是 "(0/0 used)" — 0 配额
// 不是耗尽,误导用户以为等重置就好。本测试锁定区分行为。
import { describe, expect, test } from "bun:test"
import { translateBaseResp } from "../src/minimax-error"

describe("translateBaseResp 2056 区分 0/0 无配额 vs 配额耗尽", () => {
  test("(0/0 used) → 套餐不含此能力,提示升级/换 provider", () => {
    const msg = `usage limit exceeded, 5-hour usage limit reached for Token Plan Plus (0/0 used), resets at 2026-05-28T20:00:00+08:00`
    const friendly = translateBaseResp(2056, msg)
    expect(friendly).toMatch(/无配额|0\/0|不含|升级/)
    // 应明确告诉用户「等重置也没用」
    expect(friendly).toMatch(/等重置也不会有|无配额/)
  })

  test("(N/M used) N>0 → 真耗尽,提示等重置", () => {
    const msg = `usage limit exceeded, 5-hour usage limit reached for Token Plan Plus (480/500 used), resets at 2026-05-28T20:00:00+08:00`
    const friendly = translateBaseResp(2056, msg)
    expect(friendly).toMatch(/配额耗尽|等.*重置/)
    // 不应误导成「套餐不含」
    expect(friendly).not.toMatch(/无配额|0\/0|不含此能力/)
  })

  test("无 status_msg 兜底:认作配额耗尽(向后兼容)", () => {
    expect(translateBaseResp(2056)).toMatch(/配额耗尽|5 小时窗口/)
  })

  test("其他错误码沿用 ERROR_MAP / fallback", () => {
    expect(translateBaseResp(1008, "balance")).toMatch(/余额不足|订阅套餐/)
    expect(translateBaseResp(1004, "auth")).toMatch(/鉴权|API Key/)
    // 未知 code → 通用 fallback
    expect(translateBaseResp(9999, "unknown error")).toMatch(/MiniMax 返回错误.*9999/)
  })
})
