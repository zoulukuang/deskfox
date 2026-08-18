#!/usr/bin/env node
// [fork-only] 生成 REQ-084① 迁移污染检测的基线清单 [feat: voice-preclear-batch] 2026-08-18
//
// 放这里的理由:与 gen-tray-icons.py 完全同构(branding/scripts 生成 → desktop/src/main/deskfox/*.generated.ts);
//   根 `scripts/` 是 pre-commit 黑名单(仅放行 install-hooks.sh),fork 自有生成脚本一律走 branding/scripts。
//
// 用法:
//   node packages/branding/scripts/gen-migration-baseline.mjs              # 生成/刷新 migration-baseline.generated.ts
//   node packages/branding/scripts/gen-migration-baseline.mjs --check       # 只校验生成物与目录实时清单一致(单测用,不写文件)
//   node packages/branding/scripts/gen-migration-baseline.mjs --check-upstream
//       # 发版前信号:对比 upstream 的 migration 清单,输出「上游领先 N 条」。
//       # ⚠ 信号制(2026-08-18 user 拍板):只报数、供 user 决定是否排上游同步,
//       #   【不】当场做兼容、【不】阻断发版;拿不到上游数据一律输出「未检查成功」并 exit 0。

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// packages/branding/scripts/ → 仓库根(上溯 3 层)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const MIGRATION_DIR = join(REPO_ROOT, "packages/core/src/database/migration")
const OUT_FILE = join(REPO_ROOT, "packages/desktop/src/main/deskfox/migration-baseline.generated.ts")
const REL_MIGRATION_DIR = "packages/core/src/database/migration"

/** 目录名 → migration id(去掉 .ts 后缀)。排序保证生成物稳定,不因文件系统顺序抖动。 */
export function readLocalIds() {
  return readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.replace(/\.ts$/, ""))
    .sort()
}

function render(ids) {
  const lines = ids.map((id) => `  ${JSON.stringify(id)},`).join("\n")
  return `// [fork-only] 由 packages/branding/scripts/gen-migration-baseline.mjs 生成,请勿手改。
//   REQ-084① 迁移污染检测基线 [feat: voice-preclear-batch] 2026-08-18
//   重新生成:node packages/branding/scripts/gen-migration-baseline.mjs
//   源:${REL_MIGRATION_DIR}/(文件名去 .ts)
//
// 上游 sync 后若 core 新增了 migration,必须重跑本脚本 —— db-schema-guard.test.ts 的
// drift 闸(T2)会在不一致时直接红,防止忘记更新导致【自家新库被误判超前】。

/** 本 fork core 已知的全部 migration id(共 ${ids.length} 条)。 */
export const MIGRATION_BASELINE: string[] = [
${lines}
]
`
}

/** 从 upstream remote 读 migration 清单。拿不到(无 remote/无网/未 fetch)→ 返回 null,绝不抛。 */
function readUpstreamIds() {
  const git = (args) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  try {
    git(["remote", "get-url", "upstream"])
  } catch {
    return { ids: null, why: "无 upstream remote" }
  }
  try {
    // 尽量取最新;失败(离线/代理)不致命,退而用本地已缓存的 upstream ref。
    git(["fetch", "upstream", "--quiet"])
  } catch {
    // 忽略:下面用本地缓存 ref 继续试。
  }
  for (const ref of ["upstream/dev", "upstream/main", "upstream/master"]) {
    try {
      const out = git(["ls-tree", "--name-only", `${ref}:${REL_MIGRATION_DIR}`])
      const ids = out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.endsWith(".ts"))
        .map((l) => l.replace(/\.ts$/, ""))
        .sort()
      if (ids.length > 0) return { ids, why: ref }
    } catch {
      // 试下一个 ref
    }
  }
  return { ids: null, why: "upstream ref 不可读(未 fetch 成功或路径不存在)" }
}

function main() {
  const args = process.argv.slice(2)
  const local = readLocalIds()

  if (args.includes("--check-upstream")) {
    console.log(`[baseline] 本地 core migration:${local.length} 条`)
    const { ids: upstream, why } = readUpstreamIds()
    if (!upstream) {
      // 信号制:检查失败不阻塞发版,只标注。
      console.log(`[baseline] ⚠ 上游 schema 漂移检查【未检查成功】(${why})—— 不阻塞,发版报告标注即可`)
      process.exit(0)
    }
    const known = new Set(local)
    const ahead = upstream.filter((id) => !known.has(id))
    console.log(`[baseline] 上游(${why}):${upstream.length} 条`)
    if (ahead.length === 0) {
      console.log("[baseline] ✅ 上游未领先,无 schema 漂移")
    } else {
      console.log(`[baseline] 📌 上游领先 ${ahead.length} 条(信号,不阻断发版):`)
      for (const id of ahead) console.log(`           + ${id}`)
      console.log("[baseline] → 由 user 决定是否排上游同步需求;本次发版照常进行")
    }
    process.exit(0)
  }

  const content = render(local)

  if (args.includes("--check")) {
    if (!existsSync(OUT_FILE)) {
      console.error(`[baseline] ❌ 生成物不存在:${OUT_FILE}`)
      process.exit(1)
    }
    // 行尾归一化后再比:Win 上 git 按 autocrlf 把生成物 checkout 成 CRLF,而 render() 永远吐 LF ——
    // 逐字节比会在 Windows 上恒红,把人骗去重跑生成(重跑后 git diff 依旧为空,只会更困惑)。
    // 本闸要守的是「id 清单有没有漂」,不是行尾字节。
    const norm = (s) => s.replace(/\r\n/g, "\n")
    const actual = readFileSync(OUT_FILE, "utf8")
    if (norm(actual) !== norm(content)) {
      console.error("[baseline] ❌ 生成物与 migration 目录实时清单不一致 —— 请重跑 node packages/branding/scripts/gen-migration-baseline.mjs")
      process.exit(1)
    }
    console.log(`[baseline] ✅ 生成物与目录一致(${local.length} 条)`)
    process.exit(0)
  }

  writeFileSync(OUT_FILE, content)
  console.log(`[baseline] ✅ 已生成 ${local.length} 条 → ${OUT_FILE}`)
}

// 允许被单测 import(只取 readLocalIds),直接执行时才跑 main。
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
