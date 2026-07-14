// FORK-ONLY: REQ-083 首启新手引导单测 [feat: first-launch-onboarding]
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ONBOARDING_DIR_NAME,
  ONBOARDING_DOC_NAME,
  type OnboardingStore,
  decideOnboarding,
  firstExistingPath,
  runFirstLaunchOnboarding,
  shouldAutoOpenOnboarding,
} from "./onboarding"
import {
  FIRST_LAUNCH_DONE_KEY,
  ONBOARDING_COMPLETED_KEY,
  ONBOARDING_OPEN_ON_FIRST_LAUNCH_KEY,
} from "../store-keys"

const silentLogger = { log: () => {}, warn: () => {} }

// 假 store:Map 后端,实现 electron-store 的 get/set 最小面
function fakeStore(initial: Record<string, unknown> = {}): OnboardingStore & { dump: () => Record<string, unknown> } {
  const map = new Map<string, unknown>(Object.entries(initial))
  return {
    get: (key) => map.get(key),
    set: (key, value) => void map.set(key, value),
    dump: () => Object.fromEntries(map),
  }
}

const tmpRoots: string[] = []
function tmpRoot() {
  const root = mkdtempSync(join(tmpdir(), "onboarding-test-"))
  tmpRoots.push(root)
  return root
}
afterEach(() => {
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// 造一个临时「资源介绍文档」源
function makeResourceDoc(root: string, body = "# hello onboarding") {
  const dir = join(root, "resources", "onboarding")
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, ONBOARDING_DOC_NAME)
  writeFileSync(filePath, body, "utf-8")
  return filePath
}

describe("decideOnboarding(纯决策)", () => {
  test("TC-A1: 已完成首启 → none,不再标记", () => {
    expect(decideOnboarding({ firstLaunchDone: true, openOnFirstLaunch: true, introFileExists: false })).toEqual({
      action: "none",
      markDone: false,
    })
  })

  test("TC-A2: 首启但设置关掉 → none 但 markDone", () => {
    expect(decideOnboarding({ firstLaunchDone: false, openOnFirstLaunch: false, introFileExists: false })).toEqual({
      action: "none",
      markDone: true,
    })
  })

  test("TC-A3: 首启 + 目标已存在 → open-existing(不覆盖)", () => {
    expect(decideOnboarding({ firstLaunchDone: false, openOnFirstLaunch: true, introFileExists: true })).toEqual({
      action: "open-existing",
      markDone: true,
    })
  })

  test("TC-A4: 首启 + 不存在 → create", () => {
    expect(decideOnboarding({ firstLaunchDone: false, openOnFirstLaunch: true, introFileExists: false })).toEqual({
      action: "create",
      markDone: true,
    })
  })
})

describe("runFirstLaunchOnboarding(IO)", () => {
  test("TC-R1: 全新首启 → 建 New DeskFox + 拷介绍文档 + 标记落地", () => {
    const root = tmpRoot()
    const resourceDocPath = makeResourceDoc(root)
    const store = fakeStore()
    const result = runFirstLaunchOnboarding({
      documentsDir: join(root, "documents"),
      resourceDocPath,
      store,
      logger: silentLogger,
    })
    const expectedDir = join(root, "documents", ONBOARDING_DIR_NAME)
    const expectedFile = join(expectedDir, ONBOARDING_DOC_NAME)
    expect(result).toEqual({ directory: expectedDir, filePath: expectedFile })
    expect(existsSync(expectedFile)).toBe(true)
    expect(readFileSync(expectedFile, "utf-8")).toBe("# hello onboarding")
    expect(store.dump()[FIRST_LAUNCH_DONE_KEY]).toBe(true)
    expect(store.dump()[ONBOARDING_COMPLETED_KEY]).toBe(true)
  })

  test("TC-R2: 已完成首启 → 跳过,不建目录,不返回", () => {
    const root = tmpRoot()
    const resourceDocPath = makeResourceDoc(root)
    const store = fakeStore({ [FIRST_LAUNCH_DONE_KEY]: true })
    const result = runFirstLaunchOnboarding({
      documentsDir: join(root, "documents"),
      resourceDocPath,
      store,
      logger: silentLogger,
    })
    expect(result).toBeNull()
    expect(existsSync(join(root, "documents", ONBOARDING_DIR_NAME))).toBe(false)
  })

  test("TC-R3: 目标已存在 → 不覆盖,只返回路径 + 标记落地", () => {
    const root = tmpRoot()
    const resourceDocPath = makeResourceDoc(root, "# NEW resource body")
    const dir = join(root, "documents", ONBOARDING_DIR_NAME)
    mkdirSync(dir, { recursive: true })
    const existing = join(dir, ONBOARDING_DOC_NAME)
    writeFileSync(existing, "# user edited body", "utf-8")
    const store = fakeStore()
    const result = runFirstLaunchOnboarding({
      documentsDir: join(root, "documents"),
      resourceDocPath,
      store,
      logger: silentLogger,
    })
    expect(result).toEqual({ directory: dir, filePath: existing })
    // 不覆盖:内容仍是用户编辑过的
    expect(readFileSync(existing, "utf-8")).toBe("# user edited body")
    expect(store.dump()[FIRST_LAUNCH_DONE_KEY]).toBe(true)
  })

  test("TC-R4: 设置关掉 → 不建目录,标记落地(决策已下)", () => {
    const root = tmpRoot()
    const resourceDocPath = makeResourceDoc(root)
    const store = fakeStore({ [ONBOARDING_OPEN_ON_FIRST_LAUNCH_KEY]: false })
    const result = runFirstLaunchOnboarding({
      documentsDir: join(root, "documents"),
      resourceDocPath,
      store,
      logger: silentLogger,
    })
    expect(result).toBeNull()
    expect(existsSync(join(root, "documents", ONBOARDING_DIR_NAME))).toBe(false)
    expect(store.dump()[FIRST_LAUNCH_DONE_KEY]).toBe(true)
  })

  test("TC-R5: 拷贝失败(源不存在)→ 降级返回 null,不标记(下次可重试)", () => {
    const root = tmpRoot()
    const store = fakeStore()
    const result = runFirstLaunchOnboarding({
      documentsDir: join(root, "documents"),
      resourceDocPath: join(root, "does-not-exist.md"),
      store,
      logger: silentLogger,
    })
    expect(result).toBeNull()
    expect(store.dump()[FIRST_LAUNCH_DONE_KEY]).toBeUndefined()
  })
})

// 老用户升级不自动打开引导(2026-07-14 user 拍板)
describe("shouldAutoOpenOnboarding", () => {
  test("真新用户(fresh-install-no-history)→ 自动打开", () => {
    expect(shouldAutoOpenOnboarding("fresh-install-no-history")).toBe(true)
  })
  test("TEST_ONBOARDING 隔离(undefined,tmp 即全新装语义)→ 自动打开", () => {
    expect(shouldAutoOpenOnboarding(undefined)).toBe(true)
  })
  test("有历史数据的老用户(各迁移态)→ 不自动打开", () => {
    for (const reason of [
      "migrate-from-opencode",
      "already-migrated",
      "new-namespace-in-use",
      "same-dir",
      "migration-failed",
    ]) {
      expect(shouldAutoOpenOnboarding(reason)).toBe(false)
    }
  })
})

describe("firstExistingPath", () => {
  test("挑第一个存在的候选;都不在 → null", () => {
    const root = tmpRoot()
    const real = makeResourceDoc(root)
    expect(firstExistingPath([join(root, "nope.md"), real])).toBe(real)
    expect(firstExistingPath([join(root, "a"), join(root, "b")])).toBeNull()
  })
})
