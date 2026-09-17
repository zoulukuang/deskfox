// [bug-repro: 构建脚本从未设 OPENCODE_VERSION,叠加 OPENCODE_CHANNEL=prod 使 IS_PREVIEW=true,
//              版本号 fallback 成 0.0.0-prod-<时间戳> → 对外发布的正式版被 Console 按 semver 判旧客户端,
//              免费额度报 "OpenCode 1.17.0 or newer is required"(真实基线 1.18.16 本就比门槛新)]
// REQ-132 · 2026-09-17 · [feat: release-closeout-2026-09]
//
// 推导链在 packages/script/src/index.ts:
//   :27 OPENCODE_CHANNEL 优先 → CHANNEL="prod"
//   :32 IS_PREVIEW = CHANNEL !== "latest" → true
//   :35 OPENCODE_VERSION 未设 → 跳过
//   :36 IS_PREVIEW → `0.0.0-${CHANNEL}-${时间戳}`
// 该值经 packages/opencode/script/build-node.ts:24 的 define 烧进 bundle,成为 InstallationVersion。
//
// 本测试守护四件事:
//   ① 注入块真能从 package.json 取出版本号(**跑的是从脚本里抽出的真代码,不是副本**)
//   ② 取不到时 fail-fast —— 绝不静默回退产出 0.0.0-* 包(D-B 拍板)
//   ③ 注入不得动 OPENCODE_CHANNEL —— db 路径依赖 channel 白名单,动它会让用户数据"凭空消失"(S1.3)
//   ④ Mac/Win 两份 wrapper 逐项对偶 —— 两份脚本历史上漂移过(见 build-electron-arch-outdir.test.ts)

import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPTS = join(import.meta.dir, "..", "scripts")
const SH = readFileSync(join(SCRIPTS, "build-deskfox-electron.sh"), "utf8")
const PS1 = readFileSync(join(SCRIPTS, "build-deskfox-electron.ps1"), "utf8")

const MARKER = "REQ-132 构建时注入真实基线版本号"

/** 抽出 sh 里 REQ-132 的 FORK-BEGIN…FORK-END 块 —— 测真代码,不维护副本 */
function shInjectionBlock(): string {
  const begin = SH.indexOf(`# FORK-BEGIN: ${MARKER}`)
  expect(begin).toBeGreaterThan(-1)
  const end = SH.indexOf("# FORK-END", begin)
  expect(end).toBeGreaterThan(begin)
  return SH.slice(begin, end)
}

/** 造一个只有 packages/opencode/package.json 的假仓库根 */
function fakeRepo(pkgJsonContent: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "req132-"))
  mkdirSync(join(root, "packages", "opencode"), { recursive: true })
  if (pkgJsonContent !== null) {
    writeFileSync(join(root, "packages", "opencode", "package.json"), pkgJsonContent)
  }
  return root
}

/** 在假仓库根上跑真注入块,回传 exit code / stdout / stderr */
async function runInjection(pkgJsonContent: string | null) {
  const root = fakeRepo(pkgJsonContent)
  try {
    const script = [
      "set -euo pipefail",
      `REPO_ROOT=${JSON.stringify(root)}`,
      shInjectionBlock(),
      // 把注入结果单独打一行,便于断言(前缀避开脚本自己的 echo)
      'echo "RESULT=${OPENCODE_VERSION:-}"',
    ].join("\n")
    const proc = Bun.spawn(["bash", "-c", script], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { exitCode, stdout, stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("REQ-132 · 版本号注入(Mac wrapper 真代码)", () => {
  test("① 正常 package.json → 注入该版本号", async () => {
    const r = await runInjection(JSON.stringify({ name: "opencode", version: "1.18.16" }))
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("RESULT=1.18.16")
    expect(r.stdout).not.toContain("0.0.0-")
  })

  test("① 预发布号(1.19.0-rc.1)也放行 —— 上游确实用过这种基线", async () => {
    const r = await runInjection(JSON.stringify({ version: "1.19.0-rc.1" }))
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("RESULT=1.19.0-rc.1")
  })

  test.each([
    ["version 字段缺失", JSON.stringify({ name: "opencode" })],
    ["version 为空串", JSON.stringify({ version: "" })],
    ["version 不是 semver", JSON.stringify({ version: "latest" })],
    ["version 就是坏值 0.0.0-prod-x", JSON.stringify({ version: "0.0.0-prod-202608190542" })],
    ["package.json 不是合法 JSON", "{ this is not json"],
  ])("② fail-fast:%s → 构建报错退出,绝不回退", async (_label, content) => {
    const r = await runInjection(content)
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain("REQ-132")
    expect(r.stdout).not.toContain("RESULT=0.0.0")
  })

  test("② fail-fast:package.json 根本不存在", async () => {
    const r = await runInjection(null)
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain("REQ-132")
  })
})

describe("REQ-132 · 注入不得越界", () => {
  test("③ 注入块不碰 OPENCODE_CHANNEL(动它 = 换 db 路径 = 用户数据凭空消失)", () => {
    const block = shInjectionBlock()
    // 注释里提到 channel 是可以的,但不得有赋值/export
    expect(block).not.toMatch(/^\s*(export\s+)?OPENCODE_CHANNEL=/m)
    expect(PS1).not.toMatch(/\$env:OPENCODE_CHANNEL\s*=\s*\$opencodeVersion/)
  })

  test("③ OPENCODE_VERSION 不得外泄到 updater 清单链路", () => {
    // finalize-latest-{yml,json}.ts 同名读该 env,但它们要 DeskFox 日历号,不是上游基线号。
    // 两份 wrapper 都不该调它们 —— 一旦调了,注入的 1.18.16 会污染 updater manifest 版本。
    for (const src of [SH, PS1]) {
      expect(src).not.toContain("finalize-latest-yml")
      expect(src).not.toContain("finalize-latest-json")
    }
  })
})

describe("REQ-132 · Mac / Win 两份 wrapper 对偶", () => {
  test("④ 两侧都有注入块", () => {
    expect(SH).toContain(MARKER)
    expect(PS1).toContain(MARKER)
  })

  test("④ 两侧都从 packages/opencode/package.json 取值", () => {
    expect(SH).toContain("packages/opencode/package.json")
    expect(PS1).toContain("packages/opencode/package.json")
  })

  test("④ 两侧用同一条 semver 校验正则", () => {
    const re = /\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\(\[-\+\]\[0-9A-Za-z\.-\]\+\)\?\$/
    expect(SH).toMatch(re)
    expect(PS1).toMatch(re)
  })

  test("④ 两侧都 fail-fast(sh 用 exit 1 / ps1 用 throw)", () => {
    const shBlock = shInjectionBlock()
    expect(shBlock).toContain("exit 1")
    const ps1Begin = PS1.indexOf(`# FORK-BEGIN: ${MARKER}`)
    const ps1End = PS1.indexOf("# FORK-END", ps1Begin)
    expect(ps1Begin).toBeGreaterThan(-1)
    expect(ps1End).toBeGreaterThan(ps1Begin)
    expect(PS1.slice(ps1Begin, ps1End)).toContain("throw")
  })

  test("④ 两侧注入点都在 electron-vite build 之前", () => {
    expect(SH.indexOf(MARKER)).toBeLessThan(SH.indexOf("bun run build"))
    expect(PS1.indexOf(MARKER)).toBeLessThan(PS1.indexOf("bun run build"))
  })
})

describe("REQ-132 · 0.0.0 专项闸(合法 semver,但正是坏值本身)", () => {
  test("④ 两侧都有 0.0.0 显式拦截 —— 只靠 semver 正则拦不住 0.0.0-prod-<时间戳>", () => {
    expect(SH).toMatch(/0\.0\.0\*/)
    expect(PS1).toMatch(/0\.0\.0\*/)
  })
})
