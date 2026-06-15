// [fork-only] Fox Blue 主题克隆完整性测试 [feat: fox-blue-theme]
//
// Fox Blue = OC-2 的忠实克隆(仅 name/id 不同),选中态的 logo 蓝差异落在
// packages/branding/src/theme.css 的 scoped CSS,而非 json token。
// 本测试锁住两点:
//  1. id/name 正确(主题选择器靠 json.name 显示「Fox Blue」)。
//  2. light/dark 的全部 token 与 OC-2 逐字节相等 —— 一旦上游改了 oc-2.json,
//     这里会红,提示「fox-blue 需重新同步 OC-2」(而不是悄悄漂移)。
import { describe, expect, test } from "bun:test"
import foxBlue from "./fox-blue.json"
import oc2 from "./oc-2.json"

describe("fox-blue theme", () => {
  test("身份字段正确", () => {
    expect(foxBlue.id).toBe("fox-blue")
    expect(foxBlue.name).toBe("Fox Blue")
  })

  test("是 OC-2 的忠实克隆 — light/dark token 完全相等", () => {
    // 仅 name/id 允许不同;颜色 token 必须与 OC-2 一致(蓝色差异走 branding CSS)。
    expect(foxBlue.light).toEqual(oc2.light)
    expect(foxBlue.dark).toEqual(oc2.dark)
    expect(foxBlue.$schema).toBe(oc2.$schema)
  })

  test("身份字段确实与 OC-2 不同(防误把 oc-2 复制成同名)", () => {
    expect(foxBlue.id).not.toBe(oc2.id)
    expect(foxBlue.name).not.toBe(oc2.name)
  })
})
