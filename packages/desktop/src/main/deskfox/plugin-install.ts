// FORK-ONLY: DeskFox 插件注入 + 自愈 [feat: electron-replatform] 2026-06-13
//
// 从 Tauri feishu_plugin_install.rs(909 行)平移到 Node。职责:
//   1. 把打包进 resources 的插件(feishu-bridge / media-gen)安装到 Electron 自管目录
//      <userData>/plugin/<name>/(对比 size 不同才覆盖 = stale 自愈;dev 跑用仓内 dist)
//   2. 把 file:// URL 注入 user ~/.config/opencode/opencode.{jsonc,json} 的 plugin 数组;
//      指向本 plugin 的其它 entry:路径已失效 → 清除;路径仍存在 → **也清除(独占接管)**。
//      ⚠️ 与 Tauri 版差异:Tauri 保留其它存在路径(单装单跑不撞);Electron 换代期与老
//      Tauri 并存,保留会双加载(双 WSS → 飞书双回複),故 Electron 注入改为独占。
//   3. 注入 imbot 安全 agent(unattended IM 桥接默认 agent,v3 极简档)— idempotent,
//      user config 已有 agent.imbot 则完全跳过。
// 解析语义与 Tauri 版一致:JSON 直接 parse,失败则 strip 注释再 parse;写回 pretty JSON
// (注释丢失 — 沿用已上线 Tauri 行为,无新增风险)。

import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "node:url"
import { app } from "electron"
import { write as writeLog } from "../logging"
// [feat: imbot-agent-schema-upgrade] REQ-094 2026-08-02 — imbot spec + 注入/升级逻辑抽到
// imbot-agent.ts(纯逻辑可单测)。原「已有 agent.imbot 完全跳过」改为按 `_schemaVersion`
// 升级:覆盖管理键(description/permission),保留用户自增键(model/prompt 等)。
import { injectImbotAgent } from "./imbot-agent"
// FORK: config 目录按渠道解析(修「写的文件 sidecar 不读」+ local 配置隔离)
// [feat: local-config-isolation] 2026-08-12
import { resolveDeskfoxConfigDir } from "./config-dir-resolve"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

const PLUGINS = ["feishu-bridge", "media-gen"] as const

/** 打包后插件资源目录;dev 跑用仓内构建产物 */
function resourcePluginDir(name: string): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "plugin", name)
  // dev:feishu-bridge 在 branding 暂存区,media-gen 在自己包(都含 dist/plugin.js)
  // moduleDir(bundle 后)= packages/desktop/out/main → 上 3 级 = packages/
  const pkgs = path.resolve(moduleDir, "../../..")
  if (name === "feishu-bridge") return path.join(pkgs, "branding", "plugin", "feishu-bridge")
  return path.join(pkgs, name)
}

/** Electron 自管安装位 */
function installedPluginDir(name: string): string {
  return path.join(app.getPath("userData"), "plugin", name)
}

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size
  } catch {
    return -1
  }
}

/** 资源 → 自管目录:dist/plugin.js + package.json;size 不同才覆盖(stale 自愈) */
function ensureInstalled(name: string): string | null {
  const src = resourcePluginDir(name)
  const srcJs = path.join(src, "dist", "plugin.js")
  if (!fs.existsSync(srcJs)) {
    writeLog("plugin-install", `resource plugin missing, skip`, { name, src }, "warn")
    return null
  }
  const dst = installedPluginDir(name)
  const dstJs = path.join(dst, "dist", "plugin.js")
  try {
    fs.mkdirSync(path.join(dst, "dist"), { recursive: true })
    if (fileSize(srcJs) !== fileSize(dstJs)) {
      fs.copyFileSync(srcJs, dstJs)
      writeLog("plugin-install", "plugin.js refreshed", { name, bytes: fileSize(dstJs) })
    }
    // package.json 统一写极简清单(不复制源码包的 — 其 exports 可能指向 src/index.ts,安装目录没有源码)
    const dstPkg = path.join(dst, "package.json")
    const manifest = JSON.stringify(
      { name: `deskfox-${name}`, version: "0.0.1", type: "module", main: "./dist/plugin.js" },
      null,
      2,
    )
    if (!fs.existsSync(dstPkg) || fs.readFileSync(dstPkg, "utf-8") !== manifest) fs.writeFileSync(dstPkg, manifest)
    return dst
  } catch (e) {
    writeLog("plugin-install", "install failed", { name, error: String(e) }, "error")
    return null
  }
}

/**
 * user opencode 配置路径(opencode.{jsonc,json};都没有则建 jsonc)。
 *
 * FORK: 目录由 config-dir 统一决定,不再硬编码 `~/.config/opencode`
 *   [feat: local-config-isolation] 2026-08-12
 *   [bug-repro: 原实现写死 ~/.config/opencode,而 sidecar 读的是 $XDG_CONFIG_HOME/opencode
 *    (data-namespace 已把 XDG_CONFIG_HOME 指向 ~/.config/deskfox)—— 两者不是同一个文件,
 *    2026-08-12 实测两份内容已经不同。本函数写的那份**没人读**,
 *    「独占接管 + 自愈」机制因此长期失效,只是因为 deskfox 那份是首启迁移的快照、恰好正确才没爆发。]
 *   顺带完成 local 档配置隔离:local 走 opencode-local 目录,与发布渠道分家。
 */
function userConfigPath(): string {
  const dir = resolveDeskfoxConfigDir(app.isPackaged)
  const jsonc = path.join(dir, "opencode.jsonc")
  if (fs.existsSync(jsonc)) return jsonc
  const json = path.join(dir, "opencode.json")
  if (fs.existsSync(json)) return json
  fs.mkdirSync(dir, { recursive: true })
  return jsonc
}

/** 路径 → file:// URL(forward slash,Windows 盘符前补 /) */
function toFileUrl(p: string): string {
  const fwd = p.replaceAll("\\", "/")
  return fwd.startsWith("/") ? `file://${fwd}` : `file:///${fwd}`
}

// 与 Tauri strip_comments 同语义:剥行注释与块注释(字符串内不动)
function stripComments(input: string): string {
  let out = ""
  let i = 0
  let inStr = false
  let esc = false
  while (i < input.length) {
    const c = input[i]
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
      i++
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      i++
      continue
    }
    if (c === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++
      continue
    }
    if (c === "/" && input[i + 1] === "*") {
      i += 2
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

function readConfig(configPath: string): Record<string, unknown> {
  if (!fs.existsSync(configPath)) return {}
  const raw = fs.readFileSync(configPath, "utf-8")
  try {
    return JSON.parse(raw)
  } catch {
    return JSON.parse(stripComments(raw))
  }
}

/** entry 是否指向某 plugin(按 "plugin/<name>" 末两段匹配,与 Tauri plugin_dir_match_key 同) */
function entryMatchesPlugin(entry: string, name: string): boolean {
  const norm = entry.replaceAll("\\", "/")
  return norm.includes(`plugin/${name}`) || norm.includes(`/${name}/dist`) || norm.endsWith(`/${name}`)
}

/** 注入 plugin URL,独占接管(清掉本 plugin 其它 entry,无论路径死活 — 见文件头差异说明) */
function injectPlugin(config: Record<string, unknown>, name: string, pluginUrl: string): boolean {
  const arr: unknown[] = Array.isArray(config.plugin) ? (config.plugin as unknown[]) : []
  const kept = arr.filter((e) => {
    if (typeof e !== "string") return true
    if (e === pluginUrl) return false // 已存在也移除,统一重 push(幂等)
    if (entryMatchesPlugin(e, name)) {
      writeLog("plugin-install", "removing other entry (exclusive takeover)", { name, entry: e })
      return false
    }
    return true
  })
  kept.push(pluginUrl)
  const changed = JSON.stringify(kept) !== JSON.stringify(arr)
  config.plugin = kept
  return changed
}


/** 主入口 — app.whenReady 后调用一次 */
export function ensureDeskfoxPlugins(): void {
  try {
    const configPath = userConfigPath()
    const config = readConfig(configPath)
    let changed = false
    for (const name of PLUGINS) {
      const dir = ensureInstalled(name)
      if (!dir) continue
      if (injectPlugin(config, name, toFileUrl(dir))) changed = true
    }
    if (injectImbotAgent(config)) changed = true
    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")
      writeLog("plugin-install", "config updated", { configPath })
    } else {
      writeLog("plugin-install", "config already up-to-date", { configPath })
    }
  } catch (e) {
    writeLog("plugin-install", "ensureDeskfoxPlugins failed", { error: String(e) }, "error")
  }
}
