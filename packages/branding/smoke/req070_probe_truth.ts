// REQ-070 物理盘 QA — 实测 fs-probe 对「外置盘卸载」的分类(missing=forget vs unreachable=keep)。
// 直接调生产 probePath;卸载→探测→立即重挂,尽量缩短离线窗口。
import { probePath } from "../../desktop/src/main/fs-probe"
import { spawnSync } from "node:child_process"
import path from "node:path"

const VOL = "/Volumes/WININSTALL"
const P_NONGIT = "/Volumes/WININSTALL/养老"
const P_GIT = "/Volumes/WININSTALL/程序代码/MyProgram/UvxyOptionPrice"

function sh(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8" })
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") }
}

console.log("root(养老) =", path.parse(P_NONGIT).root)
console.log("mounted?", sh("bash", ["-c", `test -d "${VOL}" && echo yes || echo no`]).out.trim())

console.log("\n--- 卸载(force,模拟拔盘)---")
let u = sh("diskutil", ["unmount", "force", VOL])
console.log("unmount:", u.code, u.out.trim().slice(0, 120))

const res: Record<string, unknown> = {}
try {
  console.log("mount still there?", sh("bash", ["-c", `test -d "${VOL}" && echo yes || echo no`]).out.trim())
  res["养老(nongit)"] = await probePath(P_NONGIT)
  res["UvxyOptionPrice(git)"] = await probePath(P_GIT)
  res["root(/)"] = await probePath("/")
} finally {
  console.log("\n--- 重挂 ---")
  let m = sh("diskutil", ["mount", "/dev/disk4s1"])
  if (m.code !== 0) m = sh("diskutil", ["mount", VOL])
  console.log("mount:", m.code, m.out.trim().slice(0, 120))
  console.log("remounted?", sh("bash", ["-c", `test -d "${P_NONGIT}" && echo yes || echo no`]).out.trim())
}

console.log("\n================ 探测分类结果 ================")
for (const [k, v] of Object.entries(res)) {
  const r = v as { ok: boolean; reason?: string; code?: string }
  const verdict =
    r.ok ? "ok(在线)" : r.reason === "unreachable" ? "unreachable → 保留 lastProject ✅正确" : `missing → forget ❌错误(应 unreachable)`
  console.log(`  ${k}: ${JSON.stringify(v)}  →  ${verdict}`)
}
