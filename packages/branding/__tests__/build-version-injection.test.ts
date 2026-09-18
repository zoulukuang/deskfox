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

// FORK 2026-09-17 [feat: release-closeout-2026-09] · Win 侧回验补洞
//
// 上面 ④ 那组「Mac / Win 对偶」全是**文本断言** —— 只查 PS1 里有没有 `throw`、正则长得像不像,
// 真正被**执行**过的只有 sh 块(runInjection 起 bash 真跑)。也就是说:PS1 注入块的实际行为
// 一次都没被验证过,而它恰恰是 Windows 发布物的唯一版本号来源。两份脚本历史上漂移过,
// 「长得一样」不等于「跑起来一样」——PowerShell 的 non-terminating error、`-notmatch` 对 $null
// 的语义、ConvertFrom-Json 的失败方式,都可能让同形的代码行为不同。
//
// 故在 Windows 上把 sh 侧那 6 个场景原样再跑一遍 PS1 块。非 Windows 自动跳过(拿不到 powershell.exe)。
//
// ⚠️ runner 必须写成 **UTF-8 with BOM**:PS 5.1 读无 BOM 的 UTF-8 .ps1 会按系统 ANSI(中文机上是 GBK)
//    解码,注入块里的中文注释被错拆后会吃掉后续引号,脚本直接变成语法错误 —— 实测踩过,
//    表现为「一堆莫名其妙的 ParserError」,与被测逻辑毫无关系。
const IS_WIN = process.platform === "win32"

function ps1InjectionBlock(): string {
  const begin = PS1.indexOf(`# FORK-BEGIN: ${MARKER}`)
  expect(begin).toBeGreaterThan(-1)
  const end = PS1.indexOf("# FORK-END", begin)
  expect(end).toBeGreaterThan(begin)
  return PS1.slice(begin, end)
}

async function runInjectionPs1(pkgJsonContent: string | null) {
  const root = fakeRepo(pkgJsonContent)
  try {
    const runner = [
      `$repoRoot = ${JSON.stringify(root)}`,
      "$env:OPENCODE_VERSION = $null",
      ps1InjectionBlock(),
      'Write-Host "RESULT=$($env:OPENCODE_VERSION)"',
    ].join("\r\n")
    const runnerPath = join(root, "runner.ps1")
    writeFileSync(runnerPath, "﻿" + runner, "utf8") // BOM,见上
    const proc = Bun.spawn(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", runnerPath],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { exitCode, stdout, stderr, all: stdout + stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe.if(IS_WIN)("REQ-132 · 版本号注入(Win wrapper 真代码,仅 Windows 跑)", () => {
  test("① 正常 package.json → 注入该版本号", async () => {
    const r = await runInjectionPs1(JSON.stringify({ name: "opencode", version: "1.18.16" }))
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("RESULT=1.18.16")
    expect(r.stdout).not.toContain("0.0.0-")
  })

  test("① 预发布号(1.19.0-rc.1)也放行", async () => {
    const r = await runInjectionPs1(JSON.stringify({ version: "1.19.0-rc.1" }))
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
    const r = await runInjectionPs1(content)
    expect(r.exitCode).not.toBe(0)
    expect(r.all).toContain("REQ-132")
    expect(r.stdout).not.toContain("RESULT=0.0.0")
  })

  test("② fail-fast:package.json 根本不存在", async () => {
    const r = await runInjectionPs1(null)
    expect(r.exitCode).not.toBe(0)
    expect(r.all).toContain("REQ-132")
  })
})

// [bug-repro: 给 .ps1 加 `trap { Remove-Item Env:OPENCODE_VERSION }`(无 break)后,PowerShell 的
//  trap 默认「跑完处理器继续往下执行」,两道 fail-fast 的 throw 被它吞掉、执行流直落到
//  `$env:OPENCODE_VERSION = $opencodeVersion` —— Win 实测 6 种坏值全部 exit=0,
//  且 `0.0.0-prod-202608190542` / `latest` 被真的注入,REQ-132 整道防线反向失效]
// 2026-09-18 · Win 端实测抓出并修复(`55f26ca483`),本组是它的**跨平台**防回归闸。
//
// 为什么还要这一组:抓到它的是 Win 专属的真执行组(describe.if(win32)),那组在 mac 上整体跳过。
// 也就是说在 mac 上把 break 删掉,本地全绿,要等推到 Win 才炸 —— 而这个脚本的改动
// 十有八九是在 mac 上发生的(本批那个 trap 就是)。故补一条纯文本断言,两端都跑。
describe("REQ-132 · PS1 构建期 env 的 trap / 还原", () => {
  test("🔒 trap 处理器以 break 结尾 —— 清理后把终止性错误继续抛出去", () => {
    const trapLine = PS1.split("\n").find((line) => line.trim().startsWith("trap {"))
    expect(trapLine).toBeDefined()
    expect(trapLine).toMatch(/;\s*break\s*\}/)
  })

  test("🔒 trap 与收尾走同一个还原函数 —— 两条路径不得再分叉", () => {
    // 首版就是两处各写各的:trap 里删 VERSION、收尾也删 VERSION,而 CHANNEL 两处都没管。
    // 收敛成一个函数后,再漏一个变量必须是"函数里漏",不会再出现"只修了一半路径"。
    expect(PS1).toMatch(/function\s+Restore-DeskFoxBuildEnv\s*\{/)
    const calls = PS1.split("\n").filter((line) => /(^|[\s{;])Restore-DeskFoxBuildEnv\s*(;|\}|$)/.test(line))
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const trapLine = PS1.split("\n").find((line) => line.trim().startsWith("trap {"))
    expect(trapLine).toMatch(/Restore-DeskFoxBuildEnv/)
    // 正常路径的那次调用在脚本末尾(trap 正常结束不触发,构建成功才是最常见的路径)
    expect(PS1.trimEnd().endsWith("Restore-DeskFoxBuildEnv")).toBe(true)
  })

  // [bug-repro: 注入块只管了 OPENCODE_VERSION,漏了同样泄漏进调用方会话的 OPENCODE_CHANNEL。
  //  后者更危险 —— electron.vite.config.ts / electron-builder.deskfox.config.ts 在它缺省时兜底成 "dev",
  //  被污染则静默改判:同会话先 `-Env local` 自测再跑 `bun run build`,本该 dev 的产物会拿到
  //  LOCAL 徽标 + appId `.local` + opencode-local.db + 版本号回落裸号。]
  test("🔴 两个构建期变量都要还原 —— CHANNEL 与 VERSION 同等待遇", () => {
    const fn = PS1.slice(PS1.indexOf("function Restore-DeskFoxBuildEnv"))
    const body = fn.slice(0, fn.indexOf("\n}") + 2)
    for (const name of ["OPENCODE_CHANNEL", "OPENCODE_VERSION"]) {
      expect(body).toContain(name)
    }
  })

  // [bug-repro: PowerShell 的 trap 编译期注册、覆盖整个 scope(含文本位置在它之前的语句),
  //  故脚本前段任一 throw 都会执行处理器 —— 那时脚本还没设过这两个变量,
  //  无条件 Remove-Item 删掉的是**调用方预设的值**。]
  test("🔴 还原而不是一律删除 —— 先存调用方原值,且存在第一处 throw 之前", () => {
    const saveIdx = PS1.indexOf("$script:prevOpencodeChannel = $env:OPENCODE_CHANNEL")
    expect(saveIdx).toBeGreaterThan(-1)
    expect(PS1).toContain("$script:prevOpencodeVersion = $env:OPENCODE_VERSION")
    // 存值必须早于脚本里第一处**可执行**的 throw,否则前段出错时还原的是空值。
    // 按行扫并跳过注释行 —— 注释里出现 "throw" 这个词不算(本测试自己就踩过这个坑)。
    const lines = PS1.split("\n")
    let offset = 0
    let firstThrow = -1
    for (const line of lines) {
      const code = line.trim()
      if (firstThrow < 0 && !code.startsWith("#") && /(^|[\s{;])throw\s/.test(line)) firstThrow = offset
      offset += line.length + 1
    }
    expect(firstThrow).toBeGreaterThan(-1)
    expect(saveIdx).toBeLessThan(firstThrow)
    // 函数体必须是"有原值就写回,没有才删"
    const fn = PS1.slice(PS1.indexOf("function Restore-DeskFoxBuildEnv"))
    const body = fn.slice(0, fn.indexOf("\n}") + 2)
    expect(body).toMatch(/\$env:OPENCODE_CHANNEL\s*=\s*\$script:prevOpencodeChannel/)
    expect(body).toMatch(/\$env:OPENCODE_VERSION\s*=\s*\$script:prevOpencodeVersion/)
  })

  test("🔒 两道 fail-fast 仍在 —— break 是为了让它们生效,不是替代它们", () => {
    const begin = PS1.indexOf(`# FORK-BEGIN: ${MARKER}`)
    const end = PS1.indexOf("# FORK-END", begin)
    const block = PS1.slice(begin, end)
    expect(block).toContain("throw")
    expect(block).toMatch(/0\.0\.0\*/)
  })
})
