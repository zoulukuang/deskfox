// FORK: DeskFox 运行期数据/配置命名空间隔离 [feat: deskfox-data-namespace-isolation] 2026-07-12
//
// 背景:上游 opencode 核心把 data(opencode.db/auth.json)与 config(opencode.jsonc)落在
//   xdg 命名空间 "opencode"(`~/.local/share/opencode`、`~/.config/opencode`)。DeskFox 沿用后,
//   与用户【另装的上游 OpenCode 桌面端/CLI】共用同一 opencode.db → 两个不同版本核心 migration
//   错位 → `no such column` 每次调模型必崩(2026-07-12 Intel 真机报障根因)。
//
// 方案(1-spec 审签 D1=a / D2=a / D3 不动飞书):desktop 主进程把 XDG_DATA_HOME/XDG_CONFIG_HOME
//   指向 DeskFox 专属根(`~/.local/share/deskfox`、`~/.config/deskfox`),core 仍 join(xdg,"opencode")
//   → 实际落 `~/.local/share/deskfox/opencode/…`,与上游物理分家。**不改上游 core `app` 常量**
//   (靠 env 注入,merge 上游零冲突)。首启【非破坏 copy】把旧 opencode 命名空间迁过来,保存量数据。
//
// 「跟紧上游、享受上游收益」不受影响:那是 code 层 merge 的事,与运行期数据目录无关。

import log from "electron-log/main.js"
import { cp, rename, rm, writeFile, mkdir } from "node:fs/promises"
import { existsSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, relative, sep } from "node:path"

// opencode core global.ts 恒在 xdg 根后追加的叶子(const app = "opencode")。不改它,故这里对齐。
const OPENCODE_LEAF = "opencode"
// 迁移完成标记(落新 data 目录),保证幂等。
const MIGRATION_MARKER = ".deskfox-namespace-migrated"
// copy 排除的顶层目录:log 可再生;bin 是按需重下的平台二进制(ripgrep 等)。
const EXCLUDE_TOP_DIRS = new Set(["log", "bin"])

export interface DeskfoxXdg {
  /** XDG_DATA_HOME(DeskFox 专属根;core 会在其后追加 "opencode") */
  dataHome: string
  /** XDG_CONFIG_HOME */
  configHome: string
}

/**
 * TC-1:按 env 派生 DeskFox 专属 XDG 根(纯函数)。
 * 若用户/测试已显式设 XDG_DATA_HOME/XDG_CONFIG_HOME → 尊重(power user / 灰度 / 测试隔离);
 * 否则用 deskfox 专属默认。此时 new==old(见 applyDeskfoxDataNamespace),迁移自然 no-op。
 */
export function resolveDeskfoxXdg(env: NodeJS.ProcessEnv, home: string): DeskfoxXdg {
  return {
    dataHome: env.XDG_DATA_HOME || join(home, ".local", "share", "deskfox"),
    configHome: env.XDG_CONFIG_HOME || join(home, ".config", "deskfox"),
  }
}

export interface MigrationPlan {
  migrate: boolean
  reason: "already-migrated" | "new-namespace-in-use" | "fresh-install-no-history" | "same-dir" | "migrate-from-opencode"
}

/**
 * TC-2:是否需要首启迁移(纯函数,不做 IO,入参为探测结果)。
 * - 已有迁移标记 → skip(幂等)
 * - 新旧同目录(用户显式设了 XDG)→ skip(no-op)
 * - 新目录已有真 db(用户已在新 ns 用)→ skip(绝不覆盖)
 * - 旧目录无 db(全新装/无历史)→ skip(直接用空的新 ns)
 * - 否则 → 迁移
 */
export function planNamespaceMigration(input: {
  sameDir: boolean
  markerExists: boolean
  newHasDb: boolean
  oldHasDb: boolean
}): MigrationPlan {
  if (input.sameDir) return { migrate: false, reason: "same-dir" }
  if (input.markerExists) return { migrate: false, reason: "already-migrated" }
  if (input.newHasDb) return { migrate: false, reason: "new-namespace-in-use" }
  if (!input.oldHasDb) return { migrate: false, reason: "fresh-install-no-history" }
  return { migrate: true, reason: "migrate-from-opencode" }
}

/** 目录里有没有"真 db"(opencode.db 或任一 opencode-*.db,>0 字节)。目录不存在 → false。 */
function hasOpencodeDb(dir: string): boolean {
  if (!existsSync(dir)) return false
  try {
    return readdirSync(dir).some((name) => {
      if (!/^opencode.*\.db$/.test(name)) return false
      try {
        return statSync(join(dir, name)).size > 0
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

/** data 目录 copy 过滤:排除顶层 log/bin、*.bak-* 备份、*.db-shm(SQLite 临时,copy db 本体+wal 足够)。 */
function makeDataCopyFilter(srcRoot: string) {
  return (src: string): boolean => {
    const rel = relative(srcRoot, src)
    if (!rel) return true // 根目录本身
    const top = rel.split(sep)[0]
    if (EXCLUDE_TOP_DIRS.has(top)) return false
    const base = basename(src)
    if (/\.bak-\d/.test(base)) return false
    if (base.endsWith(".db-shm")) return false
    return true
  }
}

export interface ApplyResult {
  /** 是否切到 deskfox 专属命名空间(设了 XDG env)。false = 保守回落旧共享 ns。 */
  switched: boolean
  reason: string
  dataHome: string
  configHome: string
}

/**
 * 主进程早期(sidecar 前)调用:resolve → plan → 非破坏 copy 迁移 → 成功才设 XDG env。
 * 失败保守回退:迁移任一步出错 → 不设 env(本次仍用旧共享 ns,数据无损,下次重试)。
 */
export async function applyDeskfoxDataNamespace(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Promise<ApplyResult> {
  const { dataHome, configHome } = resolveDeskfoxXdg(env, home)
  // 旧(隔离前)共享路径 = 原 xdg 默认 + "opencode"。读的是【未被本函数修改前】的 env。
  const oldDataRoot = env.XDG_DATA_HOME || join(home, ".local", "share")
  const oldConfigRoot = env.XDG_CONFIG_HOME || join(home, ".config")
  const oldData = join(oldDataRoot, OPENCODE_LEAF)
  const oldConfig = join(oldConfigRoot, OPENCODE_LEAF)
  const newData = join(dataHome, OPENCODE_LEAF)
  const newConfig = join(configHome, OPENCODE_LEAF)

  const sameDir = newData === oldData
  const plan = planNamespaceMigration({
    sameDir,
    markerExists: existsSync(join(newData, MIGRATION_MARKER)),
    newHasDb: hasOpencodeDb(newData),
    oldHasDb: hasOpencodeDb(oldData),
  })

  const setEnv = () => {
    env.XDG_DATA_HOME = dataHome
    env.XDG_CONFIG_HOME = configHome
  }

  if (!plan.migrate) {
    // same-dir 不切(尊重用户显式 XDG);其余(已迁/新在用/全新装)都切到 deskfox 专属 ns。
    if (plan.reason === "same-dir") {
      log.info(`[data-namespace] 用户显式 XDG,与 deskfox 同目录,不隔离(${newData})`)
      return { switched: false, reason: plan.reason, dataHome, configHome }
    }
    setEnv()
    log.info(`[data-namespace] 使用 deskfox 命名空间(${plan.reason}):${newData}`)
    return { switched: true, reason: plan.reason, dataHome, configHome }
  }

  // 需迁移:非破坏 copy 到临时目录 → 原子 rename → 写 marker。任一步失败则清理 + 保守回退。
  const dataTmp = newData + ".migrating"
  const configTmp = newConfig + ".migrating"
  try {
    log.info(`[data-namespace] 首启迁移开始(非破坏 copy):${oldData} → ${newData}`)
    await rm(dataTmp, { recursive: true, force: true })
    await rm(configTmp, { recursive: true, force: true })
    await cp(oldData, dataTmp, { recursive: true, filter: makeDataCopyFilter(oldData) })
    if (existsSync(oldConfig)) {
      await cp(oldConfig, configTmp, { recursive: true })
    }
    // 两份 copy 都成功了才落地(rename 近原子),最大限度避免半迁移。
    await mkdir(dataHome, { recursive: true })
    await mkdir(configHome, { recursive: true })
    await rm(newData, { recursive: true, force: true })
    await rename(dataTmp, newData)
    if (existsSync(configTmp)) {
      await rm(newConfig, { recursive: true, force: true })
      await rename(configTmp, newConfig)
    }
    await writeFile(
      join(newData, MIGRATION_MARKER),
      JSON.stringify({ from: oldData, at: new Date().toISOString() }, null, 2),
    )
    setEnv()
    log.info(`[data-namespace] 首启迁移完成,已切到 deskfox 命名空间:${newData}(原 ${oldData} 保留)`)
    return { switched: true, reason: "migrate-from-opencode", dataHome, configHome }
  } catch (err) {
    // 保守回退:清临时目录,不设 XDG env → 本次仍用旧共享 ns(数据无损),下次启动重试。
    await rm(dataTmp, { recursive: true, force: true }).catch(() => {})
    await rm(configTmp, { recursive: true, force: true }).catch(() => {})
    log.error(`[data-namespace] 首启迁移失败,保守回落旧共享命名空间(数据无损,下次重试):`, err)
    return { switched: false, reason: "migration-failed", dataHome, configHome }
  }
}
