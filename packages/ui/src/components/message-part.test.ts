import { describe, expect, test } from "bun:test"
import type { Part as PartType } from "@opencode-ai/sdk/v2"
import { readPartText } from "./message-part-text"
import { groupParts } from "./message-part-grouping"

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})

// FORK: bash 纳入「已探索」折叠组的回归测试 — 连续 shell 调用应折叠成一个 context 组,
// 而不是每条 bash 单独成行竖向铺开。2026-06-19
function gpTool(id: string, name: string): { messageID: string; part: PartType } {
  return { messageID: "msg_1", part: { id, type: "tool", tool: name } as unknown as PartType }
}
function gpText(id: string): { messageID: string; part: PartType } {
  return { messageID: "msg_1", part: { id, type: "text", text: "hi" } as unknown as PartType }
}

describe("groupParts — bash 折叠", () => {
  test("单条 bash 归入 context 折叠组(不再单独成行)", () => {
    const groups = groupParts([gpTool("p1", "bash")])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.type).toBe("context")
  })

  test("连续 bash + read/grep 折叠进同一个 context 组", () => {
    const groups = groupParts([gpTool("p1", "bash"), gpTool("p2", "read"), gpTool("p3", "grep"), gpTool("p4", "bash")])
    expect(groups).toHaveLength(1)
    const g = groups[0]!
    expect(g.type).toBe("context")
    expect(g.type === "context" && g.refs.length).toBe(4)
  })

  test("text 仍是独立 part,后续 bash 折叠成 context 组", () => {
    const groups = groupParts([gpText("p1"), gpTool("p2", "bash"), gpTool("p3", "bash")])
    expect(groups).toHaveLength(2)
    expect(groups[0]!.type).toBe("part")
    const g = groups[1]!
    expect(g.type).toBe("context")
    expect(g.type === "context" && g.refs.length).toBe(2)
  })
})
