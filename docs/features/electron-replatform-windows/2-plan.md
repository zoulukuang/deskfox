feat-id: electron-replatform-windows
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 决策(反转):Win LO 走 extraFiles 落 app 根,后端零改动 —— 避开黑名单

**原计划**:Win LO 用 `extraResources` 注入到 `resources/libreoffice`,同步改后端 `office-installer.ts`
的 win `bundledSofficePath` 加 `resources` 段(`{app}\resources\libreoffice\...`),并抽 `joinBundledSoffice`
纯函数 + 单测。

**撞墙**:`office-installer.ts` 是**黑名单文件**,pre-commit 直接拦截。R4 override 要求"论证 wrapper
替代不可行",但这里 wrapper 替代**恰恰可行** → 不该 override。

**反转方案**:electron-builder `extraFiles` 落 app 根(与 exe 同级),`extraResources` 落 `resources/`。
后端**现有** win 路径就是 `dirname(execPath)\libreoffice\program\soffice.exe` = `{app}\libreoffice\...`
(app 根,Tauri 旧布局)。故 Win LO 改用 `extraFiles` 注入到 `{app}\libreoffice` **正好命中后端现有路径**
→ **后端一行都不用改**,黑名单文件不碰。这是 R1 三级跳的标准结果(配置层适配优先于改上游/黑名单)。

代价对比:LO 落 app 根(636MB 与 exe 同级)vs `resources/` 下 —— 纯位置差异,Tauri 时代就在 app 根,
功能等价。**mac 仍用 extraResources**(.app 结构强制 LO 进 `Contents/Resources`,Win 无此约束),
两端落点不同是结构差异不是不一致。

## 决策:LibreOffice 注入走 config,build 脚本只管"必须有"门槛

config 已是"按平台 + bundle 存在性条件注入"结构(mac 段先行)。Win 加 `else if (targetPlat ===
"windows")` 分支,以 `program/soffice.exe` 存在为准条件 push 到 `extraFiles`。P2 配置化 / R3:品牌资源
注入归 config,脚本只管"发布物必须有健康 LO"的硬门槛(§3.5b presets 非空 + §5.5 post-build 复验)。

## 决策:构建 wrapper 用 PowerShell,对称 mac 的 .sh,不复用 Tauri 的 build-deskfox.ps1

旧 `build-deskfox.ps1` 深度绑 `tauri build` + `tauri-overrides` + `apply-icons`(写 `src-tauri/`),
与 electron 流程不兼容。新增独立 `build-deskfox-electron.ps1`,逐段对齐 mac `.sh`:版本预检、icon.ico
就绪(用 `png-to-ico.ts` 现场生成,**不碰 Tauri 的 apply-icons**)、杀进程、§3.5 资源门槛、
electron-vite build、electron-builder `--win`(`-NoBundle` → `--dir`)、§5.5 post-build 验证、产物路径。

## 踩坑轨迹(实测)

1. **黑名单拦截 → 配置层反转**(见上):省掉一笔 R4 override。
2. **PS5.1 读 UTF-8 JSON 乱码**:`Get-Content installer-versions.json -Raw | ConvertFrom-Json` 把含中文
   `_doc` 字段按 GBK 解码 → JSON 解析崩。改 `[System.IO.File]::ReadAllText(path, UTF8)`。
   (同 [[reference_ps_config_edit_utf8_gotcha]] 的读侧版本;脚本本身也须 UTF-8 BOM 保存。)
3. **`*>&1 | Tee` 触发 NativeCommandError**:`bun run build` 把 `$ bun ./scripts/prebuild.ts` 回显到
   stderr,PS5.1 在 `$ErrorActionPreference=Stop` + 流合并下把 native stderr 包成终止错误 → 误判构建失败。
   改用 `Start-Process ... -RedirectStandardOutput/Error`(OS 级重定向,不经 PS 流)运行构建。
4. **electron-builder shim 名**:bun 在 `.bin` 生成 `electron-builder.exe`(非 `.cmd`)→ 脚本回退兼容。
5. **opencode 单测 hook 超时假象**(原后端单测排查残留,方案反转后已无):`bun test` 漏带
   `--timeout 30000` 时,opencode `test/preload.ts` 全局 `afterAll`(`AppRuntime.dispose()` + Win EBUSY
   重试 rm)超默认 5s hook 超时 → 报 `(unnamed)` hook timed out;带包标准超时即消失。

## 后续(阶段 2)

- NSIS 发布物完整构建(需先 `prepare-lo-bundle.ps1` 生成 LO bundle)+ `latest.yml` 部署。
- 老 Tauri → Electron 升级桥 Win 侧已有实现(`bridge-electron-updater.ps1`),与本 feat 解耦。
