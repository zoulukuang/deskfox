#!/usr/bin/env bun

// [DEPRECATED] Tauri updater 产物校验(.sig/minisign),换 Electron 后(2026-06-15)作废。Electron updater 校验由 deploy-electron-updater.sh 回读 latest.yml 完成。勿运行。
// [fork-only] DeskFox updater 构建产物断言（TC-5 / TC-8 / TC-9）
// [feat: 启用自动升级] 2026-06-06
//
// 在一次完整 bundle build 之后跑，验证 updater 升级链的物理产物正确：
//   TC-5  NSIS 安装包产出：bundle/nsis 下有 *-setup.exe，命名符合 Tauri NSIS 规范，且有同名 .exe.sig
//   TC-8  minisign 签名验证（离线，纯 Node crypto，无需外部 minisign 二进制）：
//           - .sig 内 key ID == 入仓 minisign.pub 的 key ID（证明用我们的私钥签的，不是上游）
//           - 按签名算法字节（Ed=纯/ED=blake2b 预哈希）对安装包字节做 Ed25519 全量验签
//   TC-9  pubkey 替换：override pubkey == minisign.pub 且 != 上游 anomalyco（与单测重叠，构建态再确认一次）
//
// 用法：
//   bun run packages/branding/scripts/verify-updater-artifacts.ts --env prod
//   （--bundle-dir 可显式指定 nsis/ 目录；默认 packages/desktop/src-tauri/target/release/bundle/nsis）
//
// 退出码：全过 0，任一失败 1（可挂 CI / ship 闸）。

import { parseArgs } from "node:util"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createHash, createPublicKey, verify as edVerify } from "node:crypto"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    env: { type: "string", default: "prod" }, // prod | beta（dev 不产更新产物）
    target: { type: "string", default: "" }, // windows | darwin；留空按当前平台
    "bundle-dir": { type: "string", default: "" },
  },
})

const HERE = import.meta.dir
const BRANDING = join(HERE, "..")
const REPO = join(BRANDING, "..", "..")
const DESKTOP = join(REPO, "packages", "desktop")

const env = values.env as string
if (!["prod", "beta"].includes(env)) {
  throw new Error(`--env 必须是 prod 或 beta（dev 是 Tier3 本地测试，不产更新产物）；收到 ${env}`)
}

// FORK: macos-updater-adapt 2026-06-06 — 平台分支（原仅 Win NSIS .exe，加 darwin .app.tar.gz）。
// 留空时按当前运行平台推断；验签逻辑（parseBlob/ed25519/edVerify）平台无关，仅产物路径/命名分流。
const target = (values.target as string) || (process.platform === "darwin" ? "darwin" : "windows")
if (!["windows", "darwin"].includes(target)) {
  throw new Error(`--target 必须是 windows 或 darwin；收到 ${target}`)
}
const bundleSubdir = target === "darwin" ? "macos" : "nsis"
const artifactGlob = target === "darwin" ? "*.app.tar.gz" : "*-setup.exe"

// 上游 anomalyco minisign 公钥的密钥行（切换前的值）—— 任何产物都不该再用它
const UPSTREAM_KEY_LINE = "RWQEoTmciZcD8CXOMBWIa9tuPXiirl+VwiOefsm714L4NYS0UoWBqNzY"

let passed = 0
let failed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✅ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ❌ ${name}\n       ${(e as Error).message}`)
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

/** 取 minisign .pub / 签名 blob 文本里以 RW/RU 开头的 base64 主体行 */
function keyLineFrom(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^R[WU]/.test(l))
  if (!line) throw new Error(`找不到 minisign base64 主体行:\n${text}`)
  return line
}

/** 解析 minisign blob（pubkey 或 signature 的 base64 主体行解码后）→ { algo, keyId } */
function parseBlob(b64Line: string): { algo: string; keyId: Buffer; rest: Buffer } {
  const raw = Buffer.from(b64Line, "base64")
  assert(raw.length >= 10, `minisign blob 太短(${raw.length}B)`)
  const algo = raw.subarray(0, 2).toString("latin1") // "Ed"=纯 Ed25519 / "ED"=blake2b 预哈希
  const keyId = raw.subarray(2, 10) // 8 字节 key ID
  const rest = raw.subarray(10) // pubkey: 32B 公钥 / sig: 64B 签名
  return { algo, keyId, rest }
}

/** 从 32 字节裸 Ed25519 公钥构造 Node KeyObject（套 SPKI DER 前缀） */
function ed25519PubKeyObject(raw32: Buffer) {
  assert(raw32.length === 32, `Ed25519 公钥应 32 字节,收到 ${raw32.length}`)
  const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw32]), format: "der", type: "spki" })
}

// ---- 读 minisign.pub（DeskFox 真公钥） ----
const pubText = readFileSync(join(DESKTOP, "minisign.pub"), "utf8")
const pubKeyLine = keyLineFrom(pubText)
const pub = parseBlob(pubKeyLine)
const pubKeyObj = ed25519PubKeyObject(pub.rest)

console.log(`\n[verify-updater-artifacts] env=${env}  pubkey keyId=${pub.keyId.toString("hex").toUpperCase()}\n`)

// ================= TC-9：pubkey 替换 =================
console.log("TC-9 pubkey 替换:")
const override = JSON.parse(readFileSync(join(BRANDING, "tauri-overrides", `${env}.json`), "utf8"))
check("override 有 plugins.updater.pubkey", () => {
  assert(typeof override?.plugins?.updater?.pubkey === "string" && override.plugins.updater.pubkey.length > 0, "缺 pubkey")
})
check("override pubkey == minisign.pub", () => {
  const ovLine = keyLineFrom(Buffer.from(override.plugins.updater.pubkey, "base64").toString("utf8"))
  assert(ovLine === pubKeyLine, `override 密钥行与 minisign.pub 不一致\n  override=${ovLine}\n  pub     =${pubKeyLine}`)
})
check("override pubkey != 上游 anomalyco", () => {
  const ovLine = keyLineFrom(Buffer.from(override.plugins.updater.pubkey, "base64").toString("utf8"))
  assert(ovLine !== UPSTREAM_KEY_LINE, "仍是上游公钥(任何人可用上游私钥签伪造更新)")
})

// ================= TC-5：更新产物（Win NSIS .exe / Mac .app.tar.gz） =================
console.log(`\nTC-5 更新产物产出 (${target}/bundle/${bundleSubdir}):`)
const bundleDir = values["bundle-dir"]
  ? (values["bundle-dir"] as string)
  : join(DESKTOP, "src-tauri", "target", "release", "bundle", bundleSubdir)

let setupFile = ""
let sigFile = ""
check(`bundle/${bundleSubdir} 目录存在`, () => {
  assert(existsSync(bundleDir), `不存在:${bundleDir}（先跑 build-deskfox.${target === "darwin" ? "sh" : "ps1"} -Env ${env} 完整 bundle）`)
})
check(`存在 ${artifactGlob}（${target === "darwin" ? "macOS updater bundle" : "NSIS 命名,非 Inno"}）`, () => {
  // 产物匹配:darwin → *.app.tar.gz / windows → *-setup.exe
  const fileRe = target === "darwin" ? /\.app\.tar\.gz$/i : /-setup\.exe$/i
  const matches = readdirSync(bundleDir).filter((f) => fileRe.test(f))
  assert(matches.length > 0, `bundle/${bundleSubdir} 下无 ${artifactGlob}`)
  // 优先 DeskFox 品牌命名:darwin=DeskFox.app.tar.gz / windows=DeskFox_<ver>_x64-setup.exe
  const namedRe = target === "darwin" ? /^DeskFox.*\.app\.tar\.gz$/i : /^DeskFox[_-].*x64-setup\.exe$/i
  const named = matches.find((f) => namedRe.test(f)) ?? matches[0]
  setupFile = join(bundleDir, named)
  sigFile = setupFile + ".sig"
  console.log(`       → ${named}`)
})
check("存在同名 .sig 签名文件", () => {
  assert(sigFile !== "" && existsSync(sigFile), `缺 .sig:${sigFile}（createUpdaterArtifacts + TAURI_SIGNING_PRIVATE_KEY 是否生效?）`)
})

// ================= TC-8：minisign 离线验签 =================
console.log("\nTC-8 minisign 签名验证（离线 Node crypto）:")
if (setupFile && sigFile && existsSync(sigFile)) {
  // Tauri .sig 文件内容是 minisign 签名文件文本的 base64
  const sigOuter = readFileSync(sigFile, "utf8").trim()
  const sigText = Buffer.from(sigOuter, "base64").toString("utf8")
  const sigLine = keyLineFrom(sigText)
  const sig = parseBlob(sigLine)

  check("签名 key ID == minisign.pub key ID（我们的私钥签的）", () => {
    assert(
      sig.keyId.equals(pub.keyId),
      `key ID 不匹配:sig=${sig.keyId.toString("hex").toUpperCase()} pub=${pub.keyId.toString("hex").toUpperCase()}`,
    )
  })

  check("Ed25519 验签通过（对安装包字节）", () => {
    assert(sig.rest.length === 64, `Ed25519 签名应 64 字节,收到 ${sig.rest.length}`)
    const fileBytes = readFileSync(setupFile)
    // 算法字节决定预哈希:"Ed"=对原文 / "ED"=对 blake2b512(原文)
    let message: Buffer
    if (sig.algo === "ED") {
      message = createHash("blake2b512").update(fileBytes).digest()
    } else if (sig.algo === "Ed") {
      message = fileBytes
    } else {
      throw new Error(`未知签名算法字节:${sig.algo}`)
    }
    const ok = edVerify(null, message, pubKeyObj, sig.rest)
    assert(ok, `Ed25519 验签失败（algo=${sig.algo}）—— 安装包被篡改或密钥不匹配`)
  })
} else {
  failed++
  console.log("  ❌ 跳过验签:.sig 不存在（TC-5 已记失败）")
}

// ---- 汇总 ----
console.log(`\n[verify-updater-artifacts] ${passed} pass / ${failed} fail`)
if (failed > 0) process.exit(1)
console.log("[verify-updater-artifacts] 全部通过 ✅ (TC-5 / TC-8 / TC-9)")
