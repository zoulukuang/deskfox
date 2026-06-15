feat-id: electron-replatform-windows
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# Electron 换基座 — Windows 端打包链适配

## 背景

`feat/electron-replatform` 把 DeskFox 从 Tauri 换基座到 Electron,Electron 应用结构
(`packages/desktop/src/{main,preload,renderer}`)平台中立 —— 运行时功能(防睡眠、HTML 预览右键
加聊天、localasset 协议、sidecar 看门狗等)是共享 `src/main` 代码,Win 跟随分支即自动具备。

但**打包链**此前只有两套形态并存:
- macOS 已由 `electron-replatform-macos` feat 固化(`build-deskfox-electron.sh` + config mac 段 + LO 注入)。
- **Windows 仍停在 Tauri 时代**:`build-deskfox.ps1` 内部是 `tauri build` + `tauri-overrides` +
  `apply-icons`(写 `src-tauri/`);Win 的 Electron 包此前靠手动 `bunx electron-builder --win` 临时跑,
  没有 fork wrapper、没有就绪门槛、没有 LibreOffice 注入。

本 feat 把 Windows 打包链补齐到与 macOS 对称:一键构建 wrapper + LibreOffice 注入 + 资源就绪门槛。

## 关键事实(核实)

- opencode 后端 = 内嵌 Node 进程(`utilityProcess.fork("sidecar.js")`),`process.execPath` = Electron
  本体(`{app}\DeskFox.exe`)。
- 后端 `office-installer.ts` 的 **win 内置探测路径现有就是** `dirname(execPath)\libreoffice\program\soffice.exe`
  = `{app}\libreoffice\program\soffice.exe`(app 根,与 Tauri 旧布局一致)。
- electron-builder 的 **`extraFiles`** 落 app 根(与 exe 同级),**`extraResources`** 落 `resources/`。
  → Win LO 用 `extraFiles` 注入到 `{app}\libreoffice` 正好命中后端**现有**路径 → **后端零改动**
  (避开黑名单文件 `office-installer.ts`,R1 三级跳:配置层适配)。
- Win LibreOffice bundle 结构 = `program/soffice.exe` + `presets/`(剥皮后约 636MB,由
  `prepare-lo-bundle.ps1` 生成,gitignored)。`presets/` 是 office 转换硬依赖。
- 构建就绪度:worktree 已有 node_modules / electron-builder / out / 两个 plugin dist / icon.ico,
  仅缺 `libreoffice-bundle/windows`(预期,重型现场产物)。

## 改动范围

| 模块 | 文件 | 类型 |
|---|---|---|
| A 构建 wrapper | `packages/branding/scripts/build-deskfox-electron.ps1` | 新增 fork-only(UTF-8 BOM) |
| B config Win LO 注入 | `packages/desktop/electron-builder.deskfox.config.ts` | 改 fork-only(黑名单已豁免) |

> **不改后端**:`office-installer.ts`(黑名单文件)零改动 —— Win LO 走 `extraFiles` 落 app 根,
> 命中后端现有探测路径。原计划改后端加 `resources` 段被 pre-commit 黑名单拦截后,改走此配置层方案
> (R1 三级跳;R4 override 因 wrapper 替代可行而**不触发**)。详见 2-plan.md。

## 验收标准(R8 测试用例清单)

- [x] **A1** `-Env dev -NoBundle` 一键出 `win-unpacked\DeskFox Dev.exe`,退出码 0
- [x] **A2** 冷启动健康检查:启动产物 → opencode 后端监听 + HTTP 401(鉴权=健康)
- [x] **A3** release 模式缺 plugin dist 硬失败;`-NoBundle` 放行 warning
- [x] **A4** release 模式缺 LO bundle 硬失败 + 指引;`-NoBundle` 放行
- [x] **B1/B2** windows + bundle 存在 → `extraFiles` 注入 app 根;不存在 → 不注入(不中断自测)
- [x] **B3** mac 注入逻辑(extraResources)不受影响
- [x] **R3** `bun test src`(desktop)全绿(electron mock 基建 + 防睡眠/local-asset)
- [x] typecheck(desktop)通过

> **运行时·native 风险点**(对照"CDP 自测 ≠ 真桌面 QA"):防睡眠开关托盘↔设置双向同步、HTML 预览右键
> "加入聊天" 属视觉/native 交互,单测覆盖逻辑但**最终须真机 QA**;LO 全量注入(`extraFiles` → app 根 →
> 后端命中)需先 `prepare-lo-bundle.ps1` 生成 bundle 才能端到端验(本地无 bundle,本轮只验 `-NoBundle`
> 自测路径 + 注入逻辑静态正确性 + 落点路径与后端探测一致性)。

## 阶段路线(对称 macOS)

| 阶段 | 目标 | 状态 |
|---|---|---|
| 1 | dev 构建跑通(wrapper + LO 注入 + 门槛) | ✅ 本 feat |
| 2 | 发布 + 自动更新(NSIS 发布物 + `latest.yml` 部署;老 Tauri→Electron 升级桥 Win 已有 `bridge-electron-updater.ps1`) | ⏳ 后续 |
