import { describe, expect, test } from "bun:test"
import { resolveLocalIconOverride } from "./project-icon-override"

// [feat: project-avatar-save] [bug-repro: meta 路径写进 projectMeta.icon.override 的头像,enrich 解析必须读到,否则永久不显示]
describe("resolveLocalIconOverride", () => {
  test("bug-repro:override 只存在 projectMeta.icon.override 时(无 id / global 项目的 meta 保存路径)必须解析出来", () => {
    // 修复前 enrich 只读 childStore.icon,这个 override 被忽略 → 侧边栏永远显示字母 fallback。
    const result = resolveLocalIconOverride(undefined, {
      icon: { override: "data:image/png;base64,DOCTOR" },
    })
    expect(result).toBe("data:image/png;base64,DOCTOR")
  })

  test("childStore.icon 优先(update 路径写的 per-workspace 覆盖)", () => {
    const result = resolveLocalIconOverride("data:image/png;base64,FROM_ICON", {
      icon: { override: "data:image/png;base64,FROM_META" },
    })
    expect(result).toBe("data:image/png;base64,FROM_ICON")
  })

  test("两个本地来源都空 → undefined(enrich 回退到 DB metadata.icon)", () => {
    expect(resolveLocalIconOverride(undefined, undefined)).toBeUndefined()
    expect(resolveLocalIconOverride("", { icon: {} })).toBeUndefined()
    expect(resolveLocalIconOverride("", { icon: { override: "" } })).toBeUndefined()
  })

  test("projectMeta 为 undefined / 无 icon 字段时不抛错", () => {
    expect(resolveLocalIconOverride(undefined, undefined)).toBeUndefined()
    expect(resolveLocalIconOverride(undefined, {})).toBeUndefined()
    expect(resolveLocalIconOverride("data:x", undefined)).toBe("data:x")
  })
})
