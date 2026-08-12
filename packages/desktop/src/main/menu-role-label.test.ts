// [fork-only] 纯系统 role 菜单项译名回归钉 [feat: native-role-menu-i18n] 2026-08-12
//
// 起源:2026-08 上游同步段4「菜单上游化」撤掉 fork 的 desktop-menu-i18n 后,About / Hide /
// Hide Others / Show All / Quit 这几个**没有 labelKey** 的纯 role 项走不到 nativeT,
// 在中文界面下退回英文。2026-08-12 Mac 端真机 A/B(正式版 vs 本分支 local 包读 macOS 菜单栏)
// 实证:正式版「关于 DeskFox / 隐藏其他 / 全部显示 / 退出 DeskFox」,本分支 "About… / Hide Others
// / Show All / Quit…"。本测试钉住回植后的译名,防再次被上游 merge 冲掉。
import { test, expect } from "bun:test"
import { roleLabel } from "./menu-role-label"

test("zh 下纯 role 菜单项有中文译名,并带应用名", () => {
  expect(roleLabel("about", "zh", "DeskFox")).toBe("关于 DeskFox")
  expect(roleLabel("hide", "zh", "DeskFox")).toBe("隐藏 DeskFox")
  expect(roleLabel("hideOthers", "zh", "DeskFox")).toBe("隐藏其他")
  expect(roleLabel("unhide", "zh", "DeskFox")).toBe("全部显示")
  expect(roleLabel("quit", "zh", "DeskFox")).toBe("退出 DeskFox")
})

test("应用名跟随渠道(local 档 productName 带后缀)", () => {
  expect(roleLabel("quit", "zh", "DeskFox 本地版")).toBe("退出 DeskFox 本地版")
})

test("繁体单独成档", () => {
  expect(roleLabel("about", "zht", "DeskFox")).toBe("關於 DeskFox")
  expect(roleLabel("quit", "zht", "DeskFox")).toBe("結束 DeskFox")
})

test("未覆盖语言返回 undefined —— 保持纯 role,退回系统默认(不回归)", () => {
  expect(roleLabel("about", "en", "DeskFox")).toBeUndefined()
  expect(roleLabel("quit", "ja", "DeskFox")).toBeUndefined()
})

test("未覆盖的 role 也返回 undefined", () => {
  expect(roleLabel("undo", "zh", "DeskFox")).toBeUndefined()
})
