// [feat: 启用自动升级] 2026-06-05 — updater 配置回归守护(构建断言,无需 build)
//
// 守护本 feat 评审时发现/修正的三类 bug:
//   1. updater 配置放错层:pubkey/endpoint/createUpdaterArtifacts 必须在 fork 实际使用的
//      tauri-overrides/*(build-deskfox.ps1 --config 加载),不在上游 tauri.{prod,beta}.conf.json
//      (那只被上游 CI publish.yml 用,DeskFox 本地构建不加载 → 改了零效果)
//   2. pubkey 用错/typo:必须 == minisign.pub 的密钥,且 != 上游 anomalyco 公钥
//   3. Layer 3 防御被误删:cli.rs 的 OPENCODE_DISABLE_AUTOUPDATE 守卫必须保留
//
// 对应 spec TC-9(pubkey 替换)/ TC-10(env guard,已反转为"保留")。
// 纯静态读文件断言,跑 `bun test`(或 turbo），不依赖 release build。

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const HERE = import.meta.dir
const OVERRIDES = join(HERE, "..", "tauri-overrides")
const DESKTOP = join(HERE, "..", "..", "desktop")
const SRC_TAURI = join(DESKTOP, "src-tauri")

// 上游 anomalyco minisign 公钥的密钥行(切换前的值)——任何 override 都不该再用它
const UPSTREAM_KEY_LINE = "RWQEoTmciZcD8CXOMBWIa9tuPXiirl+VwiOefsm714L4NYS0UoWBqNzY"

/** 从 base64 编码的 minisign .pub 文件内容里取出密钥行(以 "RW" 开头那行,忽略注释行) */
function keyLineFromPubkeyBase64(pubkeyBase64: string): string {
  const decoded = Buffer.from(pubkeyBase64, "base64").toString("utf8")
  const line = decoded
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("RW"))
  if (!line) throw new Error(`无法从 pubkey 解出密钥行: ${decoded}`)
  return line
}

function readOverride(env: "prod" | "beta" | "dev"): any {
  return JSON.parse(readFileSync(join(OVERRIDES, `${env}.json`), "utf8"))
}

// minisign.pub 入仓文件的密钥行 —— DeskFox 自己的公钥真值
const DESKFOX_KEY_LINE = (() => {
  const pub = readFileSync(join(DESKTOP, "minisign.pub"), "utf8")
  const line = pub
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("RW"))
  if (!line) throw new Error("minisign.pub 里找不到密钥行")
  return line
})()

describe("minisign.pub 公钥", () => {
  test("是 DeskFox 自己的公钥,不是上游 anomalyco 的", () => {
    expect(DESKFOX_KEY_LINE).not.toBe(UPSTREAM_KEY_LINE)
    expect(DESKFOX_KEY_LINE.length).toBeGreaterThan(40)
  })
})

describe.each(["prod", "beta", "dev"] as const)("tauri-overrides/%s.json updater 配置", (env) => {
  test("有 plugins.updater.pubkey,且密钥 == minisign.pub、!= 上游", () => {
    const cfg = readOverride(env)
    const pubkey = cfg?.plugins?.updater?.pubkey
    expect(typeof pubkey).toBe("string")
    expect(pubkey.length).toBeGreaterThan(0)

    const keyLine = keyLineFromPubkeyBase64(pubkey)
    // 核心:override 里编进 binary 的密钥必须等于入仓 minisign.pub 的密钥(防 typo/换错)
    expect(keyLine).toBe(DESKFOX_KEY_LINE)
    // 防回退到上游公钥(否则任何人可用上游私钥签伪造更新)
    expect(keyLine).not.toBe(UPSTREAM_KEY_LINE)
  })

  test("endpoint 指向 updates.deskfox.ai,不是 github.com/anomalyco", () => {
    const cfg = readOverride(env)
    const endpoints: string[] = cfg?.plugins?.updater?.endpoints ?? []
    expect(endpoints.length).toBeGreaterThan(0)
    for (const ep of endpoints) {
      expect(ep).toContain("updates.deskfox.ai")
      expect(ep).not.toContain("anomalyco")
    }
  })
})

describe("createUpdaterArtifacts(产出 .sig 的开关)", () => {
  // prod/beta 是要 ship 的渠道,必须产签名更新产物;否则 finalize-latest-json 没东西可读
  test.each(["prod", "beta"] as const)("%s override 有 bundle.createUpdaterArtifacts=true", (env) => {
    const cfg = readOverride(env)
    expect(cfg?.bundle?.createUpdaterArtifacts).toBe(true)
  })
})

describe("Rust 端常量与守卫", () => {
  test("constants.rs UPDATER_ENABLED = true(updater 总开关已开)", () => {
    const src = readFileSync(join(SRC_TAURI, "src", "constants.rs"), "utf8")
    expect(src).toMatch(/UPDATER_ENABLED:\s*bool\s*=\s*true/)
  })

  test("cli.rs 保留 Layer 3 守卫 OPENCODE_DISABLE_AUTOUPDATE(纵深防御不删)", () => {
    const src = readFileSync(join(SRC_TAURI, "src", "cli.rs"), "utf8")
    // 必须仍把该 env 注入 sidecar(阻断 CLI 通道 B 自升级)
    expect(src).toContain("OPENCODE_DISABLE_AUTOUPDATE")
    expect(src).toMatch(/"OPENCODE_DISABLE_AUTOUPDATE"[\s\S]{0,40}"true"/)
  })
})
