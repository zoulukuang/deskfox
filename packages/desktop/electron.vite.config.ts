import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import appPlugin from "@opencode-ai/app/vite"
import * as fs from "node:fs/promises"

const OPENCODE_SERVER_DIST = "../opencode/dist/node"

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  // FORK: 第 4 档 local 必须透传,否则被兜底成 "dev" → 打包本地版冒用预览版身份且不隔离数据 [feat: local-channel]
  if (raw === "local" || raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.OPENCODE_CHANNEL === "latest") return "prod"
  return "dev"
})()

// FORK: 交叉打包(如 arm64 机上打 x64)按【目标 arch】选 node-pty 子包 [feat: macos-intel-x64-build] 2026-07-11
//   node-pty-narrower 插件会把 import '@lydell/node-pty' 改写成此宿主子包并 externalize。若用构建机
//   process.arch(arm64),交叉打的 x64 包会把 arm64 子包写死进 bundle → Intel 机 arm64/utils.js 去找
//   自身没有的 prebuilds/darwin-x64/pty.node → 启动即崩(REQ-081)。故优先取 DESKFOX_TARGET_ARCH(由
//   build-deskfox-electron.sh 按 --arch 注入),缺省回落 process.arch(原生打包行为不变)。
const targetArch = process.env.DESKFOX_TARGET_ARCH || process.arch
const nodePtyPkg = `@lydell/node-pty-${process.platform}-${targetArch}`

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

export default defineConfig({
  main: {
    define: {
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts" },
        // Keep this identical to electron-vite's Node 20.11+ shim. Its regex insertion can
        // corrupt bundled TypeScript, while a Rollup banner places the shim safely.
        output: {
          banner: `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`,
        },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "opencode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "opencode:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:opencode-server") return this.resolve(`${OPENCODE_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "opencode:copy-server-assets",
        async writeBundle() {
          for (const l of await fs.readdir(OPENCODE_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${OPENCODE_SERVER_DIST}/${l}`))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    // FORK: 渲染层 channel 确定注入 — titlebar DEV/BETA 徽标 + dialog-settings 版本号读
    // import.meta.env.VITE_OPENCODE_CHANNEL。原先渲染层无 define,只靠 Vite 自动暴露 process.env.VITE_*,
    // build 时漏设该 env → 徽标消失 + 版本号回落 prod 号线。此处从单一源 OPENCODE_CHANNEL 派生确定注入,
    // 与 main 进程 define / electron-builder OPENCODE_CHANNEL 同源。版本/渠道规则见 docs/governance/版本号与发布渠道规范.md。
    define: {
      "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
    },
    plugins: [appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
