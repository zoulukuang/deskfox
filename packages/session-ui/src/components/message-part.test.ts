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

// FORK: REQ-113 时间线噪声治理 [feat: session-presentation-input-batch] 2026-08-17
function gpEdit(
  id: string,
  filePath: string | undefined,
  tool = "edit",
  status = "completed",
): { messageID: string; part: PartType } {
  return {
    messageID: "msg_1",
    part: { id, type: "tool", tool, state: { status, input: { filePath } } } as unknown as PartType,
  }
}

describe("groupParts · REQ-113A 连续 invalid 合并", () => {
  test("连续 invalid 合并成一组(内容逐字相同的纯噪声)", () => {
    const groups = groupParts([gpTool("p1", "invalid"), gpTool("p2", "invalid"), gpTool("p3", "invalid")])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.type).toBe("invalid")
    expect(groups[0]!.type === "invalid" && groups[0]!.refs).toHaveLength(3)
  })

  test("中间夹了别的工具时断开重新计数", () => {
    const groups = groupParts([
      gpTool("p1", "invalid"),
      gpTool("p2", "invalid"),
      gpText("p3"),
      gpTool("p4", "invalid"),
    ])
    expect(groups.map((g) => g.type)).toEqual(["invalid", "part", "invalid"])
  })

  test("invalid 不与探索/命令组互相吞并", () => {
    const groups = groupParts([gpTool("p1", "read"), gpTool("p2", "invalid"), gpTool("p3", "bash")], {
      shellGrouped: true,
    })
    expect(groups.map((g) => g.type)).toEqual(["context", "invalid", "command"])
  })

  test("单条 invalid 也成组(合并后仍是一行,行为一致)", () => {
    const groups = groupParts([gpTool("p1", "invalid")])
    expect(groups[0]!.type).toBe("invalid")
  })
})

describe("groupParts · REQ-113B 同文件连续编辑合并(不进折叠组)", () => {
  test("同文件连续 4 次编辑合成一行 repeat", () => {
    const groups = groupParts([
      gpEdit("p1", "a.py"),
      gpEdit("p2", "a.py"),
      gpEdit("p3", "a.py"),
      gpEdit("p4", "a.py"),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.type).toBe("repeat")
    expect(groups[0]!.type === "repeat" && groups[0]!.refs).toHaveLength(4)
  })

  test("**单次编辑仍是独立 part 行** —— 可见性不降级(本条是 REQ-113B 的分寸所在)", () => {
    const groups = groupParts([gpEdit("p1", "a.py")])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.type).toBe("part")
  })

  test("换文件即断开重新计数,绝不错并两个文件", () => {
    const groups = groupParts([
      gpEdit("p1", "a.py"),
      gpEdit("p2", "a.py"),
      gpEdit("p3", "b.py"),
      gpEdit("p4", "b.py"),
    ])
    expect(groups.map((g) => g.type)).toEqual(["repeat", "repeat"])
    expect(groups[0]!.type === "repeat" && groups[0]!.refs.map((r) => r.partID)).toEqual(["p1", "p2"])
    expect(groups[1]!.type === "repeat" && groups[1]!.refs.map((r) => r.partID)).toEqual(["p3", "p4"])
  })

  test("中间夹了别的工具时断开重新计数(不跨越无关条目错误合并)", () => {
    const groups = groupParts([gpEdit("p1", "a.py"), gpEdit("p2", "a.py"), gpTool("p3", "bash"), gpEdit("p4", "a.py")])
    expect(groups.map((g) => g.type)).toEqual(["repeat", "part", "part"])
  })

  test("edit 与 write 混排同文件也合并(同为写同一个文件)", () => {
    const groups = groupParts([gpEdit("p1", "a.py", "edit"), gpEdit("p2", "a.py", "write")])
    expect(groups[0]!.type).toBe("repeat")
  })

  test("取不到 filePath 的编辑不参与合并 —— 宁可多一行不要错并", () => {
    const groups = groupParts([gpEdit("p1", undefined), gpEdit("p2", undefined)])
    expect(groups.map((g) => g.type)).toEqual(["part", "part"])
  })

  test("失败的编辑绝不合并 —— 失败是信号不是重复,合并会把其中一次失败整个藏掉", () => {
    // 2026-08-17 被上游 tool-projection e2e 抓到:连续失败的 edit+write 同文件被错并成一行,
    // 错误卡从 10 张掉到 9 张。此测把这条教训钉死。
    const groups = groupParts([
      gpEdit("p1", "a.py", "edit", "error"),
      gpEdit("p2", "a.py", "write", "error"),
    ])
    expect(groups.map((g) => g.type)).toEqual(["part", "part"])
  })

  test("进行中的编辑也不并 —— 免得把在跑的那次吞进历史行", () => {
    const groups = groupParts([
      gpEdit("p1", "a.py", "edit", "completed"),
      gpEdit("p2", "a.py", "edit", "running"),
    ])
    expect(groups.map((g) => g.type)).toEqual(["part", "part"])
  })

  test("成功编辑串中间夹一次失败 → 断开,失败那条独立可见", () => {
    const groups = groupParts([
      gpEdit("p1", "a.py"),
      gpEdit("p2", "a.py"),
      gpEdit("p3", "a.py", "edit", "error"),
      gpEdit("p4", "a.py"),
      gpEdit("p5", "a.py"),
    ])
    expect(groups.map((g) => g.type)).toEqual(["repeat", "part", "repeat"])
  })

  test("patch 首版不参与合并(用的是 input.files 不是 filePath)", () => {
    const groups = groupParts([gpEdit("p1", "a.py", "patch"), gpEdit("p2", "a.py", "patch")])
    expect(groups.map((g) => g.type)).toEqual(["part", "part"])
  })

  test("混合序列:探索 → 编辑 → 命令 → 无效,四类各自成行不串味", () => {
    const groups = groupParts(
      [
        gpTool("p1", "read"),
        gpEdit("p2", "a.py"),
        gpEdit("p3", "a.py"),
        gpTool("p4", "bash"),
        gpTool("p5", "bash"),
        gpTool("p6", "invalid"),
        gpTool("p7", "invalid"),
      ],
      { shellGrouped: true },
    )
    expect(groups.map((g) => g.type)).toEqual(["context", "repeat", "command", "invalid"])
  })
})
