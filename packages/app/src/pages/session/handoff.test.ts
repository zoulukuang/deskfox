// [fork-only] REQ-083 首启自动打开介绍文档 —— pendingOpenFile take-once 语义单测。
//   这是首启自动打开链路的关键闸:layout.tsx 收 deep link 时 setPendingOpenFile,session.tsx
//   在 sdk.directory 就绪时 takePendingOpenFile(取一次即清)。若「取后清空」被改坏 → 切项目会
//   误重复打开介绍文档。此测锁死 take-once + last-write-wins 契约。
//   [feat: first-launch-onboarding] 2026-07-14
import { describe, expect, test } from "bun:test"
import { setPendingOpenFile, takePendingOpenFile } from "./handoff"

describe("pendingOpenFile(首启待打开文件,take-once)", () => {
  // 模块级单例:每个用例先清空,避免用例间串味(take 会清,故先 take 一次即净)
  const drain = () => takePendingOpenFile()

  test("TC-P1: 初始无待打开 → take 返回 undefined", () => {
    drain()
    expect(takePendingOpenFile()).toBeUndefined()
  })

  test("TC-P2: set 后 take 取回同一文件", () => {
    drain()
    setPendingOpenFile("关于 DeskFox 你该知道的几件事.md")
    expect(takePendingOpenFile()).toBe("关于 DeskFox 你该知道的几件事.md")
  })

  test("TC-P3: take-once —— 取一次即清,第二次 take 为 undefined(防切项目重复打开)", () => {
    drain()
    setPendingOpenFile("intro.md")
    expect(takePendingOpenFile()).toBe("intro.md")
    expect(takePendingOpenFile()).toBeUndefined()
  })

  test("TC-P4: last-write-wins —— 未取前再 set 覆盖旧值(单一全局槽)", () => {
    drain()
    setPendingOpenFile("first.md")
    setPendingOpenFile("second.md")
    expect(takePendingOpenFile()).toBe("second.md")
    expect(takePendingOpenFile()).toBeUndefined()
  })
})
