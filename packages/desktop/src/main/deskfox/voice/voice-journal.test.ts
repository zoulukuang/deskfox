// [fork-only] REQ-102 语音派活 — 语音沟通记录单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 2-plan「C:另造可读的语音沟通 session」。样本字段取自真实的 /api/tasks 与 /api/timeline。
import { describe, expect, test } from "bun:test"
import { journalKey, journalTitle, pairTurns, pendingWrites, renderTurn } from "./voice-journal"

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
    expect(turns.map((t) => t.taskId)).toEqual(["w2", "w1", "w3", "w4"])
    expect(turns[1].answer).toContain("宇树科技")
  })

  // 2026-08-21 user:「只要发起了就该出现在列表里,哪怕正在运行中」——
  // 原来只收 completed/failed,刚说完话时列表什么都不多,看着像没生效
  test("running 的轮次也收 —— 发起就要可见", () => {
    expect(pairTurns(TASKS, TIMELINE).some((t) => t.taskId === "w3")).toBe(true)
  })

  test("取消掉的不收(用户自己撤回的,留着碍眼)", () => {
    const t = pairTurns([{ id: "c1", objective: "撤回的活", workState: "cancelled", createdAt: 1 }], [])
    expect(t).toEqual([])
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

  // 拆两条是因为 noReply 只能追加、改不了已写的消息 —— 要"发起就可见"就只能先写请求
  test("请求条只有原话,不掺回答", () => {
    const md = renderTurn({ ...base, answer: "## 结论\n收入 10 亿" }, "request")
    expect(md).toBe("🎙️ **查一下宇树科技的收入**")
  })

  test("结果条只有回答,不重复请求(交替读下来才像对话)", () => {
    const md = renderTurn({ ...base, answer: "## 结论\n收入 10 亿" }, "answer")
    expect(md).toBe("## 结论\n收入 10 亿")
    expect(md).not.toContain("🎙️")
  })

  // 版面留给内容:taskId / 耗时那些排查信息在 voice-gateway.log 和 /api/tasks 里都有
  test("不掺元数据", () => {
    expect(renderTurn({ ...base, answer: "结果" }, "answer")).not.toContain("w1")
    expect(renderTurn({ ...base, answer: "结果" }, "request")).not.toContain("taskId")
  })

  test("失败与空结果各自说人话,不留空白气泡", () => {
    expect(renderTurn({ ...base, state: "failed", answer: "权限不足" }, "answer")).toContain("没能完成:权限不足")
    expect(renderTurn({ ...base, state: "failed", answer: "" }, "answer")).toContain("没能完成")
    expect(renderTurn({ ...base, answer: "" }, "answer")).toContain("没有留下文字结果")
  })
})

describe("pendingWrites", () => {
  const turns = pairTurns(TASKS, TIMELINE)

  test("running 只出请求条 —— 结果还没有,不能先写", () => {
    const running = turns.filter((t) => t.taskId === "w3")
    expect(pendingWrites(running, new Set()).map((w) => w.phase)).toEqual(["request"])
  })

  test("已有结论的出两条,请求排在结果前面", () => {
    const done = turns.filter((t) => t.taskId === "w1")
    expect(pendingWrites(done, new Set()).map((w) => w.phase)).toEqual(["request", "answer"])
  })

  // 轮询每几秒就看到同一批任务,不去重会把 journal 写成复读机
  test("按 taskId+phase 去重:请求写过了,跑完只补结果", () => {
    const done = turns.filter((t) => t.taskId === "w1")
    const written = new Set([journalKey("w1", "request")])
    expect(pendingWrites(done, written).map((w) => w.phase)).toEqual(["answer"])
    written.add(journalKey("w1", "answer"))
    expect(pendingWrites(done, written)).toEqual([])
  })

  test("journalKey 把两个阶段分开,不会互相顶掉", () => {
    expect(journalKey("w1", "request")).not.toBe(journalKey("w1", "answer"))
  })
})

describe("journalTitle", () => {
  test("带日期时分,便于一天多次开语音时区分", () => {
    expect(journalTitle(new Date(2026, 7, 21, 9, 5))).toBe("语音沟通 2026-08-21 09:05")
  })
})
