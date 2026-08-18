import { $ } from "bun"
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CLI_VERSION = "0.0.0-next-16350"

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

export const CLI_BINARIES: Array<{ rustTarget: string; package: string; os: string; cpu: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    package: "@opencode-ai/cli-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    package: "@opencode-ai/cli-darwin-x64-baseline",
    os: "darwin",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-pc-windows-msvc",
    package: "@opencode-ai/cli-windows-arm64",
    os: "win32",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    package: "@opencode-ai/cli-windows-x64-baseline",
    os: "win32",
    cpu: "x64",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    package: "@opencode-ai/cli-linux-x64-baseline",
    os: "linux",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    package: "@opencode-ai/cli-linux-arm64",
    os: "linux",
    cpu: "arm64",
  },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

function nativeTarget() {
  const { platform, arch } = process
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

export function getCurrentCli(target = RUST_TARGET ?? nativeTarget()) {
  const binaryConfig = CLI_BINARIES.find((item) => item.rustTarget === target)
  if (!binaryConfig) throw new Error(`CLI configuration not available for target '${target}'`)

  return binaryConfig
}

// FORK: sidecar 下载固定走 npmjs 官方源 —— 国内开发机把 `BUN_CONFIG_REGISTRY` 指向 npmmirror
//   (固化在 ~/.zshenv,日常装依赖靠它提速),但**npmmirror 不同步该包的 `next` 预发布版**:
//   实测 npmjs 上 3192 个版本(含 1035 个 `0.0.0-next-*`),npmmirror 只有 85 个、`next` 一个没有。
//   于是 prebuild 恒报 `No version matching "0.0.0-next-<n>" found (but package exists)`,
//   整条桌面打包链路卡死。CLI_VERSION 每次上游同步都会变,所以不能靠"换个能装的版本"绕过 ——
//   必须让这一条 install 绕开镜像。只影响 sidecar 这一个包,其余依赖照旧走镜像。
//   可用 OPENCODE_CLI_REGISTRY 覆盖(离线/私有源场景)。
//   [feat: desktop-build-blockers] 2026-08-18
const CLI_REGISTRY = process.env.OPENCODE_CLI_REGISTRY || "https://registry.npmjs.org"

export async function downloadCliToResources() {
  const cli = getCurrentCli()
  const directory = await mkdtemp(join(tmpdir(), "opencode-cli-"))
  const dest = windowsify("resources/opencode-cli")
  try {
    // FORK: 装不到时把 bun 那句含糊的 `No version matching …(but package exists)` 翻译成根因,
    //   否则下一个人还要再排查一遍(2026-08-18 实测:从报错到定位到"镜像不同步 next 版"花了不少时间)。
    try {
      await $`bun install --no-save --cwd ${directory} ${`${cli.package}@${CLI_VERSION}`} ${`--os=${cli.os}`} ${`--cpu=${cli.cpu}`} --registry ${CLI_REGISTRY}`
    } catch (error) {
      throw new Error(
        `无法从 ${CLI_REGISTRY} 安装 ${cli.package}@${CLI_VERSION}。\n` +
          `常见原因:该 registry 未同步 opencode 的 \`0.0.0-next-*\` 预发布版(国内镜像普遍如此),\n` +
          `或网络不通。可用 OPENCODE_CLI_REGISTRY 指定可用源后重试,例如:\n` +
          `  OPENCODE_CLI_REGISTRY=https://registry.npmjs.org bun run build\n` +
          `原始错误: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    await copyFile(
      join(directory, "node_modules", cli.package, "bin", cli.os === "win32" ? "opencode2.exe" : "opencode2"),
      dest,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  if (process.platform !== "win32") await chmod(dest, 0o755)
  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }
  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`

  console.log(`Copied ${cli.package} to ${dest}`)
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
