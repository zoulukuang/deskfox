#!/usr/bin/env bun

// [fork-only] DeskFox verify 链编排器 — 一条命令、一个判定、按改动自动选层
// [feat: deskfox-verify-chain] 2026-06-15
//
// 把现成零件串成一条 verify 链,让"改完→自动验证→只推没过项"取代"逐条人看":
//   L0 静态  : bun run typecheck (turbo) + bun run lint (oxlint)
//   L1 冷启动: 杀全部进程→真冷启 dev→cold-start.py 监控 ~22s(--cold);抓暖态测不到的 sidecar 预热竞态
//   L2 交互  : 连 DeskFox dev 的 CDP 9222,跑 smoke.py 相关 probe(boot/providers/panels/settings/files)
//   L3 发布物: 校验 dist-deskfox 安装包产物(--release / --build);electron-updater 口径,见下
//
// CDP 暴露:dev 模式自动开 9222(src/main/index.ts:201 `if (!app.isPackaged) appendSwitch`),
// 本脚本探活;没起就后台拉 `bun run dev:desktop` 等就绪,跑完只杀自己拉起的那个。
//
// 用法:
//   bun run packages/branding/smoke/verify.ts                 # 全量(L0 + L2 全 probe)
//   bun run packages/branding/smoke/verify.ts --changed       # 按 git 改动自动选 probe(日常推荐)
//   bun run packages/branding/smoke/verify.ts --scope viewer  # ui | provider | viewer | all
//   bun run packages/branding/smoke/verify.ts --only files    # 显式指定 probe(逗号分隔)
//   bun run packages/branding/smoke/verify.ts --no-static     # 跳过 L0(只想快验交互面时)
//   bun run packages/branding/smoke/verify.ts --no-launch     # 不自动拉 dev,要求 9222 已在
//   bun run packages/branding/smoke/verify.ts --cold          # L1:杀全部进程→真冷启→冷启动健康监控(改启动链/主进程/插件注入时)
//   bun run packages/branding/smoke/verify.ts --release [--env dev|beta|prod]   # L3:校验已构建的 dist-deskfox 产物
//   bun run packages/branding/smoke/verify.ts --build   [--env dev]             # L3:先 build-deskfox-electron 再校验
//
// 退出码(给 agent / CI / ship 当闸):
//   0 = 🟢 全过(L0/L2:无 crash 无 fail;L3:产物全过)   → 可说"完成"
//   2 = 🟡 L2 有 fail(软警告:空白/报错/弹窗没开)       → 推给人看(L3 无此档,产物完整性是硬判定)
//   1 = 🔴 L0 不过 / L2 crash / L3 任一不过               → 挡住,不许说"完成"

import { parseArgs } from "node:util"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { $ } from "bun"

const HERE = import.meta.dir // packages/branding/smoke
const REPO = join(HERE, "..", "..", "..") // opencode-fork/
const SMOKE_PY = join(HERE, "smoke.py")
const REPORT_JSON = join(HERE, "smoke-report.json")
const REPORT_MD = join(HERE, "smoke-report.md")
const CDP = "http://127.0.0.1:9222/json"

const ALL_PROBES = ["boot", "providers", "panels", "settings", "files"] as const
type Probe = (typeof ALL_PROBES)[number]

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    scope: { type: "string", default: "" }, // ui | provider | viewer | all
    changed: { type: "boolean", default: false }, // 按 git diff 自动选 probe
    only: { type: "string", default: "" }, // 显式 probe 列表(逗号分隔)
    "no-static": { type: "boolean", default: false }, // 跳过 L0
    "no-launch": { type: "boolean", default: false }, // 不自动拉 dev
    cold: { type: "boolean", default: false }, // L1:杀全部→真冷启→冷启动健康
    release: { type: "boolean", default: false }, // L3:校验已构建产物
    build: { type: "boolean", default: false }, // L3:先构建再校验(隐含 release)
    env: { type: "string", default: "dev" }, // L3 渠道:dev | beta | prod
  },
})

// ── probe 选择 ────────────────────────────────────────────────────────────────
// 优先级:--only > --changed > --scope > 全量
function pickProbes(): { probes: Probe[]; how: string } {
  if (values.only) {
    const p = values.only.split(",").map((s) => s.trim()).filter(Boolean) as Probe[]
    const bad = p.filter((x) => !ALL_PROBES.includes(x))
    if (bad.length) throw new Error(`未知 probe: ${bad.join(",")}(可选:${ALL_PROBES.join(",")})`)
    return { probes: p, how: "--only" }
  }
  if (values.changed) return { probes: probesFromGit(), how: "--changed" }
  if (values.scope) {
    const map: Record<string, Probe[]> = {
      ui: ["boot", "panels", "settings"],
      provider: ["providers"],
      viewer: ["files"],
      all: [...ALL_PROBES],
    }
    const p = map[values.scope]
    if (!p) throw new Error(`未知 scope: ${values.scope}(可选:ui|provider|viewer|all)`)
    return { probes: p, how: `--scope ${values.scope}` }
  }
  return { probes: [...ALL_PROBES], how: "全量(默认)" }
}

// git 改动 → probe 映射(实现"每次都跑得起"的关键:只跑被碰到的面)
function probesFromGit(): Probe[] {
  let files: string[] = []
  try {
    // 已暂存 + 未暂存 + 未跟踪,相对仓库根
    const tracked = Bun.spawnSync(["git", "diff", "--name-only", "HEAD"], { cwd: REPO }).stdout.toString()
    const untracked = Bun.spawnSync(["git", "ls-files", "--others", "--exclude-standard"], { cwd: REPO }).stdout.toString()
    files = (tracked + "\n" + untracked).split("\n").map((s) => s.trim()).filter(Boolean)
  } catch {
    /* git 不可用 → 退回全量 */
  }
  const desktop = files.filter((f) => f.startsWith("packages/desktop/"))
  if (!desktop.length) {
    console.log("· 无 desktop 改动 → 退回全量")
    return [...ALL_PROBES]
  }
  const set = new Set<Probe>()
  for (const f of desktop) {
    if (/renderer\/.*(file-viewer|viewer|csv|pdf|document|office)/i.test(f)) set.add("files")
    if (/provider/i.test(f)) set.add("providers")
    if (/setting/i.test(f)) set.add("settings")
    if (/titlebar|panel|sidebar/i.test(f)) set.add("panels")
    if (/(^|\/)src\/main\/|preload|startup|plugin/i.test(f)) set.add("boot")
  }
  if (!set.size) {
    console.log("· desktop 有改动但未命中映射规则 → 退回全量(保守)")
    return [...ALL_PROBES]
  }
  return [...set]
}

// ── L0 静态 ───────────────────────────────────────────────────────────────────
async function runStatic(): Promise<boolean> {
  console.log("\n━━ L0 静态:typecheck + lint ━━")
  const tc = await $`bun run typecheck`.cwd(REPO).nothrow()
  if (tc.exitCode !== 0) {
    console.error("🔴 typecheck 不过 — 停在 L0,不起 app")
    return false
  }
  const lint = await $`bun run lint`.cwd(REPO).nothrow()
  if (lint.exitCode !== 0) {
    console.error("🔴 lint 不过 — 停在 L0,不起 app")
    return false
  }
  console.log("✓ L0 绿")
  return true
}

// ── L2 准备:CDP 探活 / 按需拉 dev ────────────────────────────────────────────
async function rendererReady(): Promise<boolean> {
  try {
    const r = await fetch(CDP, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return false
    const targets = (await r.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>
    return targets.some((t) => t.type === "page" && t.webSocketDebuggerUrl && !t.url.startsWith("devtools://"))
  } catch {
    return false
  }
}

async function ensureApp(): Promise<{ launched: ReturnType<typeof Bun.spawn> | null }> {
  if (await rendererReady()) {
    console.log("✓ 复用已在跑的 DeskFox dev(9222 在)")
    return { launched: null }
  }
  if (values["no-launch"]) throw new Error("9222 不通且 --no-launch — 请先 `bun run dev:desktop`")

  console.log("· 9222 未通 → 后台拉起 `bun run dev:desktop` …")
  const child = Bun.spawn(["bun", "run", "dev:desktop"], { cwd: REPO, stdout: "ignore", stderr: "ignore" })
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await Bun.sleep(2000)
    if (await rendererReady()) {
      console.log("✓ DeskFox dev 已就绪(9222 在)")
      return { launched: child }
    }
  }
  await killTree(child)
  throw new Error("拉起 dev 后 90s 内 9222 仍未就绪 — 看 `bun run dev:desktop` 是否能独立跑通")
}

async function killTree(child: ReturnType<typeof Bun.spawn>) {
  // dev:desktop → electron-vite → electron 是进程树;Windows 用 taskkill /T 连根杀,posix 杀进程组
  try {
    if (process.platform === "win32") await $`taskkill /pid ${child.pid} /T /F`.nothrow().quiet()
    else child.kill("SIGTERM")
  } catch {
    /* best-effort */
  }
}

// 杀掉【本项目】的 DeskFox/electron/sidecar 进程 —— L1 要的是【真冷 sidecar】,必须先清干净再冷启。
// 按命令行路径过滤到本仓,避免误杀机器上其它 electron 应用(VS Code / 别的 electron dev 等)。
async function killAllDeskFox() {
  const repoName = REPO.split(/[\\/]/).filter(Boolean).pop() || "opencode-fork"
  if (process.platform === "win32") {
    const ps = `Get-CimInstance Win32_Process -Filter "Name='electron.exe' or Name='DeskFox.exe' or Name='opencode.exe' or Name='opencode-cli.exe'" | Where-Object { $_.CommandLine -like '*${repoName}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
    await $`powershell -NoProfile -Command ${ps}`.nothrow().quiet()
  } else {
    await $`pkill -f ${`${repoName}.*(electron|opencode-cli|opencode)`}`.nothrow().quiet()
  }
}

// ── L1 冷启动健康 ─────────────────────────────────────────────────────────────
// 与 L2 的根本区别:必须【真冷】(杀全部→冷启),不能复用暖态 dev —— sidecar 预热竞态(首个 file.list
// 500 / connection-refused)只在冷窗口暴露,reload/暖态永远抓不到。判定经退出码:0=CLEAN/1=FAIL/2=无 renderer。
async function runCold(): Promise<number> {
  console.log("\n━━ L1 冷启动健康(真冷 sidecar)━━")
  console.log("⚠ 会杀掉所有 DeskFox/electron/sidecar 进程并冷重启(冷启动 bug 只有真冷才暴露)")
  await killAllDeskFox()
  await Bun.sleep(1500) // 等端口/输出目录锁释放
  console.log("· 冷启 `bun run dev:desktop` + 立即挂冷启动健康监控 …")
  const app = Bun.spawn(["bun", "run", "dev:desktop"], { cwd: REPO, stdout: "ignore", stderr: "ignore" })
  // 立即并发跑监控(cold-start.py 自带 renderer 等待 + 主动点首个项目触发 file.list,贴合"冷窗口监控"原意)
  const py = resolvePython()
  const mon = Bun.spawn([py, join(HERE, "cold-start.py")], { cwd: REPO, stdout: "inherit", stderr: "inherit" })
  await mon.exited
  const ec = mon.exitCode ?? 1
  await killTree(app)
  await killAllDeskFox()
  console.log("\n━━ L1 判定 ━━")
  if (ec === 0) {
    console.log("🟢 冷启动 CLEAN(无用户可见错误)")
    return 0
  }
  if (ec === 2) {
    console.log("🔴 renderer 20s 内未出现 — 启动崩溃,或冷编译过慢(重跑一次确认)")
    return 1
  }
  console.log("🔴 冷启动 FAIL — 用户可见 toast / 致命 console / sidecar 没起来(见上方明细)")
  return 1
}

// ── L2 冒烟 + 判定 ────────────────────────────────────────────────────────────
function resolvePython(): string {
  // Windows 上 `python3` 常是 Microsoft Store 占位 stub(秒退),优先 `python`;posix 反之
  const order = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"]
  for (const c of order) {
    const r = Bun.spawnSync([c, "--version"])
    if (r.success && r.stdout.toString().includes("Python 3")) return c
  }
  throw new Error("找不到 Python 3(smoke.py 依赖)。装 Python 3 + `pip install websocket-client`")
}

async function runSmoke(probes: Probe[], reuse: boolean): Promise<number> {
  // 复用别人正开着的 dev 时,boot probe 会 reload 打断其会话 → 自动选中时剔掉(--only 显式要求则保留)
  let run = probes
  if (reuse && probes.includes("boot") && values.only === "") {
    run = probes.filter((p) => p !== "boot")
    console.log("· 复用现有 dev,自动剔除 boot(避免 reload 打断你的会话;要测 boot 用 --only boot)")
  }
  if (!run.length) {
    console.log("· 无可跑 probe(boot 被剔且无其它)→ 视为通过")
    return 0
  }
  console.log(`\n━━ L2 交互冒烟:${run.join(",")} ━━`)
  const py = resolvePython()
  const proc = Bun.spawn([py, SMOKE_PY, "--only", run.join(",")], { cwd: REPO, stdout: "inherit", stderr: "inherit" })
  await proc.exited

  if (!existsSync(REPORT_JSON)) {
    console.error("🔴 smoke.py 没产出 smoke-report.json — 见上方它的输出(多半 websocket-client 没装或 CDP 断了)")
    return 1
  }
  const report = JSON.parse(readFileSync(REPORT_JSON, "utf-8")) as {
    summary: Partial<Record<"pass" | "fail" | "crash" | "skip", number>>
    results: Array<{ group: string; name: string; status: string; detail: string }>
  }
  return verdict(report)
}

function verdict(report: {
  summary: Partial<Record<string, number>>
  results: Array<{ group: string; name: string; status: string; detail: string }>
}): number {
  const s = report.summary
  const crash = report.results.filter((r) => r.status === "crash")
  const fail = report.results.filter((r) => r.status === "fail")
  console.log(
    `\n━━ 判定 ━━  通过 ${s.pass ?? 0} / 警告 ${s.fail ?? 0} / 崩溃 ${s.crash ?? 0} / 跳过 ${s.skip ?? 0}`,
  )
  if (crash.length) {
    console.log("\n🔴 崩溃(必须修):")
    for (const r of crash) console.log(`   [${r.group}] ${r.name} — ${r.detail}`)
  }
  if (fail.length) {
    console.log("\n🟡 警告(请看一眼):")
    for (const r of fail) console.log(`   [${r.group}] ${r.name} — ${r.detail}`)
  }
  console.log(`\n详单:${REPORT_MD}`)
  if (crash.length) return 1
  if (fail.length) return 2
  console.log("🟢 全过")
  return 0
}

// ── L3 发布物校验(electron-updater 口径)─────────────────────────────────────
// 电子升级链命门:latest.yml 的 sha512 必须等于实际 .exe 的 sha512 —— 不等则客户端下载新版后
// 校验失败、装不上(静默升级断)。这是 dev 模式永远测不到、只有"真打成安装包"才暴露的一类问题。
// 注:electron-updater 产物(*.exe + latest.yml + .blockmap)≠ 旧 Tauri 的 *-setup.exe + .sig,
// 故不复用 Tauri 时代的 verify-updater-artifacts.ts(那份已随换基座过时)。
async function runRelease(): Promise<number> {
  const env = (values.env as string) || "dev"
  if (!["dev", "beta", "prod"].includes(env)) throw new Error(`--env 须 dev|beta|prod,收到 ${env}`)
  const verKey = env === "prod" ? "windows" : `${env}-windows`
  const versions = JSON.parse(readFileSync(join(HERE, "..", "installer-versions.json"), "utf-8")) as Record<string, string>
  const expectVer = versions[verKey]

  if (values.build) {
    if (process.platform !== "win32")
      throw new Error("--build 目前仅 Windows(ps1);Mac 请手动跑 build-deskfox-electron.sh 后用 --release")
    console.log(`\n━━ L3 构建:build-deskfox-electron.ps1 -Env ${env} ━━`)
    const ps1 = join(HERE, "..", "scripts", "build-deskfox-electron.ps1")
    const b = Bun.spawn(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Env", env], {
      cwd: REPO,
      stdout: "inherit",
      stderr: "inherit",
    })
    await b.exited
    if (b.exitCode !== 0) {
      console.error("🔴 构建失败(脚本内置闸已拦)— 见上方输出")
      return 1
    }
  }

  console.log(`\n━━ L3 发布物校验:dist-deskfox(env=${env},期望版本 ${expectVer})━━`)
  const dist = join(REPO, "packages", "desktop", "dist-deskfox")
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []
  const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail })

  // 1. 安装包 .exe
  let exe = ""
  if (existsSync(dist)) {
    const found = readdirSync(dist).find((f) => /^DeskFox.*win-x64\.exe$/i.test(f))
    if (found) exe = join(dist, found)
  }
  add("安装包 .exe 存在", !!exe, exe ? exe.split(/[\\/]/).pop()! : "dist-deskfox 下没找到 DeskFox-*-win-x64.exe(先 --build)")

  // 2/3/4/6. latest.yml + sha512 完整性 + size + 版本号
  const ymlPath = join(dist, "latest.yml")
  if (exe && existsSync(ymlPath)) {
    add("latest.yml 存在", true)
    const yml = readFileSync(ymlPath, "utf-8")
    const ymlVer = yml.match(/^version:\s*(.+)$/m)?.[1]?.trim()
    const ymlSha = yml.match(/^sha512:\s*(.+)$/m)?.[1]?.trim() // 顶格 sha512(files 下那条有缩进,不匹配 ^)
    const ymlSize = yml.match(/^\s+size:\s*(\d+)/m)?.[1]
    const buf = readFileSync(exe)
    const realSha = createHash("sha512").update(buf).digest("base64")
    add(
      "sha512 与 latest.yml 一致(自动升级命门)",
      !!ymlSha && ymlSha === realSha,
      ymlSha === realSha ? "" : `yml=${(ymlSha || "").slice(0, 16)}… 实算=${realSha.slice(0, 16)}…(不一致=客户端升级下载后校验失败、装不上)`,
    )
    add("size 与 latest.yml 一致", String(buf.length) === ymlSize, String(buf.length) === ymlSize ? "" : `yml=${ymlSize} 实际=${buf.length}`)
    add(
      `版本号正确(期望 ${expectVer},非 0.0.0)`,
      !!ymlVer && ymlVer === expectVer && ymlVer !== "0.0.0",
      ymlVer === expectVer ? "" : `yml=${ymlVer} 期望=${expectVer}(0.0.0 = 版本号没注入,升级判断失效)`,
    )
  } else if (exe) {
    add("latest.yml 存在", false, "缺 latest.yml — electron-updater 升级清单,没它客户端不知有新版")
  }

  // 5. .blockmap(差量更新依赖)
  add(".blockmap 存在(差量更新)", !!exe && existsSync(exe + ".blockmap"), "")

  // 7. LibreOffice 真进包(build §5.5 已查,L3 独立复验做纵深防御)
  const lo = join(dist, "win-unpacked", "libreoffice", "program", "soffice.exe")
  add("LibreOffice 进包(win-unpacked/.../soffice.exe)", existsSync(lo), existsSync(lo) ? "" : "office 预览/转换在用户机静默失效")

  for (const c of checks) console.log(`   ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? " — " + c.detail : ""}`)
  const failed = checks.filter((c) => !c.ok)
  console.log("\n━━ L3 判定 ━━")
  if (failed.length) {
    console.log(`🔴 ${failed.length} 项不过 — 绝不发布残缺 / 升级链断的包`)
    return 1
  }
  console.log("🟢 发布物完整(产出 / sha512 / 版本 / 升级链 / LO 全过)")
  return 0
}

// ── main ──────────────────────────────────────────────────────────────────────
if (values.release || values.build) {
  process.exit(await runRelease()) // L3 是独立模式(产物校验),不与 dev 态 L0/L2 混跑
}

if (values.cold) {
  // L0 → L1(冷启动)。L1 必须真冷,故是独立模式,不与复用暖态 dev 的 L2 混跑。
  if (!values["no-static"]) {
    if (!(await runStatic())) process.exit(1)
  } else {
    console.log("· 跳过 L0(--no-static)")
  }
  process.exit(await runCold())
}

const { probes, how } = pickProbes()
console.log(`DeskFox verify — probe 选择:${how} → [${probes.join(",")}]`)

if (!values["no-static"]) {
  if (!(await runStatic())) process.exit(1)
} else {
  console.log("· 跳过 L0(--no-static)")
}

const { launched } = await ensureApp()
let code = 1
try {
  code = await runSmoke(probes, launched === null)
} finally {
  if (launched) {
    console.log("· 收尾:关闭本脚本拉起的 dev")
    await killTree(launched)
  }
}
process.exit(code)
