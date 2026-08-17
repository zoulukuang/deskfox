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

// FORK: REQ-109 shell 折叠可配置回归 [feat: session-presentation-input-batch] 2026-08-17
// 两套口径都是合法配置:产品默认 grouped=true(user 要的折叠),e2e fixture 种 false(上游断言口径)。
// 2026-08-11 那次撤销正是把测试反向改写后无人察觉,故这里把「哪套是产品默认」也锁进断言。
describe("groupParts · shellGrouped 两套口径", () => {
  test("不传 options 时与上游逐字一致 —— shell 独立成行", () => {
    const parts = [gpTool("p1", "bash"), gpTool("p2", "bash"), gpTool("p3", "shell")]
    expect(groupParts(parts).map((g) => g.type)).toEqual(["part", "part", "part"])
    expect(groupParts(parts, { shellGrouped: false }).map((g) => g.type)).toEqual(["part", "part", "part"])
  })

  test("shellGrouped=true:连续 shell 收进一个 command 组", () => {
    const groups = groupParts(
      [gpTool("p1", "bash"), gpTool("p2", "bash"), gpTool("p3", "shell"), gpTool("p4", "bash")],
      { shellGrouped: true },
    )
    expect(groups).toHaveLength(1)
    const group = groups[0]!
    expect(group.type).toBe("command")
    expect(group.type === "command" && group.refs.map((ref) => ref.partID)).toEqual(["p1", "p2", "p3", "p4"])
  })

  test("命令组与探索组互不吞并 —— 各自成组、顺序不变", () => {
    const groups = groupParts(
      [gpTool("p1", "read"), gpTool("p2", "grep"), gpTool("p3", "bash"), gpTool("p4", "bash"), gpTool("p5", "list")],
      { shellGrouped: true },
    )
    expect(groups.map((g) => g.type)).toEqual(["context", "command", "context"])
    expect(groups[0]!.type === "context" && groups[0]!.refs).toHaveLength(2)
    expect(groups[1]!.type === "command" && groups[1]!.refs).toHaveLength(2)
    expect(groups[2]!.type === "context" && groups[2]!.refs).toHaveLength(1)
  })

  test("中间夹了别的工具时断开重新计数", () => {
    const groups = groupParts([gpTool("p1", "bash"), gpTool("p2", "edit"), gpTool("p3", "bash")], {
      shellGrouped: true,
    })
    expect(groups.map((g) => g.type)).toEqual(["command", "part", "command"])
  })

  test("单条 shell 也成组(与「已探索」组同口径,不搞特例)", () => {
    const groups = groupParts([gpTool("p1", "bash")], { shellGrouped: true })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.type).toBe("command")
  })

  test("组 key 带类型前缀,两种组不会撞 key", () => {
    const groups = groupParts([gpTool("p1", "read"), gpTool("p2", "bash")], { shellGrouped: true })
    expect(groups.map((g) => g.key)).toEqual(["context:p1", "command:p2"])
  })

  test("非 shell/探索工具在任何口径下都独立成行", () => {
    const parts = [gpTool("p1", "edit"), gpTool("p2", "write"), gpText("p3")]
    expect(groupParts(parts, { shellGrouped: true }).map((g) => g.type)).toEqual(["part", "part", "part"])
  })
})
