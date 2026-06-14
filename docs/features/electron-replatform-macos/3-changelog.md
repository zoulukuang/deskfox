feat-id: electron-replatform-macos
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志

## 阶段 0 — 基座验证(无文件改动,纯实测)

确认 Electron 基座在 macOS 可用,端到端全链路通(详见 2-plan.md 决策轨迹):
- `bun install` → `bun run build`(electron-vite)→ `out/` + opencode Node 后端 + wasm 全产出
- `electron-builder --mac` → `DeskFox Dev.app`(444M,身份 `ai.deskfox.app.dev`,app.asar 174MB)
- 启动 → opencode 后端监听 `127.0.0.1:60543`,`curl` 返回 **HTTP 401**(鉴权 = 健康)

## 与远程 dev-independent-version-line 的协作交集(2026-06-14)

阶段1 开发期间,Win 同事并行推送了 `dev-independent-version-line` 系列(远程 commit
`f76b951fbf`/`1a708ebab4` 等),其中**已完成两件本 feat 原计划做的事**:
- **版本号注入**:`electron-builder.deskfox.config.ts` 自读 `installer-versions.json`(按 `--mac/--win`
  argv + channel 选号线,无 flag 回落 `process.platform`)→ `extraMetadata.version`。
  → 本 feat **采用远程方案,放弃自己的 `DESKFOX_APP_VERSION` 环境变量方案**(远程的更自洽)。
- **黑名单豁免**:pre-commit `EXCEPTION_REGEX` 加 `.*\.deskfox\.config\.(ts|js|mjs)$`。
  → 本 feat 改 deskfox config **不再需要 R4 override**(原 R4 计划作废)。

故本 feat 的实际增量收窄为:**构建 wrapper 脚本 + 删 native 死引用 + mac 适配文档**。

## 阶段 1 — 固化 dev 构建脚本(实际增量)

### 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/branding/scripts/build-deskfox-electron.sh` | 新增(fork-only) | macOS Electron 一键构建 wrapper,取代旧 `build-deskfox.sh` 的 mac 职责 |
| `packages/desktop/electron-builder.deskfox.config.ts` | 改(fork-only,黑名单已豁免) | 删 `native/` 死引用(版本注入由远程 dev-independent-version-line 负责,本 feat 不动) |

### build-deskfox-electron.sh 能力

- 参数 `-Env <dev\|beta\|prod>` + `--no-bundle`(→ electron-builder `--dir`,只出 `.app`)
- 预检 `installer-versions.json` 版本 key + 打印(实际注入由 deskfox config 自读)
- 内置两个适配点:`--publish never` + `env -u …_PROXY` 绕 Clash 代理直连 npmmirror
- `ELECTRON_CACHE` 本机外置卷优先(`/Volumes/ExtSSD`,无则回落系统默认,不硬编码以免他机 break)
- 构建前 `pkill DeskFox`(避免 `dist-deskfox` 被运行中的 `.app` 锁)
- 末尾打印产物绝对路径

### config 改动要点

- 删除 `extraResources` 的 `native/` 条目(两分支无源码 + `src/main` 零 import,消除每次构建 2 条 warning)

### 验收结果(R9 分支内验收闸)

- ✅ `bash build-deskfox-electron.sh -Env dev --no-bundle` 一键出 `.app`
- ✅ 版本号注入(远程方案):`CFBundleShortVersionString = CFBundleVersion = 2026.6.0`(非 tauri semver `1.17.4`)
- ✅ 0 条 `file source doesn't exist from=.../native` warning(原每次构建 2 条)
- ✅ 身份 `ai.deskfox.app.dev`
- ✅ `bun run typecheck`(desktop)通过,无 error
- ⏳ 整合远程后需复跑一次构建确认(见下)

### 三个国内/换基座踩坑(阶段0 实测定位,沉淀)

1. **`--publish never` 必加**:否则 electron-builder 拉 `publish.url` 的 `latest.yml` 生成差量
   blockmap,dev channel manifest 未部署时请求挂起 600s 超时。
2. **绕 Clash 代理**:npmmirror 国内镜像须直连,走代理致 electron `SHASUMS256.txt` 校验超时。
3. **`bun.lock` 污染**:本机 `BUN_CONFIG_REGISTRY=npmmirror` 会把镜像 URL 写进 lockfile,**绝不
   commit**(开源仓不污染);install 后 `git checkout bun.lock` 还原。

### 回退方法

- `git revert <commit>`:改动全 fork-only(脚本是新增文件;config 仅删 native 一处),无上游侵入。

## 后续(阶段 2/3,见 1-spec.md)

- 阶段 2:签名 + 公证(mac 段接 Developer ID + `@electron/notarize`)
- 阶段 3:`latest-mac.yml` 部署 + 老 Tauri→Electron 升级桥 mac 侧
