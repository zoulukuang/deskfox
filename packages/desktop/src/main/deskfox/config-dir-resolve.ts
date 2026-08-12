// [fork-only] config 目录实操层(路径拼接 + local 首启 seed)
// [feat: local-config-isolation] 2026-08-12
//
// 纯判定在 ./config-dir.ts(已单测);本文件只做与文件系统/env 打交道的薄操作。
import { existsSync, cpSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

import { CHANNEL } from "../constants"
import { write as writeLog } from "../logging"
import { configDirName, RELEASE_CONFIG_DIR_NAME } from "./config-dir"

/** XDG_CONFIG_HOME 根(data-namespace 已将其指向 deskfox 专属根;未设则回落默认) */
function configHome(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config", "deskfox")
}

/**
 * 本渠道应使用的 opencode config 目录绝对路径。
 * 必须在 applyDeskfoxDataNamespace() 之后调用(它设 XDG_CONFIG_HOME)。
 */
export function resolveDeskfoxConfigDir(packaged: boolean): string {
  return join(configHome(), configDirName(CHANNEL, packaged))
}

/** 发布渠道的 config 目录(local seed 的来源) */
export function resolveReleaseConfigDir(): string {
  return join(configHome(), RELEASE_CONFIG_DIR_NAME)
}

/**
 * local 档首启 seed:目标目录不存在时,从发布渠道的配置**拷一份**作为起点。
 *
 * 为什么要 seed:完全空白的配置意味着 local 档启动后没有任何 provider / agent,
 * 每次做本地测试都要重连一遍供应商 —— 会显著劝退「用 local 做验证」这件事本身。
 * 拷贝之后两边各写各的、互不影响,隔离目标依然达成。
 *
 * 只在**目标不存在**时执行一次;失败不阻断启动(最坏结果是 local 配置为空,用户手动配)。
 */
export function seedLocalConfigIfMissing(packaged: boolean): { seeded: boolean; reason?: string } {
  try {
    const target = resolveDeskfoxConfigDir(packaged)
    if (target === resolveReleaseConfigDir()) return { seeded: false, reason: "same-dir" }
    if (existsSync(target)) return { seeded: false, reason: "already-exists" }

    const source = resolveReleaseConfigDir()
    if (!existsSync(source)) {
      mkdirSync(target, { recursive: true })
      return { seeded: false, reason: "no-source" }
    }

    cpSync(source, target, { recursive: true })
    writeLog("config-dir", "seeded local config from release channel", { source, target })
    return { seeded: true }
  } catch (error) {
    writeLog("config-dir", "seed local config failed (non-fatal)", { error: String(error) }, "warn")
    return { seeded: false, reason: "error" }
  }
}
