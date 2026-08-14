// [fork-only] @-mention 路径写法的**唯一不变式** [feat: external-drop-path-ref] 2026-08-14
//
// 本 feat 的目标是消除「同一个文件出现两种引用写法」。Mac 端把外部拖入那条腿接上了,
// 但 Windows 上不变式仍然不成立 —— 真机实测(`smoke/win_p0_drop_path.py`)拿到的证据:
//
//   通道                        插入的写法
//   `@` 提及补全                docs/产品架构方案.md      ← 正斜杠(产品自己认可的规范)
//   文件树 **多选** 拖入        docs/产品架构方案.md      ← 正斜杠(parseMultiPathDropPaths 归一化过)
//   外部拖入(资源管理器)      docs/产品架构方案.md      ← 正斜杠(toMentionPath 归一化过)
//   文件树 **单选** 拖入        docs\产品架构方案.md      ← **反斜杠,唯一的例外**
//
// 根因:单选走 `text/plain` = `file:${node.path}`,而 `node.path` 是 OS 原生写法
// (Windows 上带反斜杠,供 fs 操作用),塞进 @-mention 前没人归一化。
// macOS 上路径本来就是正斜杠,这条路径**永远暴露不出来** —— 属于 Mac 端原理上测不到的类别,
// 所以这份测试是 Windows 适配的产物,不是补 Mac 的漏。
import { describe, expect, test } from "bun:test"

import { parseMultiPathDropPaths, toMentionPath, toMentionSeparators } from "./multi-path-drop"

const WIN_ROOT = "D:\\Test Question Identification"
const POSIX_ROOT = "/Users/me/proj"

describe("toMentionSeparators —— 分隔符归一化", () => {
  test("W1 Windows 相对路径:反斜杠 → 正斜杠", () => {
    expect(toMentionSeparators("docs\\产品架构方案.md")).toBe("docs/产品架构方案.md")
  })

  test("W2 多层嵌套全部归一化,不只归一化第一个", () => {
    expect(toMentionSeparators("a\\b\\c\\d.txt")).toBe("a/b/c/d.txt")
  })

  test("W3 已经是正斜杠 → 原样(幂等,Mac 上调用它必须无副作用)", () => {
    expect(toMentionSeparators("docs/x.md")).toBe("docs/x.md")
  })

  test("W4 无分隔符的根目录文件 → 原样", () => {
    expect(toMentionSeparators("README.md")).toBe("README.md")
  })

  test("W5 空串不炸(拖到根节点等边界)", () => {
    expect(toMentionSeparators("")).toBe("")
  })
})

describe("三条通道产出同一种写法(本 feat 的不变式)", () => {
  // [bug-repro: Windows 上同一个文件,文件树单选拖入给 `docs\x.md`,
  //  而提及补全 / 多选拖入 / 外部拖入都给 `docs/x.md` —— 两种引用写法并存。
  //  真机证据见 smoke/win_p0_drop_path.py 的 W-C / W-D。]
  test("W6 单选拖入(相对路径)与外部拖入(绝对路径)归一到同一个值", () => {
    const relFromTree = "docs\\产品架构方案.md"
    const absFromExplorer = WIN_ROOT + "\\docs\\产品架构方案.md"

    expect(toMentionSeparators(relFromTree)).toBe("docs/产品架构方案.md")
    expect(toMentionPath(absFromExplorer, WIN_ROOT)).toBe("docs/产品架构方案.md")
    expect(toMentionSeparators(relFromTree)).toBe(toMentionPath(absFromExplorer, WIN_ROOT))
  })

  test("W7 多选拖入(绝对路径 JSON)也归到同一个值", () => {
    const json = JSON.stringify([WIN_ROOT + "\\docs\\产品架构方案.md"])
    expect(parseMultiPathDropPaths(json, WIN_ROOT)).toEqual(["docs/产品架构方案.md"])
  })

  test("W8 跨盘符:文件不在项目根下 → 完整绝对路径,但仍是正斜杠", () => {
    expect(toMentionPath("C:\\Users\\me\\报告.docx", WIN_ROOT)).toBe("C:/Users/me/报告.docx")
  })

  test("W9 root 带尾分隔符也能正确相对化(不能多吃/少吃一个字符)", () => {
    expect(toMentionPath(WIN_ROOT + "\\docs\\x.md", WIN_ROOT + "\\")).toBe("docs/x.md")
  })

  test("W10 POSIX 侧行为完全不变 —— 归一化对 Mac 是恒等变换", () => {
    expect(toMentionSeparators("docs/x.md")).toBe("docs/x.md")
    expect(toMentionPath(POSIX_ROOT + "/docs/x.md", POSIX_ROOT)).toBe("docs/x.md")
    expect(parseMultiPathDropPaths(JSON.stringify([POSIX_ROOT + "/a.txt"]), POSIX_ROOT)).toEqual(["a.txt"])
  })
})

describe("parseMultiPathDropPaths 既有容错不受影响", () => {
  test("W11 JSON 损坏 / 非数组 / 空 → 空数组,不抛", () => {
    expect(parseMultiPathDropPaths("{坏的", WIN_ROOT)).toEqual([])
    expect(parseMultiPathDropPaths(JSON.stringify({ a: 1 }), WIN_ROOT)).toEqual([])
    expect(parseMultiPathDropPaths(null, WIN_ROOT)).toEqual([])
    expect(parseMultiPathDropPaths(undefined, WIN_ROOT)).toEqual([])
  })

  test("W12 数组里混入非字符串 / 空串 → 跳过,不产生空引用", () => {
    const json = JSON.stringify([WIN_ROOT + "\\a.txt", 42, "", null, WIN_ROOT + "\\b.txt"])
    expect(parseMultiPathDropPaths(json, WIN_ROOT)).toEqual(["a.txt", "b.txt"])
  })

  test("W13 无 root(项目未打开)→ 只归一化,不相对化", () => {
    expect(parseMultiPathDropPaths(JSON.stringify(["C:\\x\\y.txt"]), undefined)).toEqual(["C:/x/y.txt"])
  })
})
