import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app } from "electron"

import { Deferred, Effect, Fiber } from "effect"
// FORK: native-menu-i18n — contextMenu 收口到 deskfox/context-menu(按语言重挂)[feat: native-menu-i18n]
import { applyContextMenuLanguage } from "./deskfox/context-menu"

import type { ServerReadyData } from "../preload/types"
import { checkAppExists, resolveAppPath } from "./apps"
// FORK: REQ-068 路径存在性探测 [feat: stale-path-hardening]
import { probePath, findRelocatedProject } from "./fs-probe"
import { CHANNEL, PRODUCT_NAMES } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
// FORK: DeskFox 原生 IPC [feat: electron-replatform]
import { registerDeskfoxIpc } from "./deskfox/ipc"
// FORK: 匿名使用统计(从 Tauri telemetry.rs 平移)[feat: telemetry-usage-stats] 2026-06-13
import { initTelemetry, emitAppOpen } from "./deskfox/telemetry"
import { createTray, attachCloseToTray, setQuitting, isQuitting, showMainWindow, setTrayStatus } from "./deskfox/tray"
import { ensureDeskfoxPlugins } from "./deskfox/plugin-install"
// FORK: 运行期数据/配置命名空间隔离(与上游 opencode 分家,防共用 opencode.db schema 冲突)
//   [feat: deskfox-data-namespace-isolation] 2026-07-12
import { applyDeskfoxDataNamespace } from "./deskfox/data-namespace"
import { restorePreventSleep } from "./deskfox/prevent-sleep"
import { forwardInitializationFailure } from "./initialization"
import { exportDebugLogs, initCrashReporter, initLogging, startNetLog, write as writeLog } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import {
  finishFirstLaunchOnboarding,
  initializeOldLayoutEligibility,
  isFirstLaunchOnboardingPending,
  isOldLayoutEligible,
} from "./onboarding"
import {
  getDefaultServerUrl,
  preferAppEnv,
  setDefaultServerUrl,
  spawnLocalServer,
  checkHealth,
  type SidecarListener,
} from "./server"
// FORK: sidecar 看门狗自动重启(从 Tauri server.rs spawn_watchdog 平移)[feat: sidecar-watchdog-respawn] 2026-06-13
import { createSidecarWatchdog } from "./deskfox/sidecar-watchdog"
// FORK: REQ-087 renderer 连环崩自愈 [feat: renderer-snapshot-oom] 2026-08-02
import { handleRendererGone } from "./deskfox/renderer-crash-guard"
import { setupAutoUpdater, showUpdaterDialog } from "./updater"
import { safeWebContentsURL } from "./window-state"
import {
  getLastFocusedWindow,
  registerRendererProtocol,
  setRelaunchHandler,
  setAppQuitting,
  setBackgroundColor,
  setDockIcon,
  restoreMainWindows,
} from "./windows"
import { createWslServersController } from "./wsl/servers"
import { registerWslIpcHandlers } from "./wsl/ipc"
import { spawnWslSidecar } from "./wsl/sidecar"
import { migrate } from "./migrate"
// FORK: REQ-083 首启新手引导 [feat: first-launch-onboarding]
import {
  ONBOARDING_DOC_NAME,
  firstExistingPath,
  runFirstLaunchOnboarding,
  shouldAutoOpenOnboarding,
} from "./deskfox/onboarding"
import { getStore } from "./store"
import { cleanupStoreFiles } from "./store-cleanup"

// FORK-BEGIN: DeskFox 应用身份 — 继承 Tauri 版三档 identifier(ai.deskfox.app,治理规则 R3/应用身份-命名规则)
//   userData 与旧 Tauri 版同目录(Roaming/<id>):前端偏好迁移同目录原地完成,Win 任务栏固定/通知
//   身份(AppUserModelId)延续,升级无感。[feat: electron-replatform] 2026-06-13
// FORK: app 名复用 constants 的 PRODUCT_NAMES 单一事实源(原本地 APP_NAMES 与之重复)[feat: electron-brand-cleanup]
// FORK: 多窗口化后保留 mainWindow 兼容指针(首窗;托盘/看门狗/onboarding 旧调用点用)2026-08-11
let mainWindow: import("electron").BrowserWindow | null = null
const APP_NAMES = PRODUCT_NAMES
const APP_IDS: Record<string, string> = {
  local: "ai.deskfox.app.local",
  dev: "ai.deskfox.app.dev",
  beta: "ai.deskfox.app.beta",
  prod: "ai.deskfox.app",
}
// FORK-END
const TEST_ONBOARDING = process.env.OPENCODE_TEST_ONBOARDING === "1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"
// FORK: REQ-083 编译后 main 目录(定位介绍文档资源,dev/packaged 分支)[feat: first-launch-onboarding]
const MAIN_DIR = dirname(fileURLToPath(import.meta.url))

let logger: ReturnType<typeof initLogging>
let server: SidecarListener | null = null
// FORK: sidecar 看门狗句柄(stopSidecars 主动停时先 stop,防误重启)[feat: sidecar-watchdog-respawn]
let sidecarWatchdog: { start: () => void; stop: () => void } | null = null

const pendingDeepLinks: string[] = []

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  const win = getLastFocusedWindow()
  if (win) sendDeepLinks(win, urls)
}

async function killSidecar() {
  if (!server) return
  const current = server
  server = null
  await current.stop()
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  // FORK: native-menu-i18n — 原生右键菜单标签跟随 app 语言(首挂 OS locale 兜底,renderer
  // 语言就绪后经 IPC 重挂)[feat: native-menu-i18n]
  applyContextMenuLanguage()

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  // FORK: 未打包跑 = 本地测试版身份(ai.deskfox.app.local,与发布渠道隔离,不抢预览版单实例锁)。
  // [feat: local-channel] 2026-06-17(原先未打包冒用 .dev 预览版身份,语义混淆 + 抢锁,已纠正)
  const appId = app.isPackaged ? APP_IDS[CHANNEL] : APP_IDS.local
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.OPENCODE_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : APP_NAMES.local) // FORK: DeskFox 品牌(未打包=本地版)[feat: electron-replatform / local-channel]
  app.setAppUserModelId(appId)
  // FORK: 统计客户端注入 version + bundle identifier(按 channel 选 Plausible site)[feat: telemetry-usage-stats]
  initTelemetry({ version: app.getVersion(), identifier: appId })
  app.setPath(
    "userData",
    onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId),
  )
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  initializeOldLayoutEligibility(app.getPath("userData"))
  logger = initLogging()
  initCrashReporter()

  const wslServers = createWslServersController(
    app.getVersion(),
    async (distro) => {
      logger.log("spawning wsl sidecar", { distro })
      return spawnWslSidecar(distro, {
        onLine: (line) => logger.log("wsl sidecar", { distro, stream: line.stream, text: line.text }),
      })
    },
    {
      logger: {
        log: (message, meta) => logger.log(message, meta),
        error: (message, meta) => logger.error(message, meta),
      },
    },
  )
  const stopSidecars = async () => {
    // FORK: 先停看门狗,避免主动停 sidecar 被误判死亡触发重启 [feat: sidecar-watchdog-respawn]
    sidecarWatchdog?.stop()
    sidecarWatchdog = null
    await killSidecar()
    wslServers.stopAll()
  }
  const relaunch = () => {
    setAppQuitting()
    void stopSidecars().finally(() => {
      app.relaunch()
      app.exit(0)
    })
  }

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  preferAppEnv(app.getPath("userData"))

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("opencode://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  // FORK: macOS Dock 图标点击(app 已运行、主窗口 hide 到托盘)→ 重现主窗口。
  //   平移 Tauri RunEvent::Reopen 漏网路径(macos-dock-reopen-show-window):关窗后点 Dock,
  //   Electron 发 "activate"(macOS 专有,Win 不触发,无需平台 gate),复用 showMainWindow
  //   同一恢复入口(restore→show→focus),与托盘左键 / second-instance 行为一致。
  //   [feat: electron-replatform-macos]
  app.on("activate", () => {
    showMainWindow()
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    // FORK: 真退出意图 — 让关闭到托盘的 close 拦截放行(Cmd+Q / 菜单退出 / app.quit)[feat: electron-replatform]
    setQuitting()
    setAppQuitting()
    void stopSidecars()
  })

  // FORK: 关闭到托盘 backstop — 订阅 window-all-closed 即覆盖"非 mac 默认 quit";
  //   仅退出意图时才真 quit,否则主进程常驻(飞书/边车不退)[feat: electron-replatform]
  app.on("window-all-closed", () => {
    writeLog("window", "[deskfox-tray] window-all-closed", { isQuitting: isQuitting() })
    if (isQuitting()) app.quit()
  })

  app.on("will-quit", () => {
    setAppQuitting()
    void stopSidecars()
  })

  app.on("child-process-gone", (_event, details) => {
    writeLog("utility", "child process gone", { details }, "error")
  })

  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: safeWebContentsURL(webContents), details }, "error")
    // FORK: REQ-087 连环崩自愈 — 崩溃循环时隔离快照 .dat 再 reload,打破「一开就崩」
    //   [feat: renderer-snapshot-oom] 2026-08-02
    void handleRendererGone(webContents, details.reason, (message, data) => writeLog("window", message, data, "error"))
  })

  setRelaunchHandler(() => {
    relaunch()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      setAppQuitting()
      void stopSidecars().finally(() => app.exit(0))
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData, unknown>()

  yield* Effect.promise(() => app.whenReady())

  if (!TEST_ONBOARDING) migrate()
  // FORK: 隔离 DeskFox 运行期数据/配置命名空间(设 XDG_DATA/CONFIG_HOME 指向 deskfox 专属根 + 首启
  //   非破坏迁移),必须在 sidecar 起之前(sidecar 继承 process.env)。TEST_ONBOARDING 已自设 tmp XDG,跳过。
  //   [feat: deskfox-data-namespace-isolation] 2026-07-12
  // FORK: 接住迁移结果 — reason 供下方 onboarding 判定"老用户不自动打开引导" [feat: first-launch-onboarding]
  const namespaceResult = TEST_ONBOARDING
    ? undefined
    : yield* Effect.promise(() => applyDeskfoxDataNamespace())

  yield* Effect.promise(() => cleanupStoreFiles(app.getPath("userData"))).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.deleted.length === 0) return
        logger.log("cleaned scoped store files", { count: result.deleted.length, scanned: result.scanned })
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to clean scoped store files", error)
      }),
    ),
  )
  app.setAsDefaultProtocolClient("opencode")
  registerRendererProtocol()
  setDockIcon()
  const updater = setupAutoUpdater(stopSidecars)
  // FORK: DeskFox 原生 IPC(文件操作等) [feat: electron-replatform]
  registerDeskfoxIpc()
  // FORK: 防休眠 — 启动恢复上次开关状态(开着则立即重新生效 + 同步托盘勾选)[feat: electron-replatform-macos]
  restorePreventSleep()
  // FORK: 启动即发 app_open(pageview 注册当日活跃);opt-out/白名单/IO 全在后台,不阻塞 [feat: telemetry-usage-stats]
  emitAppOpen()
  // FORK: 插件注入 + 自愈(必须在 sidecar 启动前,sidecar 读 opencode.jsonc)[feat: electron-replatform]
  ensureDeskfoxPlugins()
  registerIpcHandlers({
    killSidecar: () => killSidecar(),
    relaunch,
    awaitInitialization: Effect.fnUntraced(
      function* () {
        logger.log("awaiting server ready")
        const res = yield* Deferred.await(serverReady)
        logger.log("server ready", { url: res.url })
        return res
      },
      (e) => Effect.runPromise(e),
    ),
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    isFirstLaunchOnboardingPending,
    finishFirstLaunchOnboarding,
    isOldLayoutEligible,
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    parseMarkdown: async (markdown) => parseMarkdown(markdown),
    checkAppExists: (appName) => checkAppExists(appName),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    // FORK: REQ-068 启动前探测默认项目目录是否存在/可达 [feat: stale-path-hardening]
    pathExists: (target) => probePath(target),
    // FORK: REQ-072 改名后扫兄弟目录 .deskfox/id 找项目新位置 [feat: project-continuity-v2026-8-4]
    findRelocatedProject: (missingDir, id) => findRelocatedProject(missingDir, id),
    updater,
    showUpdater: () => showUpdaterDialog(updater, true),
    setBackgroundColor: (color) => setBackgroundColor(color),
    exportDebugLogs: () => exportDebugLogs(),
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
  })
  registerWslIpcHandlers(wslServers)
  void updater.start()
  const updateTimer = setInterval(() => void updater.check(), 10 * 60 * 1000)
  updateTimer.unref()
  app.once("will-quit", () => clearInterval(updateTimer))
  yield* Effect.promise(() => startNetLog()).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to start net log", error)
      }),
    ),
  )

  const port = yield* Effect.gen(function* () {
    const fromEnv = process.env.OPENCODE_PORT
    if (fromEnv) {
      const parsed = Number.parseInt(fromEnv, 10)
      if (!Number.isNaN(parsed)) return parsed
    }

    const res = yield* Deferred.make<number, unknown>()
    const server = createServer()
    server.on("error", (e) => Deferred.failSync(res, () => e))
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        Deferred.failSync(res, () => new Error("Failed to get port"))
        return
      }
      const port = address.port
      server.close(() => Effect.runSync(Deferred.succeed(res, port)))
    })

    return yield* Deferred.await(res)
  })
  const hostname = "127.0.0.1"
  const url = `http://${hostname}:${port}`
  const password = randomUUID()

  const loadingTask = yield* Effect.gen(function* () {
    logger.log("sidecar connection started", { url })

    ensureLoopbackNoProxy()
    useEnvProxy()

    logger.log("spawning sidecar", { url })
    // FORK-BEGIN: REQ-049 首次 spawn 与 respawn 共用 options(补 onMemoryPressure 转发 renderer)
    //   [feat: sidecar-oom-brake] 2026-08-02
    const spawnOptions = {
      userDataPath: app.getPath("userData"),
      onStdout: (message: string) => writeLog("server", "stdout", { message }),
      onStderr: (message: string) => writeLog("server", "stderr", { message }, "warn"),
      onExit: (code: number) => writeLog("utility", "sidecar exited", { code }, "warn"),
      onMemoryPressure: (info: { usedMB: number; limitMB: number; ratio: number }) => {
        writeLog("utility", "sidecar memory pressure", { ...info }, "warn")
        mainWindow?.webContents.send("deskfox:sidecar-watchdog", { status: "memory-pressure", ...info })
      },
    }
    const { listener, health } = yield* Effect.promise(() => spawnLocalServer(hostname, port, password, spawnOptions))
    server = listener
    // FORK-END
    // FORK: 启动 sidecar 看门狗 — 崩溃/假死时同 port+pw 自动重启,前台请求自动恢复
    //   [feat: sidecar-watchdog-respawn] 2026-06-13
    const respawnSidecar = async () => {
      if (server) {
        const old = server
        server = null
        await old.stop().catch(() => undefined)
      }
      await new Promise((resolve) => setTimeout(resolve, 500)) // 等端口释放
      const next = await spawnLocalServer(hostname, port, password, spawnOptions)
      server = next.listener
      // 等新实例 healthy(最多 30s);失败不放弃,下一轮 poll 受熔断保护会再判定
      await Promise.race([next.health.wait, new Promise((resolve) => setTimeout(resolve, 30_000))])
    }
    sidecarWatchdog?.stop()
    sidecarWatchdog = createSidecarWatchdog({
      checkHealth: () => checkHealth(url, password),
      isShuttingDown: () => isQuitting(),
      respawn: respawnSidecar,
      // FORK: REQ-049 修通道 — preload 桥订阅的是 "deskfox:" 前缀通道,原裸通道 renderer 收不到;
      //   payload 统一为 { status } 对象与 memory-pressure 同形 [feat: sidecar-oom-brake] 2026-08-02
      // FORK: REQ-099 托盘同步反映健康状态 —— 托盘就在主进程,同一回调直接调即可,
      //   不新增 IPC / 不经 renderer(窗口已隐藏或已销毁时 renderer 收不到,托盘仍要更新)
      //   [feat: tray-health-status] 2026-08-07
      emit: (status) => {
        mainWindow?.webContents.send("deskfox:sidecar-watchdog", { status })
        setTrayStatus(status)
      },
      log: (message, data) => writeLog("utility", message, data ?? {}, "warn"),
    })
    sidecarWatchdog.start()
    yield* Deferred.succeed(serverReady, {
      url,
      username: "opencode",
      password,
    })

    if (process.platform === "win32") {
      void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
    }

    yield* Effect.promise(() => health.wait).pipe(
      Effect.timeout("30 seconds"),
      Effect.catch((e) =>
        Effect.sync(() => {
          logger.error("sidecar health check failed", e.toString())
        }),
      ),
    )

    logger.log("loading task finished")
  }).pipe(forwardInitializationFailure(serverReady), Effect.forkChild)

  yield* Fiber.await(loadingTask)

  const windows = restoreMainWindows()
  // FORK: 系统托盘 + 关闭到托盘(关 GUI ≠ 退主进程,飞书/边车常驻)。多窗口化后托盘全局一份,
  //   close-to-tray 逐窗挂接;mainWindow 兼容指针取首窗(onboarding/updater 等旧调用点用)2026-08-11
  mainWindow = windows[0] ?? null
  createTray()
  for (const win of windows) attachCloseToTray(win)
  if (windows.length) {
    createMenu({
      trigger: (id) => {
        const win = getLastFocusedWindow()
        if (win) sendMenuCommand(win, id)
      },
      checkForUpdates: () => {
        void showUpdaterDialog(updater, true)
      },
      relaunch: () => {
        relaunch()
      },
    })
  }

  // FORK: REQ-083 首启新手引导 — 首启建 Documents/New DeskFox/ + 介绍文档,发 deep link
  //   让 renderer 自动打开为工作区 + 介绍文档作首个 tab。写失败降级不阻塞。
  //   [feat: first-launch-onboarding]
  try {
    const documentsDir = onboardingTestRoot ? join(onboardingTestRoot, "documents") : app.getPath("documents")
    const docCandidates = app.isPackaged
      ? [join(process.resourcesPath, "onboarding", ONBOARDING_DOC_NAME)]
      : [
          join(MAIN_DIR, "../../resources/onboarding", ONBOARDING_DOC_NAME),
          join(MAIN_DIR, "../../../branding/src/assets/onboarding", ONBOARDING_DOC_NAME),
        ]
    const resourceDocPath = firstExistingPath(docCandidates)
    if (!resourceDocPath) {
      logger.warn("onboarding intro doc resource not found, skip", { docCandidates })
    } else {
      const result = runFirstLaunchOnboarding({
        documentsDir,
        resourceDocPath,
        store: getStore(),
        logger: {
          log: (message, meta) => logger.log(message, meta),
          warn: (message, meta) => logger.warn(message, meta),
        },
      })
      if (result) {
        // FORK: 老用户(有历史数据,data-namespace reason 非 fresh)只建 New DeskFox + 介绍文档、
        //   不自动打开 —— 别打断他"恢复上次项目"的习惯;真新用户才发 deep link 自动打开。
        //   2026-07-14 user 拍板 [feat: first-launch-onboarding]
        if (shouldAutoOpenOnboarding(namespaceResult?.reason)) {
          const url = `opencode://open-project?directory=${encodeURIComponent(
            result.directory,
          )}&file=${encodeURIComponent(ONBOARDING_DOC_NAME)}`
          logger.log("onboarding emitting auto-open deep link", { url })
          emitDeepLinks([url])
        } else {
          logger.log("onboarding created without auto-open (existing user)", {
            directory: result.directory,
            namespaceReason: namespaceResult?.reason,
          })
        }
      }
    }
  } catch (error) {
    logger.warn("onboarding failed (non-blocking)", error)
  }
})

Effect.runFork(main)
