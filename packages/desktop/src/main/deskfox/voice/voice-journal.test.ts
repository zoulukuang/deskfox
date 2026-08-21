// [fork-only] REQ-102 语音派活 — 语音沟通记录单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 2-plan「C:另造可读的语音沟通 session」。样本字段取自真实的 /api/tasks 与 /api/timeline。
import { describe, expect, test } from "bun:test"
import { journalTitle, pairTurns, pendingTurns, renderTurn } from "./voice-journal"

const TASKS = [
  { id: "w1", objective: "查询宇树科技当前的主营业务收入情况", workState: "completed", createdAt: 200 },
  { id: "w2", objective: "检查本地是否有机器人相关的行业研究报告", workState: "completed", createdAt: 100 },
  { id: "w3", objective: "还在跑的活", workState: "running", createdAt: 300 },
  { id: "w4", objective: "失败的活", workState: "failed", createdAt: 400 },
]
const TIMELINE = [
  { taskId: "w1", title: "Agent 结果", content: "## 宇树科技(688836.SH)主营收入概况\n> 数据来源:…", createdAt: 210 },
  { taskId: "w2", title: "Agent 结果", content: "## 本地机器人相关研究\n### 核心专题:具身智能", createdAt: 110 },
]

describe("pairTurns", () => {
  test("按 taskId 配对,并按时间排序", () => {
    const turns = pairTurns(TASKS, TIMELINE)
    expect(turns.map((t) => t.taskId)).toEqual(["w2", "w1", "w4"])
    expect(turns[1].answer).toContain("宇树科技")
  })

  // 还在跑的写进去会是半截,而 noReply 只能追加、改不了已写的消息 —— 等它跑完一次成型
  test("running 的轮次不收", () => {
    expect(pairTurns(TASKS, TIMELINE).some((t) => t.taskId === "w3")).toBe(false)
  })

  test("failed 要收 —— 失败也是沟通的一部分,不能让它凭空消失", () => {
    const failed = pairTurns(TASKS, TIMELINE).find((t) => t.taskId === "w4")
    expect(failed?.state).toBe("failed")
    expect(failed?.answer).toBe("") // 没有 timeline 也照收
  })

  test("同一 task 多条 timeline → 取最后一条(阶段结果之后才是最终交付)", () => {
    const turns = pairTurns([TASKS[0]], [
      { taskId: "w1", content: "阶段结果", createdAt: 100 },
      { taskId: "w1", content: "最终结果", createdAt: 999 },
    ])
    expect(turns[0].answer).toBe("最终结果")
  })

  test("畸形数据不抛也不产出半条", () => {
    expect(pairTurns([], [])).toEqual([])
    expect(pairTurns([{ workState: "completed" } as any], [])).toEqual([]) // 没 id
    expect(pairTurns([{ id: "x", workState: "completed" } as any], [])).toEqual([]) // 没 objective
  })
})

describe("renderTurn", () => {
  const base = { taskId: "w1", objective: "查一下宇树科技的收入", state: "completed", createdAt: 1 }

  test("请求在上、回答在下,中间分隔", () => {
    const md = renderTurn({ ...base, answer: "## 结论\n收入 10 亿" })
    expect(md.startsWith("🎙️ **查一下宇树科技的收入**")).toBe(true)
    expect(md).toContain("---")
    expect(md).toContain("## 结论")
  })

  // 版面留给内容:taskId / 耗时那些排查信息在 voice-gateway.log 和 /api/tasks 里都有
  test("不掺元数据", () => {
    const md = renderTurn({ ...base, answer: "结果" })
    expect(md).not.toContain("w1")
    expect(md).not.toContain("taskId")
  })

  test("失败与空结果各自说人话,不留空白气泡", () => {
    expect(renderTurn({ ...base, state: "failed", answer: "权限不足" })).toContain("没能完成:权限不足")
    expect(renderTurn({ ...base, state: "failed", answer: "" })).toContain("没能完成")
    expect(renderTurn({ ...base, answer: "" })).toContain("没有留下文字结果")
  })
})

describe("pendingTurns", () => {
  // 轮询每几秒就会看到同一批已完成任务,不去重会把 journal 写成复读机
  test("已写过的不再写", () => {
    const turns = pairTurns(TASKS, TIMELINE)
    expect(pendingTurns(turns, new Set(["w2"])).map((t) => t.taskId)).toEqual(["w1", "w4"])
    expect(pendingTurns(turns, new Set(["w1", "w2", "w4"]))).toEqual([])
  })
})

describe("journalTitle", () => {
  test("带日期时分,便于一天多次开语音时区分", () => {
    expect(journalTitle(new Date(2026, 7, 21, 9, 5))).toBe("语音沟通 2026-08-21 09:05")
  })
})
