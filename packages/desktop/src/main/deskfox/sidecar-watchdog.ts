// FORK-ONLY: sidecar 看门狗自动重启(Electron 端口) [feat: sidecar-watchdog-respawn / electron-replatform] 2026-06-13
//
// 从 Tauri `src-tauri/src/server.rs` spawn_watchdog(REQ-049 Layer③)平移。
// 起因:sidecar(opencode server)因 OOM 等崩溃 / 假死后,主进程只打日志不重启 → 端口无人监听
// → 前台所有文件/AI 请求失败卡死。轮询式看门狗每 5s ping /global/health,连续 3 次失败(~15s)
// 判定死亡或假死,同 port + 同 password 重启(前台凭据不变,新实例 healthy 后请求自动恢复)。
// 同时覆盖"崩死"与"进程在但 hang"两种故障。熔断:120s 内重启超 5 次则放弃(防 restart storm)。

const POLL_INTERVAL_MS = 5_000
const FAIL_THRESHOLD = 3 // 连续 3 次失败(~15s)判定死亡
const RESTART_WINDOW_MS = 120_000
const MAX_RESTARTS = 5 // 窗口内超过则熔断
const STARTUP_GRACE_MS = 15_000 // 给首次启动留足时间,避免与启动竞速误判

/** 纯函数:窗口内重启次数是否已达上限(达上限则熔断放弃)。可单测。 */
export function overRestartBudget(restarts: number[], now: number, windowMs: number, max: number): boolean {
  return restarts.filter((t) => now - t < windowMs).length >= max
}

export type WatchdogStatus = "restarting" | "ready" | "gave-up"

export async function waitForSidecarHealth(ready: Promise<void>, timeoutMs = 30_000) {
  const timeout = Promise.withResolvers<void>()
  const timer = setTimeout(
    () => timeout.reject(new Error(`Sidecar did not become healthy within ${timeoutMs}ms`)),
    timeoutMs,
  )
  return Promise.race([ready, timeout.promise]).finally(() => clearTimeout(timer))
}

export type WatchdogDeps = {
  /** ping sidecar /global/health(带 basic auth),活=true。 */
  checkHealth: () => Promise<boolean>
  /** 主动退出/停止中 → 不重启(防 quit/relaunch 误重启)。 */
  isShuttingDown: () => boolean
  /** 杀旧 child + 同 port/pw 重启 + 更新 server 引用 + 等新实例 healthy。 */
  respawn: () => Promise<void>
  /** 状态广播(renderer 可订阅 sidecar-watchdog;当前无消费方也用于日志)。 */
  emit?: (status: WatchdogStatus) => void
  log?: (message: string, data?: Record<string, unknown>) => void
  pollIntervalMs?: number
  startupGraceMs?: number
}

/** 看门狗。start() 后等 STARTUP_GRACE 才开始轮询;stop() 清理(stopSidecars 主动停时调)。 */
export function createSidecarWatchdog(deps: WatchdogDeps) {
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  let consecutiveFailures = 0
  let restarts: number[] = []
  let recovering = false

  const schedule = (ms: number) => {
    if (stopped) return
    timer = setTimeout(() => void tick(), ms)
  }

  const tick = async () => {
    if (stopped || deps.isShuttingDown()) return

    if (await deps.checkHealth()) {
      consecutiveFailures = 0
      if (recovering) {
        recovering = false
        deps.emit?.("ready")
      }
      return schedule(deps.pollIntervalMs ?? POLL_INTERVAL_MS)
    }

    consecutiveFailures++
    deps.log?.("sidecar watchdog: health check failed", { consecutiveFailures })
    if (consecutiveFailures < FAIL_THRESHOLD) return schedule(deps.pollIntervalMs ?? POLL_INTERVAL_MS)
    if (deps.isShuttingDown()) return

    // 熔断:窗口内重启过多则放弃,避免确定性崩溃下的 restart storm
    const now = Date.now()
    restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS)
    if (overRestartBudget(restarts, now, RESTART_WINDOW_MS, MAX_RESTARTS)) {
      deps.log?.("sidecar watchdog: too many restarts in window, giving up", { restarts: restarts.length })
      deps.emit?.("gave-up")
      return // 不再调度
    }

    deps.log?.("sidecar watchdog: sidecar unresponsive, respawning")
    recovering = true
    deps.emit?.("restarting")
    restarts.push(now)
    consecutiveFailures = 0
    try {
      await deps.respawn()
      recovering = false
      deps.log?.("sidecar watchdog: respawn healthy")
      deps.emit?.("ready")
    } catch (e) {
      deps.log?.("sidecar watchdog: respawn failed", { error: e instanceof Error ? e.message : String(e) })
    }
    schedule(deps.pollIntervalMs ?? POLL_INTERVAL_MS)
  }

  return {
    start() {
      schedule(deps.startupGraceMs ?? STARTUP_GRACE_MS)
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
