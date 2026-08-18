// FORK-ONLY: 会话列表「运行中」判定回归锁 [feat: stuck-working-indicator-fix]
// [feat: session-presentation-input-batch] 2026-08-17
//
// 补测起因:session-working.ts 文件头写明「抽出纯函数进 Logic 清单可单测」,但 2026-08-17
// 施工 REQ-110 时发现它**一条测试都没有** —— 与 healClearedSessionOrphans 调用点丢失同批发现。
// R5 双清单要求 Logic 清单行覆盖 ≥ 80%,这里把两条关键语义钉死:
//   ① 2026-06-06 修的「图标永久卡死」—— pending 只看**末条**,不许退回 findLast 扫历史残骸;
//   ② 有待响应权限时不转圈(那是「等你点」不是「在跑」)。
import { describe, expect, test } from "bun:test"
import { deriveSessionWorking } from "./session-working"

const assistant = (completed?: number) => ({ role: "assistant", time: { created: 1, completed } })
const user = () => ({ role: "user", time: { created: 1 } })

describe("deriveSessionWorking", () => {
  test("后端报 busy → 转圈", () => {
    expect(deriveSessionWorking({ hasPermissions: false, messages: [], status: { type: "busy" } })).toBe(true)
  })

  test("后端报 retry → 转圈(自动重试期间不算停)", () => {
    expect(deriveSessionWorking({ hasPermissions: false, messages: [], status: { type: "retry" } })).toBe(true)
  })

  test("后端报 idle 且无未完成末条 → 不转圈", () => {
    expect(
      deriveSessionWorking({ hasPermissions: false, messages: [user(), assistant(2)], status: { type: "idle" } }),
    ).toBe(false)
  })

  test("status 缺失 + 无消息 → 不转圈(冷启动不误亮)", () => {
    expect(deriveSessionWorking({ hasPermissions: false, messages: undefined, status: undefined })).toBe(false)
  })

  test("末条是未完成的 assistant → 转圈(直播流式中,status 事件可能还没到)", () => {
    expect(
      deriveSessionWorking({ hasPermissions: false, messages: [user(), assistant()], status: { type: "idle" } }),
    ).toBe(true)
  })

  test("🔒 防卡死:埋在历史里的未完成残骸**不**触发转圈(只看末条,不 findLast 扫历史)", () => {
    // 2026-06-06 修的正是这个:硬杀漏盖 time.completed 的残骸留在历史中间,
    // 原 findLast 实现会一直扫到它 → 图标永久卡死。
    expect(
      deriveSessionWorking({
        hasPermissions: false,
        messages: [user(), assistant() /* 残骸 */, user(), assistant(5)],
        status: { type: "idle" },
      }),
    ).toBe(false)
  })

  test("有待响应权限时不转圈 —— 那是「等你点」不是「在跑」", () => {
    expect(deriveSessionWorking({ hasPermissions: true, messages: [assistant()], status: { type: "busy" } })).toBe(
      false,
    )
  })

  test("未知的非 idle status 一律按在跑处理(宁可多转不可漏亮)", () => {
    expect(deriveSessionWorking({ hasPermissions: false, messages: [], status: { type: "compacting" } })).toBe(true)
  })
})
