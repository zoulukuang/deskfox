import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import {
  canNavigateHistoryAtCursor,
  // FORK: REQ-123 2026-08-19
  historyCommentToContextItem,
  migrateStoredHistory,
  clonePromptParts,
  normalizePromptHistoryEntry,
  navigatePromptHistory,
  prependHistoryEntry,
  promptLength,
  type PromptHistoryComment,
} from "./history"

const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

const text = (value: string): Prompt => [{ type: "text", content: value, start: 0, end: value.length }]
const comment = (id: string, value = "note"): PromptHistoryComment => ({
  id,
  path: "src/a.ts",
  selection: { start: 2, end: 4 },
  comment: value,
  time: 1,
  origin: "review",
  preview: "const a = 1",
})

describe("prompt-input history", () => {
  test("prependHistoryEntry skips empty prompt and deduplicates consecutive entries", () => {
    const first = prependHistoryEntry([], DEFAULT_PROMPT)
    expect(first).toEqual([])

    const commentsOnly = prependHistoryEntry([], DEFAULT_PROMPT, [comment("c1")])
    expect(commentsOnly).toHaveLength(1)

    const withOne = prependHistoryEntry([], text("hello"))
    expect(withOne).toHaveLength(1)

    const deduped = prependHistoryEntry(withOne, text("hello"))
    expect(deduped).toBe(withOne)

    const dedupedComments = prependHistoryEntry(commentsOnly, DEFAULT_PROMPT, [comment("c1")])
    expect(dedupedComments).toBe(commentsOnly)
  })

  test("navigatePromptHistory restores saved prompt when moving down from newest", () => {
    const entries = [text("third"), text("second"), text("first")]
    const up = navigatePromptHistory({
      direction: "up",
      entries,
      historyIndex: -1,
      currentPrompt: text("draft"),
      currentComments: [comment("draft")],
      savedPrompt: null,
    })
    expect(up.handled).toBe(true)
    if (!up.handled) throw new Error("expected handled")
    expect(up.historyIndex).toBe(0)
    expect(up.cursor).toBe("start")
    expect(up.entry.comments).toEqual([])

    const down = navigatePromptHistory({
      direction: "down",
      entries,
      historyIndex: up.historyIndex,
      currentPrompt: text("ignored"),
      currentComments: [],
      savedPrompt: up.savedPrompt,
    })
    expect(down.handled).toBe(true)
    if (!down.handled) throw new Error("expected handled")
    expect(down.historyIndex).toBe(-1)
    expect(down.entry.prompt[0]?.type === "text" ? down.entry.prompt[0].content : "").toBe("draft")
    expect(down.entry.comments).toEqual([comment("draft")])
  })

  test("navigatePromptHistory keeps entry comments when moving through history", () => {
    const entries = [
      {
        prompt: text("with comment"),
        comments: [comment("c1")],
      },
    ]

    const up = navigatePromptHistory({
      direction: "up",
      entries,
      historyIndex: -1,
      currentPrompt: text("draft"),
      currentComments: [],
      savedPrompt: null,
    })

    expect(up.handled).toBe(true)
    if (!up.handled) throw new Error("expected handled")
    expect(up.entry.prompt[0]?.type === "text" ? up.entry.prompt[0].content : "").toBe("with comment")
    expect(up.entry.comments).toEqual([comment("c1")])
  })

  test("normalizePromptHistoryEntry supports legacy prompt arrays", () => {
    const entry = normalizePromptHistoryEntry(text("legacy"))
    expect(entry.prompt[0]?.type === "text" ? entry.prompt[0].content : "").toBe("legacy")
    expect(entry.comments).toEqual([])
  })

  test("helpers clone prompt and count text content length", () => {
    const original: Prompt = [
      { type: "text", content: "one", start: 0, end: 3 },
      {
        type: "file",
        path: "src/a.ts",
        content: "@src/a.ts",
        start: 3,
        end: 12,
        selection: { startLine: 1, startChar: 1, endLine: 2, endChar: 1 },
      },
      { type: "image", id: "1", filename: "img.png", mime: "image/png", blob: { id: "blob", url: "blob:test" } },
    ]
    const copy = clonePromptParts(original)
    expect(copy).not.toBe(original)
    expect(promptLength(copy)).toBe(12)
    if (copy[1]?.type !== "file") throw new Error("expected file")
    copy[1].selection!.startLine = 9
    if (original[1]?.type !== "file") throw new Error("expected file")
    expect(original[1].selection?.startLine).toBe(1)
  })

  test("canNavigateHistoryAtCursor only allows prompt boundaries", () => {
    const value = "a\nb\nc"

    expect(canNavigateHistoryAtCursor("up", value, 0)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", value, 0)).toBe(false)

    expect(canNavigateHistoryAtCursor("up", value, 2)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", value, 2)).toBe(false)

    expect(canNavigateHistoryAtCursor("up", value, 5)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", value, 5)).toBe(true)

    expect(canNavigateHistoryAtCursor("up", "abc", 0)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", "abc", 3)).toBe(true)
    expect(canNavigateHistoryAtCursor("up", "abc", 1)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", "abc", 1)).toBe(false)

    expect(canNavigateHistoryAtCursor("up", "", 0)).toBe(true)
    expect(canNavigateHistoryAtCursor("down", "", 0)).toBe(true)

    expect(canNavigateHistoryAtCursor("up", "abc", 0, true)).toBe(true)
    expect(canNavigateHistoryAtCursor("up", "abc", 3, true)).toBe(true)
    expect(canNavigateHistoryAtCursor("down", "abc", 0, true)).toBe(true)
    expect(canNavigateHistoryAtCursor("down", "abc", 3, true)).toBe(true)
    expect(canNavigateHistoryAtCursor("up", "abc", 1, true)).toBe(false)
    expect(canNavigateHistoryAtCursor("down", "abc", 1, true)).toBe(false)
  })
})

// FORK-BEGIN: REQ-087 历史剥离图片 part [feat: renderer-snapshot-oom] 2026-08-02
describe("history image stripping (REQ-087)", () => {
  const IMAGE_PART = {
    type: "image" as const,
    id: "img-1",
    filename: "shot.png",
    mime: "image/png",
    // 2026-08-11 sync v1.18.16:附件 blob 化(dataUrl → blob 引用),剥离逻辑按 type 判定不受影响
    blob: { id: "blob-1", url: "blob:mock/img-1" },
  }
  const textPart = (content: string) => ({ type: "text" as const, content, start: 0, end: content.length })

  test("prependHistoryEntry strips image parts but keeps text and comments", () => {
    const prompt: Prompt = [textPart("hello"), IMAGE_PART]
    const entries = prependHistoryEntry([], prompt, [comment("c1", "why")])
    expect(entries).toHaveLength(1)
    const entry = normalizePromptHistoryEntry(entries[0])
    expect(entry.prompt.some((part) => part.type === "image")).toBe(false)
    expect(entry.prompt.some((part) => part.type === "text" && part.content === "hello")).toBe(true)
    expect(entry.comments).toHaveLength(1)
  })

  test("image-only prompt does not create a history entry", () => {
    const prompt: Prompt = [textPart(""), IMAGE_PART]
    expect(prependHistoryEntry([], prompt, [])).toHaveLength(0)
  })

  test("normalizePromptHistoryEntry filters image parts from legacy entries", () => {
    const legacyArray = normalizePromptHistoryEntry([textPart("old"), IMAGE_PART])
    expect(legacyArray.prompt).toHaveLength(1)
    expect(legacyArray.prompt[0]?.type).toBe("text")

    const legacyObject = normalizePromptHistoryEntry({ prompt: [IMAGE_PART, textPart("keep")], comments: [] })
    expect(legacyObject.prompt.some((part) => part.type === "image")).toBe(false)
  })

  test("migrateStoredHistory strips dataUrl and drops entries left empty", () => {
    const stored = {
      entries: [
        { prompt: [textPart("keep me"), IMAGE_PART], comments: [] },
        { prompt: [textPart(""), IMAGE_PART], comments: [] }, // 纯图片 → 清洗后空壳,丢弃
        [textPart("legacy array"), IMAGE_PART],
        { prompt: [textPart("")], comments: [comment("c2", "has question")] }, // 空文本但有 comment → 保留
      ],
    }
    const migrated = migrateStoredHistory(stored) as { entries: unknown[] }
    expect(migrated.entries).toHaveLength(3)
    expect(JSON.stringify(migrated)).not.toContain("dataUrl")
  })

  test("migrateStoredHistory passes through malformed values untouched", () => {
    expect(migrateStoredHistory(null)).toBeNull()
    expect(migrateStoredHistory("junk")).toBe("junk")
    expect(migrateStoredHistory({ nope: 1 })).toEqual({ nope: 1 })
  })
})
// FORK-END

// FORK-BEGIN: REQ-123 — ↑ 历史回填的引用卡片必须保真(kind 曾在 legacy/v2 两处内联映射里同时漏掉,
// 导致找回的聊天引用退化成显示伪路径文件名的文件卡片)2026-08-19
describe("historyCommentToContextItem", () => {
  const base = {
    id: "quote-abc-1",
    path: "<chat selection>",
    selection: { start: 0, end: 0 },
    comment: "这段什么意思",
    time: 1,
  } satisfies PromptHistoryComment

  // T14
  test("聊天引用回填带 kind,不退化成文件卡片", () => {
    const item = historyCommentToContextItem({ ...base, origin: "quote", kind: "chat", preview: "引文" })
    expect(item).toMatchObject({
      type: "file",
      path: "<chat selection>",
      comment: "这段什么意思",
      commentID: "quote-abc-1",
      commentOrigin: "quote",
      preview: "引文",
      kind: "chat",
    })
  })

  test("文件引用与 review 评论的字段照原样传递", () => {
    expect(historyCommentToContextItem({ ...base, path: "a.md", origin: "file", kind: "file" })).toMatchObject({
      path: "a.md",
      commentOrigin: "file",
      kind: "file",
    })
    expect(historyCommentToContextItem({ ...base, path: "a.ts", origin: "review" })).toMatchObject({
      commentOrigin: "review",
      kind: undefined,
    })
  })

  test("行范围还原成 FileSelection", () => {
    const item = historyCommentToContextItem({ ...base, path: "a.ts", selection: { start: 3, end: 5 } })
    expect(item.selection).toMatchObject({ startLine: 3, endLine: 5 })
  })
})
// FORK-END
