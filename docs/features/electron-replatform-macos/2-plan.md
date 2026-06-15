feat-id: electron-replatform-macos
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 阶段 0(验证,无文件改动)

逐步验证基座 mac 可用性,每步用后台构建 + 实测产物校验:

1. `bun install`(带 `ELECTRON_MIRROR=npmmirror`)→ 1043 包,electron 工具链落 `packages/desktop/node_modules`
2. `bun run build`(electron-vite)→ `out/{main/index.js,main/sidecar.js,preload,renderer}` + opencode node(21MB)+ wasm chunks 全产出
3. `electron-builder --mac` → 撞 600s timeout
   - **决策轨迹**:DEBUG 抓 URL 定位到 electron zip 下载 100% 后挂在 `SHASUMS256.txt`;
     `--publish never` 后仍挂 → 排除 publish.url;最终定位 **Clash 代理转发 npmmirror 超时** →
     `env -u …_PROXY` 直连解决。
4. `.app` 启动 → 主进程 + Helper + utilityProcess sidecar 起,opencode 后端监听 `127.0.0.1:60543`,
   `curl` 返回 **HTTP 401**(鉴权 = 健康)。端到端通。

## 阶段 1(固化构建脚本)

### 决策:版本号注入 —— 采用远程 dev-independent-version-line 方案(原环境变量方案作废)

> ⚠️ 2026-06-14 协作反转:阶段1 开发期间 Win 同事并行推送 `dev-independent-version-line`,
> 已在 `electron-builder.deskfox.config.ts` 内做了版本注入(config 自读 `installer-versions.json`,
> 按 `--mac/--win` argv + channel 选号线,无 flag 回落 `process.platform`)。

原计划:构建脚本传 `DESKFOX_APP_VERSION` 环境变量 → config 注入。**已放弃** —— 远程的 config
自读方案更自洽(裸跑 electron-builder 也对,不依赖脚本传参)。本 feat 改为:构建脚本只 `export
OPENCODE_CHANNEL` + 传 `--mac`,版本由 config 自行解析;脚本侧仅保留版本号预检 + 打印(信息性)。

### 决策:R4 override 作废 —— 远程已豁免黑名单

原计划走 R4 override(deskfox config 被 `.config.ts` 通配黑名单误伤)。远程 `1a708ebab4` 已把
`.*\.deskfox\.config\.(ts|js|mjs)$` 加入 pre-commit `EXCEPTION_REGEX` 豁免 → 本 feat 改该 config
不再触发黑名单,**无需 override**。

### 决策:`native/` 死引用直接删,不保留注释占位

两分支无源码 + `src/main` 零 import,功能未接。YAGNI 删除消除每次构建的 warning 噪声,
git 历史可查,后续真接 mac 原生窗口能力再补回。

### 决策:`--no-bundle` → electron-builder `--dir`

对齐旧 Tauri 脚本的「快速出可测产物」语义。Electron 下 `--dir` 出 `.app`(不打 dmg/zip),
是本地测试最快路径(user 偏好)。

## 阶段 2/3(待启动)

- 阶段 2:deskfox config mac 段条件接 `identity`/`hardenedRuntime`/`entitlements`/`notarize`
  (读 `~/.deskfox-signing/config.env`,prod 启用、缺证书优雅降级出未签名包);entitlements 已存在。
- 阶段 3:`latest-mac.yml` 部署到 `updates.deskfox.ai/electron/<channel>` + 老 Tauri→Electron
  升级桥 mac 侧(对照 `tauri-to-electron-upgrade-bridge` feat 的 Win 实现)。
