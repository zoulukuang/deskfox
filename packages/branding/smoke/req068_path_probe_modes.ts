// [fork-only] REQ-068 Windows 四模态真机抓 errno [feat: stale-path-hardening] 2026-08-18
//
// 由来:REQ-068 的真机 QA 在 mac 侧已验通(2026-07-06 真 U 盘 diskutil unmount,实测 errno=ENOENT),
//   但「Windows 四模态」一直挂着转 Win 端排期(见 voice-preclear-batch/3-changelog.md 收口后待办 ③)。
//   本脚本把那四模态做成可无人值守跑的真机验收 —— 不再需要 user 手动插拔 U 盘。
//
// 为什么必须真机跑而不是只靠单测:fs-probe.test.ts 注入的是**假 statFn**,验的是判定分支;
//   而 REQ-068 的风险恰恰在「真实 errno 到底是哪个」—— mac 上就实测出与预期不同的 ENOENT
//   (而非 ENXIO/ETIMEDOUT),并因此暴露了 mountRootOf 在 mac 上恒为 "/" 的平台盲区。
//   Windows 的四模态同理,必须拿真实 errno 对账。
//
// 四模态与期望(判据来自 fs-probe.ts 的文档契约):
//   ① 目录被删     → 盘符根可达 → missing      (误判成 unreachable = 用户被反复提示「磁盘未连接」)
//   ② 目录被改名   → 同上 → missing,且 findRelocatedProject 能靠 .deskfox/id 锚找到新位置
//   ③ 盘符未映射   → 连盘符根都不可达 → unreachable(**绝不能 missing**,否则 forget 掉合法项目)
//   ④ 可移动盘拔出 → 用 subst 建虚拟盘再 /d 卸掉,与「盘符整个消失」同形 → unreachable
//      ⚠ 近似说明:subst 卸载复现的是「盘符不再存在」这一态,与物理拔 U 盘对 Win API 的表现一致;
//        真正插拔 U 盘还多一层设备移除通知,不影响 stat 的 errno 判定。
//
// 用法:bun packages/branding/smoke/req068_path_probe_modes.ts
//   (Windows only —— 盘符是 Win 概念;mac 侧对应场景已由 REQ-070 真机 U 盘验收覆盖)
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { findRelocatedProject, mountRootOf, probePath } from "../../desktop/src/main/fs-probe"

if (process.platform !== "win32") {
  console.error("❌ 本脚本只在 Windows 上有意义(盘符模态);mac 侧见 stale-path-hardening/mac-qa-handoff.md")
  process.exit(1)
}

let pass = 0
let fail = 0
const ok = (m: string) => {
  console.log(`  ✅ ${m}`)
  pass++
}
const bad = (m: string) => {
  console.log(`  ❌ ${m}`)
  fail++
}
const info = (m: string) => console.log(`     · ${m}`)

/** 找一个没被占用的盘符做 subst 虚拟盘。 */
function freeDriveLetter(): string | null {
  for (const letter of "XYWVUT") {
    if (!existsSync(`${letter}:\\`)) return letter
  }
  return null
}

const work = mkdtempSync(path.join(os.tmpdir(), "req068-probe-"))
console.log("════════ REQ-068 Windows 四模态 · 真实 errno 验收 ════════")
console.log(`临时目录:${work}\n`)

// ── ① 目录被删 → missing ──────────────────────────────────────────
console.log("【① 目录被删】期望 missing(盘符根可达,确属目录没了)")
{
  const dir = path.join(work, "deleted-project")
  mkdirSync(dir, { recursive: true })
  rmSync(dir, { recursive: true, force: true })
  const r = await probePath(dir)
  info(`probe → ${JSON.stringify(r)};mountRootOf=${mountRootOf(dir)}`)
  if (!r.ok && r.reason === "missing") ok(`判 missing(errno=${r.code})`)
  else bad(`应为 missing,实为 ${JSON.stringify(r)} —— 会把「目录被删」当成「磁盘未连接」`)
}

// ── ② 目录被改名 → missing + 锚扫描找回 ────────────────────────────
console.log("\n【② 目录被改名】期望 missing,且锚扫描能找到新位置")
{
  const parent = path.join(work, "renamed-case")
  const oldDir = path.join(parent, "proj-old")
  const newDir = path.join(parent, "proj-new")
  mkdirSync(path.join(oldDir, ".deskfox"), { recursive: true })
  const projectID = "prj_req068_probe"
  writeFileSync(path.join(oldDir, ".deskfox", "id"), projectID)
  renameSync(oldDir, newDir)

  const r = await probePath(oldDir)
  info(`probe(旧路径) → ${JSON.stringify(r)}`)
  if (!r.ok && r.reason === "missing") ok(`旧路径判 missing(errno=${r.code})`)
  else bad(`应为 missing,实为 ${JSON.stringify(r)}`)

  const found = await findRelocatedProject(oldDir, projectID)
  if (found === newDir) ok("锚扫描按 .deskfox/id 找回改名后的新位置")
  else bad(`锚扫描应返回 ${newDir},实为 ${found}`)
}

// ── ③ 盘符未映射 → unreachable ────────────────────────────────────
console.log("\n【③ 盘符未映射】期望 unreachable(绝不能 missing —— 否则永久遗忘合法项目)")
{
  const letter = freeDriveLetter()
  if (!letter) {
    bad("找不到空闲盘符,跳过(本机盘符占满)")
  } else {
    const target = `${letter}:\\SomeProject`
    const r = await probePath(target)
    info(`probe(${target}) → ${JSON.stringify(r)};mountRootOf=${mountRootOf(target)}`)
    if (!r.ok && r.reason === "unreachable") ok(`判 unreachable(errno=${r.code})`)
    else bad(`应为 unreachable,实为 ${JSON.stringify(r)} —— 会 forget 掉盘没插时的合法项目`)
  }
}

// ── ④ 可移动盘拔出(subst 卸载模拟)→ unreachable ────────────────────
console.log("\n【④ 可移动盘拔出】subst 建虚拟盘 → 卸掉 → 期望 unreachable")
{
  const letter = freeDriveLetter()
  const backing = path.join(work, "removable-backing")
  mkdirSync(path.join(backing, "MyProject"), { recursive: true })
  let mounted = false
  try {
    if (!letter) throw new Error("无空闲盘符")
    execFileSync("subst", [`${letter}:`, backing], { stdio: "pipe" })
    mounted = true
    const target = `${letter}:\\MyProject`

    const before = await probePath(target)
    if (before.ok) ok(`挂载态 probe → ok(前提成立:${target} 可达)`)
    else bad(`挂载态就不可达,前提不成立:${JSON.stringify(before)}`)

    execFileSync("subst", [`${letter}:`, "/d"], { stdio: "pipe" })
    mounted = false

    const after = await probePath(target)
    info(`卸载后 probe → ${JSON.stringify(after)}`)
    if (!after.ok && after.reason === "unreachable") ok(`卸载后判 unreachable(errno=${after.code})`)
    else bad(`应为 unreachable,实为 ${JSON.stringify(after)} —— 拔盘会导致项目被永久遗忘`)
  } catch (error) {
    bad(`subst 模拟失败:${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (mounted && letter) {
      try {
        execFileSync("subst", [`${letter}:`, "/d"], { stdio: "pipe" })
      } catch {
        // 已卸载或本就没挂上
      }
    }
  }
}

rmSync(work, { recursive: true, force: true })
console.log(`\n════════ 结果:${pass} 通过 / ${fail} 失败 ════════`)
process.exit(fail > 0 ? 1 : 0)
