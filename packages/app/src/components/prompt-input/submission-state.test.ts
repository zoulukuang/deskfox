// FORK-ONLY: REQ-116 新会话残留已发送上下文卡(workspace 草稿泄漏)回归锁
// [feat: session-presentation-input-batch] 2026-08-17
//
// 场景:新会话态(workspace scope 草稿)发送消息 → 后端建会话 → retarget 到会话 scope。
// 上游 clear() 只对 initial 做 reset()(纯文本重置),**initial 的 context.items 不清** →
// 已发送的评论卡/附件卡永久留在 workspace 草稿里,下一条新会话消息会把它们再发一次给模型。
// 又因走 per-project 持久化草稿,不会自愈。
//
// 本测锁三件事:① retarget + clear 后 initial scope 的 context 为空;
// ② 现有会话流(target === initial)行为不变(上游语义,不在本批推翻);
// ③ restore() 快照不被这次修理牵连(发送失败仍可恢复)。
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createPromptState, type ContextItem } from "@/context/prompt-state"
import { createPromptSubmissionState } from "./submission-state"

type PromptTarget = ReturnType<ReturnType<typeof createPromptState>["capture"]>

const commentItem = (path: string, commentID: string): ContextItem => ({
  type: "file",
  path,
  comment: "看看这里",
  commentID,
  commentOrigin: "file",
})

const attachmentItem = (path: string): ContextItem => ({
  type: "file",
  path,
})

// 复刻 submit.ts handleSubmit 的取值方式:target = prompt.capture(),
// context = target.context.items().slice()(发送瞬间的快照)
const createSubmission = (target: PromptTarget) =>
  createPromptSubmissionState({
    target,
    prompt: target.current(),
    context: target.context.items().slice(),
  })

describe("createPromptSubmissionState · 新会话 retarget 后的 clear 语义", () => {
  test("retarget + clear 后 initial scope 的 context.items 清空(REQ-116 泄漏点)", () => {
    createRoot((dispose) => {
      const workspace = createPromptState().capture()
      const session = createPromptState().capture()

      workspace.context.add(commentItem("src/a.ts", "c1"))
      workspace.context.add(commentItem("src/b.ts", "c2"))
      expect(workspace.context.items()).toHaveLength(2)

      const submission = createSubmission(workspace)
      submission.retarget(session)
      submission.clear()

      expect(workspace.context.items()).toEqual([])
      dispose()
    })
  })

  test("裸文件附件卡(非 comment)同样不泄漏", () => {
    createRoot((dispose) => {
      const workspace = createPromptState().capture()
      const session = createPromptState().capture()

      workspace.context.add(attachmentItem("src/a.ts"))
      workspace.context.add(commentItem("src/b.ts", "c1"))

      const submission = createSubmission(workspace)
      submission.retarget(session)
      submission.clear()

      expect(workspace.context.items()).toEqual([])
      dispose()
    })
  })

  test("retarget 把卡片交接给新会话 scope,内容不丢", () => {
    createRoot((dispose) => {
      const workspace = createPromptState().capture()
      const session = createPromptState().capture()

      workspace.context.add(commentItem("src/a.ts", "c1"))
      workspace.context.add(attachmentItem("src/b.ts"))

      const submission = createSubmission(workspace)
      submission.retarget(session)
      submission.clear()

      expect(
        session.context
          .items()
          .map((item) => item.path)
          .sort(),
      ).toEqual(["src/a.ts", "src/b.ts"])
      dispose()
    })
  })

  test("现有会话流(target === initial)不受影响 —— 上游保留语义未被误改", () => {
    createRoot((dispose) => {
      const existing = createPromptState().capture()
      existing.context.add(attachmentItem("src/a.ts"))

      const submission = createSubmission(existing)
      submission.clear()

      // 上游语义:同一 scope 下 clear() 只重置文本,context 由 submit.ts 的调用方自行处理
      expect(existing.context.items()).toHaveLength(1)
      dispose()
    })
  })

  test("clear 后 restore() 快照仍可用 —— 发送失败可恢复评论卡/附件卡", () => {
    createRoot((dispose) => {
      const workspace = createPromptState().capture()
      const session = createPromptState().capture()

      workspace.set([{ type: "text", content: "帮我改一下", start: 0, end: 5 }])
      workspace.context.add(commentItem("src/a.ts", "c1"))

      const submission = createSubmission(workspace)
      submission.retarget(session)
      submission.clear()

      const restored = submission.restore()
      expect(restored).toBeDefined()
      expect(restored!.target).toBe(session)
      expect(restored!.context.map((item) => item.path)).toEqual(["src/a.ts"])
      expect(restored!.prompt.map((part) => ("content" in part ? part.content : ""))).toEqual(["帮我改一下"])
      dispose()
    })
  })
})
