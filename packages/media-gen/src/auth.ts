// [fork-only] media-gen — 从 opencode auth.json 读厂商 API Key
// [feat: media-gen-alibaba] 2026-05-26
//
// auth.json 真实路径(Win 实测):~/.local/share/opencode/auth.json
// 注意:不是 ~/.config/opencode/(那是 jsonc 配置)。XDG_DATA_HOME 可覆盖。
// 结构:{ "<providerId>": { "type": "api", "key": "sk-..." }, ... }

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const ALIBABA_PROVIDER_ID = "alibaba-cn"

export function authJsonPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return join(dataHome, "opencode", "auth.json")
}

/**
 * 读某个 provider 的 API key。读不到 / 文件不存在 / 解析失败 → 返回 null(调用方给友好提示)。
 */
export function readProviderApiKey(providerId: string, path: string = authJsonPath()): string | null {
  if (!existsSync(path)) return null
  try {
    const auth = JSON.parse(readFileSync(path, "utf-8")) as Record<string, { type?: string; key?: string }>
    const entry = auth?.[providerId]
    if (entry && entry.type === "api" && typeof entry.key === "string" && entry.key.length > 0) {
      return entry.key
    }
    return null
  } catch {
    return null
  }
}
