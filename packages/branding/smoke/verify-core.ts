// [fork-only] DeskFox verify 链 — 纯逻辑核心(可单测)[feat: verify-core-tests] 2026-06-15
//
// 从 verify.ts(编排器,含 IO / 进程 / CDP / 文件)抽出的【纯函数】,便于 Logic 清单单测(R5)。
// verify.ts import 本模块,行为不变;本模块零 IO、零 console、零进程,输入→输出确定。

import { createHash } from "node:crypto"

export const ALL_PROBES = ["boot", "providers", "panels", "settings", "files"] as const
export type Probe = (typeof ALL_PROBES)[number]

// ── git 改动文件 → probe 映射 ───────────────────────────────────────────────────
// 只看 packages/desktop/ 下的改动;无 desktop 改动 / 有改动但没命中任何规则 → 退回全量(保守)。
export type ProbePickReason = "no-desktop" | "no-match" | "matched"

export function probesFromChangedFiles(files: string[]): { probes: Probe[]; reason: ProbePickReason } {
  const desktop = files.filter((f) => f.startsWith("packages/desktop/"))
  if (!desktop.length) return { probes: [...ALL_PROBES], reason: "no-desktop" }
  const set = new Set<Probe>()
  for (const f of desktop) {
    if (/renderer\/.*(file-viewer|viewer|csv|pdf|document|office)/i.test(f)) set.add("files")
    if (/provider/i.test(f)) set.add("providers")
    if (/setting/i.test(f)) set.add("settings")
    if (/titlebar|panel|sidebar/i.test(f)) set.add("panels")
    if (/(^|\/)src\/main\/|preload|startup|plugin/i.test(f)) set.add("boot")
  }
  if (!set.size) return { probes: [...ALL_PROBES], reason: "no-match" }
  return { probes: [...set], reason: "matched" }
}

// ── probe 选择优先级:--only > --changed > --scope > 全量 ─────────────────────────
// changedProbes 由调用方(verify.ts)用 git 算好传入(本函数不碰 git,保持纯)。
const SCOPE_MAP: Record<string, Probe[]> = {
  ui: ["boot", "panels", "settings"],
  provider: ["providers"],
  viewer: ["files"],
  all: [...ALL_PROBES],
}

export function selectProbes(opts: {
  only?: string
  changed?: boolean
  scope?: string
  changedProbes?: Probe[]
}): { probes: Probe[]; how: string } {
  if (opts.only) {
    const p = opts.only.split(",").map((s) => s.trim()).filter(Boolean) as Probe[]
    const bad = p.filter((x) => !ALL_PROBES.includes(x))
    if (bad.length) throw new Error(`未知 probe: ${bad.join(",")}(可选:${ALL_PROBES.join(",")})`)
    return { probes: p, how: "--only" }
  }
  if (opts.changed) return { probes: opts.changedProbes ?? [], how: "--changed" }
  if (opts.scope) {
    const p = SCOPE_MAP[opts.scope]
    if (!p) throw new Error(`未知 scope: ${opts.scope}(可选:ui|provider|viewer|all)`)
    return { probes: p, how: `--scope ${opts.scope}` }
  }
  return { probes: [...ALL_PROBES], how: "全量(默认)" }
}

// ── L2 冒烟报告 → 退出码判定 ─────────────────────────────────────────────────────
// crash(任一)→ 1 🔴;无 crash 但有 fail → 2 🟡;全过 → 0 🟢。
export type SmokeResult = { group: string; name: string; status: string; detail: string }
export type SmokeReport = {
  summary: Partial<Record<"pass" | "fail" | "crash" | "skip", number>>
  results: SmokeResult[]
}

export function classifyVerdict(report: SmokeReport): { code: 0 | 1 | 2; crash: SmokeResult[]; fail: SmokeResult[] } {
  const crash = report.results.filter((r) => r.status === "crash")
  const fail = report.results.filter((r) => r.status === "fail")
  if (crash.length) return { code: 1, crash, fail }
  if (fail.length) return { code: 2, crash, fail }
  return { code: 0, crash, fail }
}

// ── L3 发布物校验(electron-updater 口径)──────────────────────────────────────
// 纯判定:给定 exe 名 / latest.yml 文本 / exe 字节 / 期望版本 / blockmap·LO 是否在,产出检查项。
// sha512 用 exeBuf 实算(确定),与 latest.yml 内顶格 sha512 比对 —— 自动升级命门。
export type ReleaseCheck = { name: string; ok: boolean; detail: string }

export function evaluateReleaseChecks(input: {
  exeName: string | null // 找到的安装包文件名(null=没找到)
  ymlText: string | null // latest.yml 内容(null=不存在)
  exeBuf: Uint8Array | null // 安装包字节(null=没找到)
  expectVer: string | undefined // installer-versions.json 期望版本
  hasBlockmap: boolean
  hasLO: boolean
}): { checks: ReleaseCheck[]; failed: ReleaseCheck[] } {
  const checks: ReleaseCheck[] = []
  const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail })

  // 1. 安装包 .exe
  add(
    "安装包 .exe 存在",
    !!input.exeName,
    input.exeName ?? "dist-deskfox 下没找到 DeskFox-*-win-x64.exe(先 --build)",
  )

  // 2/3/4/6. latest.yml + sha512 + size + 版本号
  if (input.exeName && input.exeBuf && input.ymlText) {
    add("latest.yml 存在", true)
    const yml = input.ymlText
    const ymlVer = yml.match(/^version:\s*(.+)$/m)?.[1]?.trim()
    const ymlSha = yml.match(/^sha512:\s*(.+)$/m)?.[1]?.trim() // 顶格 sha512(files 下那条有缩进,不匹配 ^)
    const ymlSize = yml.match(/^\s+size:\s*(\d+)/m)?.[1]
    const realSha = createHash("sha512").update(input.exeBuf).digest("base64")
    add(
      "sha512 与 latest.yml 一致(自动升级命门)",
      !!ymlSha && ymlSha === realSha,
      ymlSha === realSha
        ? ""
        : `yml=${(ymlSha || "").slice(0, 16)}… 实算=${realSha.slice(0, 16)}…(不一致=客户端升级下载后校验失败、装不上)`,
    )
    add(
      "size 与 latest.yml 一致",
      String(input.exeBuf.length) === ymlSize,
      String(input.exeBuf.length) === ymlSize ? "" : `yml=${ymlSize} 实际=${input.exeBuf.length}`,
    )
    add(
      `版本号正确(期望 ${input.expectVer},非 0.0.0)`,
      !!ymlVer && ymlVer === input.expectVer && ymlVer !== "0.0.0",
      ymlVer === input.expectVer ? "" : `yml=${ymlVer} 期望=${input.expectVer}(0.0.0 = 版本号没注入,升级判断失效)`,
    )
  } else if (input.exeName) {
    add("latest.yml 存在", false, "缺 latest.yml — electron-updater 升级清单,没它客户端不知有新版")
  }

  // 5. .blockmap(差量更新依赖)
  add(".blockmap 存在(差量更新)", input.hasBlockmap, "")

  // 7. LibreOffice 真进包
  add(
    "LibreOffice 进包(win-unpacked/.../soffice.exe)",
    input.hasLO,
    input.hasLO ? "" : "office 预览/转换在用户机静默失效",
  )

  return { checks, failed: checks.filter((c) => !c.ok) }
}
