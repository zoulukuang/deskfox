---
feat-id: 启用自动升级
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 启用自动升级 — spec

## 触发原因

前序 feat `禁自动升级` 关闭了所有上游自动升级入口(三层防御:编译时 hard-code / platform 接口缺失 / sidecar env guard),防止 DeskFox 被上游 OpenCode 整壳替换。现在 DeskFox 自有更新基础设施(`packages/telemetry` + `updates.deskfox.ai`)已就绪,需要**反向操作:启用 DeskFox 自家更新通道**,让用户收到新版本通知并完成一键升级(macOS)或引导升级(Windows NSIS 切换后也走一键)。

同时,Windows 安装包从 Inno Setup 切换到 Tauri NSIS,以获得 Tauri updater 全自动兼容能力。

## 目标

| ID | 目标 | 价值 |
|---|---|---|
| G1 | macOS 用户能自动检测新版本并一键安装+重启 | 核心升级体验,零操作成本 |
| G2 | Windows 用户能自动检测新版本并一键安装+重启(NSIS) | 对齐 macOS 体验 |
| G3 | 国内用户下载安装包走 CDN(OSS),不依赖 GitHub | GFW 环境可用 |
| G4 | 签名验证阻止篡改/中间人替换 | 安全底线 |
| G5 | 存量 Inno Setup 用户有明确的迁移路径 | 不丢用户 |

## 前置依赖

1. **minisign 密钥对已生成** — 私钥存入 CI Secrets / 发版机,公钥入仓
2. **`updates.deskfox.ai` 后端已部署 Tauri updater 格式的 `latest.json`** — 当前 telemetry 的 `latest.json` 格式(自定义 schema)与 Tauri updater 要求的格式(`platforms` + `signature` 字段)不同,需要新端点或格式扩展
3. **macOS 代码签名已就绪** — `~/.deskfox-signing/config.env` 含 `APPLE_SIGNING_IDENTITY`(当前 prod build 已有)

## 验收标准

### R1 — UPDATER_ENABLED 翻转

- [ ] `constants.rs` `UPDATER_ENABLED = true`(加 FORK marker,说明从"禁"翻"启")
- [ ] Tauri updater plugin 在 build 时注册(`lib.rs` 条件注册生效)
- [ ] `window.__OPENCODE__?.updaterEnabled` 返回 `true`(JS ← Rust 桥接生效)
- [ ] `platform.checkUpdate` 和 `platform.updateAndRestart` 存在于 platform 对象上(不再是 undefined)

### R2 — macOS updater 全流程

- [ ] 构建产出 `.app.tar.gz` + `.app.tar.gz.sig`(minisign 签名文件)
- [ ] `latest.json` 包含 `darwin-aarch64-app` 条目,`url` 指向 OSS CDN 或 GitHub,`signature` 为 minisign 签名 base64
- [ ] 旧版 DeskFox(macOS)启动后,updater 检测到新版本 → 弹 toast "Install & Restart" / "Not Yet"
- [ ] 用户点击 "Install & Restart" → 下载 → 验签名通过 → 安装 → 杀 sidecar → relaunch → 新版本运行
- [ ] macOS 菜单 "Check for Updates..." 可见且可点击
- [ ] Settings → General → Updates section 全部启用(不灰):startup toggle + "Check now" 按钮

### R3 — Windows NSIS 安装包

- [ ] `DeskFox.iss` + `ChineseSimplified.isl` 已删除(不再走 Inno Setup)
- [ ] `tauri.conf.json` / `tauri.prod.conf.json` / `tauri.beta.conf.json` 的 `nsis` 配置完整:三档 AppId/GUID、中英双语 languages、installerIcon、desktop shortcut
- [ ] `pack-installer.ps1` 不再调用 `ISCC.exe`,改用 `tauri build` 直接产出 NSIS `.exe`
- [ ] 构建产出 NSIS `.exe` + `.exe.sig`(minisign 签名)
- [ ] NSIS installer 安装体验对齐 Inno Setup:中英文选择、桌面图标、WebView2 bootstrapper 自动处理
- [ ] prod / beta / dev 三档 AppId 独立,控制面板识别为 3 个独立 app,同机共存

### R4 — latest.json 生成与部署

- [ ] DeskFox 版 `finalize-latest-json.ts` 已创建,适配 DeskFox 产物命名(`DeskFox-<ver>-setup.exe` → NSIS 后改回 Tauri 标准命名) + 支持 OSS CDN URL 作为主 URL
- [ ] ship SOP 包含"签名 → 生成 latest.json → 部署到 updates.deskfox.ai + GitHub Release"步骤
- [ ] `latest.json` 的 `url` 字段对国内用户指向 `dl.clawtray.com`(OSS CDN),海外 fallback 指向 GitHub releases
- [ ] Tauri updater endpoint 配置为 `https://updates.deskfox.ai/v1/latest/desktop/latest.json`(prod) / beta 对应路径

### R5 — pubkey 与签名密钥

- [x] DeskFox minisign 公钥配置在 **`tauri-overrides/{prod,beta,dev}.json` 的 `plugins.updater.pubkey`**(2026-06-05 修正:fork 构建走 `--config tauri-overrides/*`,不加载上游 `tauri.{prod,beta}.conf.json`;改后者无效且违 R4 黑名单)。同时补 `bundle.createUpdaterArtifacts: true`(prod/beta)否则不产 `.sig`
- [ ] 构建流程设置 `TAURI_SIGNING_PRIVATE_KEY` 环境变量(私钥来自 CI Secrets 或发版机本地)
- [ ] minisign 公钥文件入仓(`packages/desktop/minisign.pub` 或类似位置)
- [ ] minisign 私钥**不入仓**(`.gitignore` 排除 `*.key` / `minisign.key`)

### R6 — 旧防御机制处理(2026-06-05 修订:Layer 3 保留)

- [x] **Layer 3 保留** — `cli.rs` sidecar spawn env 的 `OPENCODE_DISABLE_AUTOUPDATE=true` 不移除。决策依据:Tauri updater 走外壳层,与 CLI 自升级(通道 B)独立;删守卫非启用 updater 的必要条件,反而重开通道 B。保留 = 白送纵深防御。
- [x] 三层防御:Layer 1(constants.rs hard-code)翻 false→true / Layer 2(platform 接口缺失)条件 spread 自动生效 / **Layer 3(sidecar env)保留不动**

### R7 — 存量 Inno 用户迁移

- [ ] 存量 Inno Setup 版 DeskFox 收到 NSIS 版更新通知 → 下载 NSIS `.exe` → 安装到新目录(与 Inno 安装路径不同,不覆盖)
- [ ] 安装完成后,用户需手动在控制面板卸载旧 Inno 版( updater 不自动卸载 Inno 版,这是预期行为)
- [ ] 首次迁移时,NSIS installer 检测到同机存在 Inno 版,弹提示"请手动卸载旧版 DeskFox"(可选,非阻塞)

### R8 — 回归(无副作用)

- [ ] 文件查看器 / 聊天 / 文件树 / 飞书桥接 / build 全套照常工作,无回归
- [ ] typecheck 全绿
- [ ] 现有 e2e 测试(phase 1 mock + phase 2 真桌面)全绿
- [ ] 非升级场景下(当前已是最新版),updater check 返回 null → 不弹任何通知 → 不影响正常使用

## 不做什么

- **不改 CLI sidecar 的 `upgrade.ts` 内部逻辑** — sidecar 走 server 模式不进 TUI,自动升级由 Tauri updater shell 层负责,CLI 层保持原状
- **不拦用户手动 `opencode upgrade` CLI 命令** — 保持原决策
- **不改 `packages/telemetry` 的自定义 `latest.json` 格式** — 那是 CLI 检查用的,与 Tauri updater 的 `latest.json` 格式独立并存
- **不做 Linux updater** — 当前 Linux 产出 `.deb`/`.rpm`,Tauri updater 对 Linux 支持有限(AppImage 才能自动更新),本次只做 macOS + Windows
- **不做 Electron 版 updater 改动** — `desktop-electron` 的 updater 是独立系统,不动

## 架构选型

### A. Tauri updater 签名方案(minisign)

走 Tauri 标准方案:Ed25519 签名,公钥编译时固化进 app binary,私钥仅在构建/发版时使用。理由:
- Tauri v2 updater 强制要求签名验证,无绕过选项
- minisign 签名短(64 bytes)、快、安全,比 RSA 更适合
- 上游 OpenCode 已验证此方案可行,DeskFox 只需换自己的密钥对

### B. Windows Inno → NSIS 切换

切回 Tauri 内置 NSIS,理由:
- Tauri updater 只支持 NSIS 格式安装包的自动更新(Inno 的安装路径/注册表结构不兼容)
- NSIS v2 自带 WebView2 bootstrapper,比 Inno 的手动 `[Code]` 检测更优
- 插件资源(feishu/media-gen)走 `tauri.conf.json bundle.resources`(macOS 已这么走,Win 对齐)
- 现在切和以后切代价一样,但拖到用户量大了再切多一步"存量迁移"

### C. latest.json 双 URL(OSS CDN + GitHub)

`latest.json` 的 `platforms` 条目 `url` 字段指向 OSS CDN(`dl.clawtray.com`)作为主 URL。理由:
- 国内用户走 CDN 秒下,GitHub 在 GFW 环境不稳定
- OSS URL 和 GitHub URL 指向同一文件内容,签名验证覆盖两种来源
- Tauri updater 支持 `endpoints` 数组,fallback 机制内置

### D. 存量迁移策略

NSIS 安装路径与 Inno 不同(`C:\Program Files\DeskFox` vs Inno 可能不同的路径),两版共存不冲突。用户手动卸载旧版即可。不做自动卸载(Inno 卸载需 Inno uninstaller,NSIS updater 无法调用)。可选:首次 NSIS 安装时检测旧 Inno 注册表项,弹非阻塞提示。

## 测试用例(自动化验收)

以下用例用于 `bun run test:e2e:tauri` / `bun run test:e2e:tauri-mac` 真桌面 e2e 验收,以及构建脚本断言验收。

### TC-1: UPDATER_ENABLED 翻转验证

**自动化方式**:构建后 DevTools Console 执行断言

```
// 预期:window.__OPENCODE__?.updaterEnabled === true
assert(window.__OPENCODE__?.updaterEnabled === true, "updaterEnabled should be true")
```

**验收**:PASS → R1 ✓

### TC-2: platform 接口存在性验证

**自动化方式**:DevTools Console 执行断言

```
assert(typeof platform.checkUpdate === "function", "checkUpdate should be a function")
assert(typeof platform.updateAndRestart === "function", "updateAndRestart should be a function")
```

**验收**:PASS → R1 ✓

### TC-3: macOS updater 端到端(真桌面 e2e)

**前置条件**:
1. 旧版 DeskFox(macOS)已安装(如 v2026.6.4.1)
2. `updates.deskfox.ai` 已部署新版本 `latest.json`(version > 当前版本)
3. 新版 `.app.tar.gz` + `.sig` 已上传到 OSS CDN

**自动化方式**:真桌面 e2e 测试(扩展 `e2e-tauri-mac/specs/` 或独立 `specs/updater-mac.spec.ts`)

```
1. 启动旧版 DeskFox .app
2. 等待 updater polling(或手动触发 Settings "Check now")
3. 断言:toast 出现,含 "Install & Restart" 按钮
4. cliclick 点击 "Install & Restart"
5. 等待下载 + 安装 + relaunch(超时 120s)
6. 验证新版本:读 Info.plist CFBundleShortVersionString === latest.json 中的 version
7. teardown
```

**验收**:全流程 PASS → R2 ✓

### TC-4: macOS 无更新时静默

**前置条件**:`latest.json` version === 当前版本

**自动化方式**:

```
1. 启动最新版 DeskFox .app
2. 等待 30s(updater check 间隔)
3. 断言:无 toast 弹出 / 无网络错误 / Settings "Check now" 返回 "You're up to date"
```

**验收**:PASS → R8 ✓

### TC-5: Windows NSIS installer 构建

**自动化方式**:构建脚本断言(`pack-installer.ps1` 后验证)

```
1. 运行 pack-installer.ps1 -Env prod
2. 断言:产物目录存在 NSIS .exe(非 Inno .exe)
3. 断言:.exe 文件名符合 Tauri NSIS 命名规范
4. 断言:对应 .exe.sig 文件存在
5. 断言:DeskFox.iss 文件不存在(已删)
```

**验收**:PASS → R3 ✓

### TC-6: Windows NSIS 安装体验

**自动化方式**:真桌面 e2e(扩展 `e2e-tauri/specs/` 或独立 `specs/updater-win.spec.ts`)

```
1. 运行 NSIS .exe 安装器
2. 断言:安装完成(注册表项存在 / 应用目录存在 / .exe 文件存在)
3. 启动 DeskFox.exe
4. 断言:应用启动成功(sidecar healthy)
5. 断言:桌面图标存在
6. 断言:控制面板显示正确 AppName/AppVersion
```

**验收**:PASS → R3 ✓

### TC-7: latest.json 格式与内容

**自动化方式**:部署后 HTTP 断言

```
1. GET https://updates.deskfox.ai/v1/latest/desktop/latest.json
2. 断言:response status 200
3. 断言:JSON 含 "platforms" key
4. 断言:"platforms" 含 "darwin-aarch64-app" 条目
5. 断言:该条目含 "url"(指向 dl.clawtray.com 或 github.com)和 "signature"(非空字符串)
6. 断言:该条目 "url" 指向的文件可 HEAD 200(文件存在)
7. 断言:"version" 字段 semver 格式正确
```

**验收**:PASS → R4 ✓

### TC-8: minisign 签名验证(离线)

**自动化方式**:构建产物断言

```
1. 读取 .app.tar.gz.sig / .exe.sig 内容
2. 用 minisign-verify 或 deskfox 公钥验证对应文件
3. 断言:签名验证通过
4. 用上游 anomalyco 公钥验证同一文件
5. 断言:签名验证失败(确认密钥已切换)
```

**验收**:PASS → R5 ✓

### TC-9: pubkey 替换验证

**自动化方式**:构建产物断言

```
1. 读取 tauri.prod.conf.json plugins.updater.pubkey
2. 断言:pubkey !== 上游 anomalyco 公钥(dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEYwMDM5Nzg5OUMzOUExMDQKUldRRW9UbWNpWmNEOENYT01CV0lhOXR1UFhpaXJsK1Z3aU9lZnNtNzE0TDROWVMwVW9XQnFOelkK)
3. 断言:pubkey 是合法 minisign 公钥格式(base64 解码后含 "untrusted comment: minisign public key" 前缀)
```

**验收**:PASS → R5 ✓

### TC-10: sidecar env guard 移除

**自动化方式**:代码断言(typecheck + grep)

```
1. grep packages/desktop/src-tauri/src/cli.rs 无 OPENCODE_DISABLE_AUTOUPDATE
2. 断言:envs vec 不含 ("OPENCODE_DISABLE_AUTOUPDATE", "true")
3. typecheck 全绿
```

**验收**:PASS → R6 ✓

### TC-11: 存量 Inno 用户迁移(手动验收)

**自动化方式**:无法全自动(Inno uninstaller 是 GUI 操作),改为半自动验证

```
1. 在已有 Inno 版 DeskFox 的 Windows 机器上安装 NSIS 版
2. 断言:两版共存(控制面板出现两个 DeskFox 条目,AppId 不同)
3. 断言:NSIS 版可正常启动和使用
4. 手动:在控制面板卸载旧 Inno 版
5. 断言:卸载后 NSIS 版仍正常运行
```

**验收**:PASS → R7 ✓

### TC-12: typecheck + e2e 回归

**自动化方式**:CI 级断言

```
1. bun typecheck 全绿(17/17 packages)
2. bun run --cwd packages/app test:e2e(phase 1 mock)全绿
3. bun run --cwd packages/app test:e2e:tauri-mac(phase 2 Mac)全绿(如有)
4. bun run --cwd packages/app test:e2e:tauri(phase 2 Win)全绿(如有)
```

**验收**:PASS → R8 ✓

## 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| minisign 私钥泄露 | 低(CI Secrets 管理) | 高(任何人可签伪造更新) | 私钥不入仓 / CI Secrets 加 access restrict / 轮转方案备用 |
| OSS CDN 下载 URL 签名不匹配 | 低(同一文件) | 中(用户无法更新) | 部署前 TC-8 离线验签覆盖 OSS URL |
| NSIS 安装体验不如 Inno | 中(NSIS 定制性弱于 Inno) | 中(用户吐槽) | TC-6 验证关键体验点;可接受的小差异 |
| 存量 Inno 用户不知道要卸旧版 | 中 | 低(两版共存不冲突,只是占磁盘) | R7 可选提示;README/社区帖指引 |
| 上游 rebase 冲突(constants.rs/index.tsx/menu.ts 都是 FORK marker 改过的地方) | 中 | 中(需手工合并) | FORK marker 显性化,P5 可见 |
| `updates.deskfox.ai` 服务不可用 | 低(Tokyo nginx static) | 高(无法检查更新) | Tauri updater endpoints 数组可加 GitHub fallback URL |

## 关联

- 前序 feat:`禁自动升级`(三层防御,本次翻转)
- 设计文档:`docs/design-telemetry-and-update.md`(DeskFox 更新基础设施架构)
- 需求文档:`docs/requirements-telemetry-and-update.md`(G3 用户可达升级)
- 构建脚本:`packages/branding/scripts/build-deskfox.sh` / `build-deskfox.ps1`
- 上游 finalize:`packages/desktop/scripts/finalize-latest-json.ts`(需改或写 DeskFox 版)