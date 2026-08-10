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

// FORK: 分组语义回归测试 — 2026-08-11 sync v1.18.4 起 bash 对齐上游独立成行(不再入折叠组,
// 撤销 2026-06-19 定制;上游用 shellToolPartsExpanded 默认收起解决竖向铺开)。
function gpTool(id: string, name: string): { messageID: string; part: PartType } {
  return { messageID: "msg_1", part: { id, type: "tool", tool: name } as unknown as PartType }
}
function gpText(id: string): { messageID: string; part: PartType } {
  return { messageID: "msg_1", part: { id, type: "text", text: "hi" } as unknown as PartType }
}

describe("groupParts — bash 独立成行(对齐上游)", () => {
  test("单条 bash 独立成 part 行(不入 context 折叠组)", () => {
    const groups = groupParts([gpTool("p1", "bash")])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.type).toBe("part")
  })

  test("bash 打断 read/grep 折叠组:探索工具照常折叠,bash 单独成行", () => {
    const groups = groupParts([gpTool("p1", "bash"), gpTool("p2", "read"), gpTool("p3", "grep"), gpTool("p4", "bash")])
    expect(groups).toHaveLength(3)
    expect(groups[0]!.type).toBe("part")
    const g = groups[1]!
    expect(g.type).toBe("context")
    expect(g.type === "context" && g.refs.length).toBe(2)
    expect(groups[2]!.type).toBe("part")
  })

  test("text 与 bash 均为独立 part", () => {
    const groups = groupParts([gpText("p1"), gpTool("p2", "bash"), gpTool("p3", "bash")])
    expect(groups).toHaveLength(3)
    for (const g of groups) expect(g.type).toBe("part")
  })
})
