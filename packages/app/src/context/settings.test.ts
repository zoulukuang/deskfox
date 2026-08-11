import { describe, expect, test } from "bun:test"
import {
  hasExistingWebState,
  initialAgentVisibility,
  isAppUpgrade,
  layoutTransitionState,
  maximumSunsetTimeout,
  newLayoutDesignsDefault,
  nextSunsetCheckDelay,
  resolveNewLayoutDesigns,
  shouldDisplayTabsToast,
  shouldEnableNewLayout,
  // FORK: 上游的强切判定改名保留(不再被调用),测试继续覆盖它以便下次 merge 能接上游改动
  // [feat: keep-legacy-layout] 2026-08-11
  upstreamShouldEnableNewLayout,
  oldInterfaceSunset,
} from "./settings"

describe("agent visibility", () => {
  test("shows the picker for existing profiles and hides it for first-time installs", () => {
    expect(initialAgentVisibility(undefined, true)).toBe(true)
    expect(initialAgentVisibility(undefined, false)).toBe(false)
  })

  test("shows the picker when updating from a recent release", () => {
    expect(initialAgentVisibility(undefined, false, "1.18.8")).toBe(true)
  })

  test("preserves the preference after initialization", () => {
    expect(initialAgentVisibility(true, true, "1.18.8")).toBeUndefined()
    expect(initialAgentVisibility(true, false)).toBeUndefined()
  })
})

describe("layout transition", () => {
  // FORK: DeskFox 不跟随 v2 换代 — 默认经典布局,且不设退役日
  // [feat: keep-legacy-layout] [bug-repro: 上游 4 条路径会把用户推到 v2] 2026-08-11
  test("FORK: 新档案默认经典布局(不跟随上游 v2)", () => {
    expect(newLayoutDesignsDefault).toBe(false)
  })

  test("FORK: 不设旧界面退役日(否则到期强制 v2 且忽略用户开关)", () => {
    expect(oldInterfaceSunset).toBeNull()
    // sunset 为 null ⇒ 过渡 UI 不出现、retired 恒 false
    expect(layoutTransitionState(false, true, false, false)).toEqual({ available: false, notice: false })
  })

  test("FORK: 版本升级不把用户强切到 v2", () => {
    expect(shouldEnableNewLayout("v1.17.19", "1.17.20")).toBe(false)
    expect(shouldEnableNewLayout("1.16.9", "2.0.0")).toBe(false)
    expect(shouldEnableNewLayout(undefined, "1.17.20")).toBe(false)
  })

  test("hides the transition until a sunset is scheduled", () => {
    expect(layoutTransitionState(false, true, false, false)).toEqual({ available: false, notice: false })
  })

  test("existing profiles can switch before sunset", () => {
    expect(layoutTransitionState(true, true, false, false)).toEqual({ available: true, notice: false })
  })

  test("classifies web profiles from existing settings or a recorded version", () => {
    expect(hasExistingWebState("{}", undefined)).toBe(true)
    expect(hasExistingWebState(null, "1.17.19")).toBe(true)
    expect(hasExistingWebState(null, undefined)).toBe(false)
  })

  test("preserves explicit and default layout preferences", () => {
    expect(resolveNewLayoutDesigns(false, false, true)).toBe(false)
    expect(resolveNewLayoutDesigns(false, undefined, false)).toBe(false)
    expect(resolveNewLayoutDesigns(false, undefined, true)).toBe(true)
  })

  test("sunset replaces the toggle with a dismissible notice", () => {
    expect(layoutTransitionState(true, true, true, false)).toEqual({ available: false, notice: true })
    expect(layoutTransitionState(true, true, true, true)).toEqual({ available: false, notice: false })
    expect(resolveNewLayoutDesigns(true, false)).toBe(true)
  })

  test("caps checks for sunsets beyond the browser timeout limit", () => {
    expect(nextSunsetCheckDelay(maximumSunsetTimeout + 1_000, 0)).toBe(maximumSunsetTimeout)
    expect(nextSunsetCheckDelay(10_000, 9_000)).toBe(1_000)
    expect(nextSunsetCheckDelay(9_000, 10_000)).toBe(0)
  })

  // 以下两条覆盖【上游原判定】(fork 已停用它,改名保留;上游若改逻辑仍能正常 merge)
  test("enables the new layout when upgrading from 1.17.19 or earlier", () => {
    expect(upstreamShouldEnableNewLayout("v1.17.19", "1.17.20")).toBe(true)
    expect(upstreamShouldEnableNewLayout("1.16.9", "2.0.0")).toBe(true)
  })

  test("enables the new layout when no previous version was recorded", () => {
    expect(upstreamShouldEnableNewLayout(undefined, "1.17.20")).toBe(true)
  })

  test("detects upgrades only when a previous version is older", () => {
    expect(isAppUpgrade("1.17.19", "1.17.20")).toBe(true)
    expect(isAppUpgrade(undefined, "1.17.20")).toBe(false)
    expect(isAppUpgrade("1.17.20", "1.17.20")).toBe(false)
    expect(isAppUpgrade("1.17.21", "1.17.20")).toBe(false)
  })

  test("shows the tabs toast for upgrades and existing installs without a recorded version", () => {
    expect(shouldDisplayTabsToast("1.17.19", "1.17.20", false)).toBe(true)
    expect(shouldDisplayTabsToast(undefined, "1.17.20", true)).toBe(true)
    expect(shouldDisplayTabsToast(undefined, "1.17.20", false)).toBe(false)
  })

  test("does not enable the new layout without a qualifying upgrade", () => {
    expect(upstreamShouldEnableNewLayout("1.17.19", "1.17.19")).toBe(false)
    expect(upstreamShouldEnableNewLayout("1.17.20", "1.17.21")).toBe(false)
    expect(upstreamShouldEnableNewLayout(undefined, "1.17.19")).toBe(false)
    expect(upstreamShouldEnableNewLayout("dev", "1.17.20")).toBe(false)
  })
})
