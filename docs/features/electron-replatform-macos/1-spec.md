feat-id: electron-replatform-macos
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# Electron 换基座 — macOS 端适配

## 背景

`feat/electron-replatform` 把 DeskFox 从 Tauri 换基座到 Electron,主体由 Windows 端开发。
Electron 应用结构(`packages/desktop/src/{main,preload,renderer}`)平台中立,但**打包/签名/
发布整条流水线只为 Win 落地**:`electron-builder.deskfox.config.ts` 的 mac 段是占位
(`identity:null`、注释「ship 流程另定」),`packages/branding/scripts/` 仍是 Tauri 时代脚本。

本 feat 负责把 macOS 侧从「能不能跑」一路补齐到「能签名公证发布 + 自动更新」,对齐原 Tauri mac 流水线。

## 关键事实(阶段 0 已核实)

- opencode 后端 = **内嵌 Node 进程**(`utilityProcess.fork("sidecar.js")` + `virtual:opencode-server`),
  **不需要外部 `opencode-cli` 二进制**(与 Tauri sidecar 模型本质不同)。
- `native/mac_window` 模块两分支均无源码、`src/main` 零 import → 死引用,已移除。
- electron-builder 内置 mac 签名(自动 deep-sign 含嵌套 bundle)/ DMG 生成+签名 / 公证
  (`@electron/notarize`)/ updater manifest(`latest-mac.yml`+blockmap)→ 比 Tauri 手动流程大幅简化。

## 分阶段路线

| 阶段 | 目标 | 状态 |
|---|---|---|
| 0 | dev 构建跑通(build→package→启动→后端响应)纯验证 | ✅ done |
| 1 | 固化 dev 构建脚本(`build-deskfox-electron.sh` + config 适配) | ✅ done |
| 2 | 签名 + 公证(deskfox config mac 段接 Developer ID + notarize) | ⏳ 待启动 |
| 3 | 发布 + 自动更新(`latest-mac.yml` 部署 + 老 Tauri→Electron 升级桥 mac 侧) | ⏳ 待启动 |

## 验收标准(阶段 0+1)

- [x] `electron-vite build` 在 macOS 完整产出 `out/{main,preload,renderer}` + opencode Node 后端 + wasm
- [x] `electron-builder --mac` 产出 `DeskFox Dev.app`(身份 `ai.deskfox.app.dev`)
- [x] `.app` 启动后 opencode 后端监听并 HTTP 响应(401 鉴权 = 健康)
- [x] `build-deskfox-electron.sh -Env dev [--no-bundle]` 一键可重复出未签名包
- [x] 日历版号注入(`2026.6.0`,非 tauri semver `1.17.4`;由远程 dev-independent-version-line 的 config 自读实现)
- [x] 0 条 `native` extraResources warning
- [x] typecheck 通过

## 已知适配点(国内/换基座踩坑)

1. **`--publish never` 必加**:否则 electron-builder 拉 `publish.url` 的 `latest.yml` 生成差量
   blockmap,dev channel manifest 未部署时请求挂起 600s 超时。
2. **绕 Clash 代理**:npmmirror 国内镜像须直连,走代理致 electron `SHASUMS256.txt` 校验超时。
3. **`bun.lock` 污染**:本机 `BUN_CONFIG_REGISTRY=npmmirror` 会把镜像 URL 写进 lockfile,
   **绝不 commit**(开源仓不污染);install 后 `git checkout bun.lock` 还原。
