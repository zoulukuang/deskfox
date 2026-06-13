// FORK-ONLY: 国内 npm 镜像决策(Electron 端口) [feat: npm-registry-cn-mirror / electron-replatform] 2026-06-13
//
// 从 Tauri `src-tauri/src/npm_registry.rs` 平移。让 sidecar 装 @opencode-ai/plugin / 用户插件走
// 国内镜像(实测 12s vs ~1s),国际用户保持官方。注入点:sidecar.ts prepareSidecarEnv 的
// process.env.npm_config_registry(@npmcli/config 读 process.env)。
//
// 决策:本机时区 UTC+8 即时猜国内(零网络,首启不空等)；后台并发探活 npmjs + 镜像,
// 官方快(<2.5s)用官方,否则取最快可用镜像,全挂回落官方。14 天缓存 + 跨境自愈。

import fs from "fs"
import path from "path"

/** 验证过能取到 @opencode-ai/plugin 的国内镜像,按可靠性优先级。 */
const MIRRORS = [
  "https://registry.npmmirror.com", // 阿里,主用
  "https://mirrors.huaweicloud.com/repository/npm", // 华为云
  "https://mirrors.cloud.tencent.com/npm", // 腾讯云
  "https://repo.huaweicloud.com/repository/npm", // 华为云备用
  "https://r.cnpmjs.org", // cnpm
] as const
const NPMJS = "https://registry.npmjs.org"
const PRIMARY_MIRROR = MIRRORS[0]

const CACHE_TTL_SECS = 14 * 24 * 60 * 60 // 14 天后重探(镜像挂/跨境自愈)
const PROBE_TIMEOUT_MS = 3000
const NPMJS_FAST_MS = 2500 // npmjs 低于此 → 网络好/国际用户,直接官方

type Decision = { registry: string | null; checkedAt: number }

function nowSecs(): number {
  return Math.floor(Date.now() / 1000)
}

function cachePath(userDataPath: string): string {
  return path.join(userDataPath, "deskfox-npm-registry.json")
}

function readCache(file: string): Decision | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"))
    if (raw && typeof raw === "object" && typeof raw.checkedAt === "number") {
      const reg = raw.registry
      return { registry: typeof reg === "string" ? reg : null, checkedAt: raw.checkedAt }
    }
  } catch {
    // 缺失/坏 → null
  }
  return null
}

function writeCache(file: string, decision: Decision): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(decision, null, 2))
  } catch {
    // 写失败静默
  }
}

/** 首启即时猜测(零网络):本机时区 UTC+8 视为国内 → 主镜像;否则官方(null)。 */
export function instantGuess(): string | null {
  // getTimezoneOffset() 返回本地相对 UTC 的分钟差,UTC+8 = -480。
  return new Date().getTimezoneOffset() === -480 ? PRIMARY_MIRROR : null
}

/** 缓存是否新鲜(时钟回拨用 max(0) 兜底,不误判过期)。可单测。 */
export function isFresh(checkedAt: number, now: number): boolean {
  return Math.max(0, now - checkedAt) < CACHE_TTL_SECS
}

/** 纯决策(无网络,可单测):官方延迟低于阈值 → 官方(null);否则取延迟最小可用镜像;无 → null。 */
export function pickRegistry(npmjsMs: number | null, candidates: Array<[number, string]>): string | null {
  if (npmjsMs !== null && npmjsMs <= NPMJS_FAST_MS) return null
  const sorted = [...candidates].sort((a, b) => a[0] - b[0])
  return sorted.length > 0 ? sorted[0][1] : null
}

/** 探一个 registry:GET 包元数据(Range 头防下载全量),返回首字节延迟 ms 或 null(失败)。 */
async function probeOne(base: string): Promise<number | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const start = Date.now()
  try {
    const resp = await fetch(`${base}/@opencode-ai/plugin`, {
      headers: { Range: "bytes=0-1023" },
      signal: controller.signal,
    })
    if (resp.ok) return Date.now() - start
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 探活决策:官方快 → 官方;否则并发探所有镜像取最快;全挂 → 官方。 */
async function probeDecide(): Promise<string | null> {
  const npmjsMs = await probeOne(NPMJS)
  if (npmjsMs !== null && npmjsMs <= NPMJS_FAST_MS) return null
  const results = await Promise.all(
    MIRRORS.map(async (m): Promise<[number, string] | null> => {
      const ms = await probeOne(m)
      return ms === null ? null : [ms, m]
    }),
  )
  const candidates = results.filter((r): r is [number, string] => r !== null)
  return pickRegistry(npmjsMs, candidates)
}

/** 后台探活并写缓存(供下次启动用,本次不阻塞)。 */
function spawnRefresh(file: string): void {
  void probeDecide()
    .then((registry) => writeCache(file, { registry, checkedAt: nowSecs() }))
    .catch(() => {
      // 探活失败不写缓存,下次再试
    })
}

/** sidecar spawn 时调用:返回要注入的 npm registry(null = 用官方,不注入 env)。
 *  命中新鲜缓存直接用;否则触发后台探活 + 返回 timezone 即时猜测(零阻塞)。 */
export function decideNpmRegistry(userDataPath: string): string | null {
  const file = cachePath(userDataPath)
  const cached = readCache(file)
  if (cached && isFresh(cached.checkedAt, nowSecs())) return cached.registry
  // 缺/过期:后台刷新供下次用,本次先即时猜测
  spawnRefresh(file)
  return instantGuess()
}
