// FORK-ONLY: REQ-083 首启新手引导(v4 简化版)[feat: first-launch-onboarding] 2026-07-13
//
// 首次启动时:在系统 Documents 下建 `New DeskFox/`,放一份介绍文档
// `关于 DeskFox 你该知道的几件事.md`(base64 二维码内嵌,单文件),并返回目录/文件路径
// 供 index.ts 发 deep link 让 renderer 自动打开为工作区 + 介绍文档作首个 tab。
//
// 设计:决策逻辑(decideOnboarding)是纯函数、可单测;runFirstLaunchOnboarding 是 IO 壳,
// 写失败/权限错**不抛**(降级不阻塞启动),只 log。marker(firstLaunchDone)gate 三件事:
//   ① 重启不重复触发 ② 删除 New DeskFox 后重启不重建 ③ 已存在不覆盖。

import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import {
  FIRST_LAUNCH_DONE_KEY,
  ONBOARDING_COMPLETED_KEY,
  ONBOARDING_OPEN_ON_FIRST_LAUNCH_KEY,
} from "../store-keys"

export const ONBOARDING_DIR_NAME = "New DeskFox"
export const ONBOARDING_DOC_NAME = "关于 DeskFox 你该知道的几件事.md"

/**
 * 老用户升级不自动打开引导(2026-07-14 user 拍板):存量用户升级到本版后 firstLaunchDone 不存在,
 * 会被首启引导跳转打断"恢复上次项目"的习惯。用 data-namespace 迁移结果的 reason 区分:
 * - 无历史数据(fresh-install-no-history)→ 真新用户 → 自动打开引导
 * - undefined(TEST_ONBOARDING 隔离测试跳过了 data-namespace,tmp 目录即全新装语义)→ 自动打开
 * - 其它(migrate-from-opencode / already-migrated / new-namespace-in-use / same-dir /
 *   migration-failed)→ 有历史数据的老用户 → 只建 New DeskFox + 介绍文档,不自动打开
 */
export function shouldAutoOpenOnboarding(namespaceReason: string | undefined): boolean {
  if (namespaceReason === undefined) return true
  return namespaceReason === "fresh-install-no-history"
}

/** 从候选列表里挑第一个真实存在的路径(packaged/dev 资源定位用);都不在 → null */
export function firstExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {}
  }
  return null
}

export type OnboardingAction = "create" | "open-existing" | "none"

export interface OnboardingDecision {
  /** create:拷文件再打开 / open-existing:已存在只打开不覆盖 / none:不做事 */
  action: OnboardingAction
  /** 是否持久化 firstLaunchDone 标记 */
  markDone: boolean
}

/**
 * 纯决策函数(可单测):给定 marker / 设置 / 目标文件是否已存在 → 该做什么。
 * - 已完成首启 → none(不重复触发,删目录也不重建:标记 gate)
 * - 首启但设置关掉 → none 但 markDone(决策已下,不再问)
 * - 首启且目标文件已存在 → open-existing(不覆盖,只打开)
 * - 首启且不存在 → create
 */
export function decideOnboarding(input: {
  firstLaunchDone: boolean
  openOnFirstLaunch: boolean
  introFileExists: boolean
}): OnboardingDecision {
  if (input.firstLaunchDone) return { action: "none", markDone: false }
  if (!input.openOnFirstLaunch) return { action: "none", markDone: true }
  if (input.introFileExists) return { action: "open-existing", markDone: true }
  return { action: "create", markDone: true }
}

/** 供 index.ts 拿去发 deep link 的目标路径;null = 本次不自动打开 */
export interface OnboardingResult {
  directory: string
  filePath: string
}

/** electron-store 最小接口(便于单测注入假 store) */
export interface OnboardingStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export interface OnboardingLogger {
  log: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
}

export interface RunOnboardingDeps {
  /** 系统 Documents 目录(app.getPath("documents")) */
  documentsDir: string
  /** 介绍文档源(app resources 内的绝对路径) */
  resourceDocPath: string
  store: OnboardingStore
  logger: OnboardingLogger
}

/**
 * 首启检测 + New DeskFox 初始化。返回目标路径供自动打开;不该打开 / 失败降级 → null。
 * 任何 IO 异常都吞掉(只 log),绝不阻塞启动。
 */
export function runFirstLaunchOnboarding(deps: RunOnboardingDeps): OnboardingResult | null {
  const { documentsDir, resourceDocPath, store, logger } = deps

  const directory = join(documentsDir, ONBOARDING_DIR_NAME)
  const filePath = join(directory, ONBOARDING_DOC_NAME)

  const firstLaunchDone = store.get(FIRST_LAUNCH_DONE_KEY) === true
  // 设置默认 true(未设 = 开)
  const rawSetting = store.get(ONBOARDING_OPEN_ON_FIRST_LAUNCH_KEY)
  const openOnFirstLaunch = rawSetting === undefined ? true : rawSetting !== false

  let introFileExists = false
  try {
    introFileExists = existsSync(filePath)
  } catch {
    introFileExists = false
  }

  const decision = decideOnboarding({ firstLaunchDone, openOnFirstLaunch, introFileExists })

  const markDone = () => {
    try {
      store.set(FIRST_LAUNCH_DONE_KEY, true)
    } catch (error) {
      logger.warn("[onboarding] failed to persist firstLaunchDone", error)
    }
  }

  if (decision.action === "none") {
    if (decision.markDone) markDone()
    logger.log("[onboarding] skip", { firstLaunchDone, openOnFirstLaunch })
    return null
  }

  if (decision.action === "open-existing") {
    if (decision.markDone) markDone()
    logger.log("[onboarding] intro doc already exists, open without overwrite", { directory })
    return { directory, filePath }
  }

  // action === "create":拷贝介绍文档;写失败 → 降级(不 mark,下次启动可重试),不阻塞
  try {
    mkdirSync(directory, { recursive: true })
    copyFileSync(resourceDocPath, filePath)
    try {
      store.set(ONBOARDING_COMPLETED_KEY, true)
    } catch {}
    markDone()
    logger.log("[onboarding] created New DeskFox workspace", { directory })
    return { directory, filePath }
  } catch (error) {
    logger.warn("[onboarding] failed to create New DeskFox workspace (degraded, non-blocking)", error)
    return null
  }
}
