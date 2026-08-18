// [fork-only] REQ-084① 隔离通知暂存单测 [feat: voice-preclear-batch] 2026-08-18
import { beforeEach, describe, expect, test } from "bun:test"
import {
  __resetDbQuarantineNotice,
  setDbQuarantineNotice,
  takeDbQuarantineNotice,
} from "./db-quarantine-notice"
import { shouldAutoOpenOnboarding } from "./onboarding"

beforeEach(() => __resetDbQuarantineNotice())

describe("db-quarantine-notice 暂存", () => {
  test("没有通知 → take 返回 null", () => {
    expect(takeDbQuarantineNotice()).toBeNull()
  })

  test("一次性:取走后即清空,不重复弹", () => {
    setDbQuarantineNotice({ kind: "startup", dbNames: ["opencode.db"], dir: "/d" })
    expect(takeDbQuarantineNotice()).toEqual({ kind: "startup", dbNames: ["opencode.db"], dir: "/d" })
    expect(takeDbQuarantineNotice()).toBeNull()
  })

  test("startup 优先级高于 migrate:已实际挪档的通知不被覆盖", () => {
    setDbQuarantineNotice({ kind: "startup", dbNames: ["opencode.db"] })
    setDbQuarantineNotice({ kind: "migrate", dbNames: ["other.db"] })
    expect(takeDbQuarantineNotice()?.kind).toBe("startup")
  })

  test("migrate 可被 startup 覆盖(后者是更确定的处置结果)", () => {
    setDbQuarantineNotice({ kind: "migrate", dbNames: ["a.db"] })
    setDbQuarantineNotice({ kind: "startup", dbNames: ["b.db"] })
    expect(takeDbQuarantineNotice()?.dbNames).toEqual(["b.db"])
  })
})

describe("回归:新增的 db-quarantined reason 不改变 onboarding 行为", () => {
  test("db-quarantined 归为老用户 → 不自动打开引导(与 migrate-from-opencode 一致)", () => {
    // 该场景下用户本来就有历史数据,只是 db 没迁 —— 不该被当成新用户弹引导。
    expect(shouldAutoOpenOnboarding("db-quarantined")).toBe(false)
    expect(shouldAutoOpenOnboarding("migrate-from-opencode")).toBe(false)
  })
  test("只有真全新装才自动打开", () => {
    expect(shouldAutoOpenOnboarding("fresh-install-no-history")).toBe(true)
  })
})
