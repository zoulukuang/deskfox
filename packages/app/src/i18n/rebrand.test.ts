// FORK-ONLY: i18n 品牌替换层单测 [feat: ui-brand-deskfox] 2026-06-06
import { describe, expect, test } from "bun:test"
import { rebrandValue, rebrandDict } from "./rebrand"

describe("i18n rebrand", () => {
  test("普通 OpenCode 文案 → DeskFox", () => {
    expect(rebrandValue("更改 OpenCode 的显示语言")).toBe("更改 DeskFox 的显示语言")
    expect(rebrandValue("OpenCode 有新版本 (1.2.3) 可安装。")).toBe("DeskFox 有新版本 (1.2.3) 可安装。")
    expect(rebrandValue("在 OpenCode 启动时自动检查更新")).toBe("在 DeskFox 启动时自动检查更新")
  })

  test('保留第三方服务名 "OpenCode Zen"', () => {
    expect(rebrandValue("使用 OpenCode Zen 或 API 密钥连接")).toBe("使用 OpenCode Zen 或 API 密钥连接")
    expect(rebrandValue("OpenCode Zen gives you access")).toBe("OpenCode Zen gives you access")
  })

  test('"OpenCode Desktop" 收敛为 "DeskFox"(不留 Desktop 后缀)', () => {
    expect(rebrandValue("OpenCode Desktop")).toBe("DeskFox")
  })

  test("同一条里 Zen 与普通 OpenCode 混排,只改普通的", () => {
    expect(rebrandValue("OpenCode Zen 由 OpenCode 提供")).toBe("OpenCode Zen 由 DeskFox 提供")
  })

  test("小写 opencode(scheme/包名)不动", () => {
    expect(rebrandValue("opencode://open?path=/x")).toBe("opencode://open?path=/x")
    expect(rebrandValue("@opencode-ai/ui")).toBe("@opencode-ai/ui")
  })

  test("rebrandDict 只改 value 不改 key", () => {
    const out = rebrandDict({
      "dialog.provider.opencode.note": "使用 OpenCode Zen 连接",
      "settings.general.row.language.description": "更改 OpenCode 的显示语言",
    })
    expect(Object.keys(out)).toEqual(["dialog.provider.opencode.note", "settings.general.row.language.description"])
    expect(out["dialog.provider.opencode.note"]).toBe("使用 OpenCode Zen 连接")
    expect(out["settings.general.row.language.description"]).toBe("更改 DeskFox 的显示语言")
  })
})
