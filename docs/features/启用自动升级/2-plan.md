---
feat-id: 启用自动升级
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 启用自动升级 — plan

> spec 锁版后开干。本文档实时追加 note(踩坑 / 方案推翻),开发完成后 1-spec 不改、2-plan 补全、3-changelog 总览。

## 总目标

按 1-spec R1-R8 + TC-1 至 TC-12 实施,约 3-5 天完工(单人 Claude + user 拍板节奏)。

## 阶段拆分

### 阶段 0:密钥生成(~15 min)

- [ ] 生成 DeskFox minisign 密钥对:`minisign -G -p minisign.pub -P minisign.key`
- [ ] 私钥存入发版机 `~/.deskfox-signing/minisign.key`(不入仓)或 CI Secrets
- [ ] 公钥 `minisign.pub` 放入 `packages/desktop/minisign.pub`(入仓)
- [ ] 验证:用私钥签一个小文件 → 用公钥验签 → 通过

### 阶段 1:共享改动 — UPDATER_ENABLED 翻转 + pubkey 替换(~0.5 天)

#### 1.1 `constants.rs` — 翻转 UPDATER_ENABLED

改前:
```rust
// FORK: updater backend 总开关 — 当前 false 防 DeskFox 被上游 OpenCode 整壳替换。
// 未来 fork 自家 updater(DeskFox 自有 update 服务)上线时翻 true,index.tsx 内
// createPlatform 把 check()/install() 换成 DeskFox API 即可,UI 层(menu/settings/
// polling/error)无需改动,自动亮(updater-disable-adapter 2026-05-03)
pub const UPDATER_ENABLED: bool = false;
```

改后:
```rust
// FORK: updater backend 总开关 — 从 false 翻 true,启用 DeskFox 自家 updater(启用自动升级)。
// 前序 feat 禁自动升级 硬关了所有上游通道(防 DeskFox 被整壳替换);现在密钥/endpoint/
// latest.json 全部切换到 DeskFox 自有体系,安全底线守住。[启用自动升级] 2026-06-05
pub const UPDATER_ENABLED: bool = true;
```

#### 1.2 `tauri.prod.conf.json` / `tauri.beta.conf.json` — pubkey + endpoint 替换

改前(prod):
```json
"plugins": {
  "updater": {
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEYwMDM5Nzg5OUMzOUExMDQK...",
    "endpoints": ["https://github.com/anomalyco/opencode/releases/latest/download/latest.json"]
  }
}
```

改后(prod):
```json
"plugins": {
  "updater": {
    "pubkey": "<DeskFox minisign pubkey base64>",
    "endpoints": ["https://updates.deskfox.ai/v1/latest/desktop/latest.json"]
  }
}
```

beta 同理,endpoint 改 beta 路径。

#### 1.3 `cli.rs` — 移除 sidecar env guard

移除 `("OPENCODE_DISABLE_AUTOUPDATE", "true")` env 注入(Layer 3 双保险不再需要,Tauri updater 负责升级,CLI 层不需要额外阻断)。加 FORK marker 说明移除原因。

#### 1.4 验证 TC-1 / TC-2 / TC-9 / TC-10

构建 dev 版 → DevTools Console 验 `updaterEnabled === true` / `platform.checkUpdate` 存在 / pubkey 已换 / env guard 已移除。

### 阶段 2:Windows Inno → NSIS 切换(~1 天)

#### 2.1 删除 Inno Setup 文件

- 删除 `packages/branding/installer/DeskFox.iss`
- 删除 `packages/branding/installer/ChineseSimplified.isl`

#### 2.2 tauri.conf.json nsis 配置补齐

`tauri.conf.json` / `tauri.prod.conf.json` / `tauri.beta.conf.json` 加 NSIS 配置:

```json
"windows": {
  "nsis": {
    "installerIcon": "icons/<env>/icon.ico",
    "headerImage": "assets/nsis-header.bmp",
    "sidebarImage": "assets/nsis-sidebar.bmp",
    "languages": ["English", "SimpChinese"],
    "desktopShortcut": true,
    "installerMode": "currentUser"
  }
}
```

三档 AppId/GUID 在 Tauri NSIS 里通过 `identifier` 区分(已配置:prod `ai.deskfox.app` / dev `ai.deskfox.app.dev` / beta `ai.deskfox.app.beta`),不需要 Inno 的手动 `#define AppId`。

#### 2.3 bundle.resources 对齐

飞书/media-gen plugin 资源已在 `tauri.conf.json bundle.resources` 里(macOS 路径生效),Win 端 Tauri NSIS 同样走 resources,不需要 Inno `[Files]` 段手动列举。**无需改动**。

#### 2.4 pack-installer.ps1 改造

去掉 `ISCC.exe` 编译步骤,改为:
1. bump-installer-version.ps1(保留,bump `installer-versions.json` + `docs/installer-versions.md`)
2. `build-deskfox.ps1 -Env prod`(tauri build 直接产出 NSIS `.exe` + `.exe.sig`)
3. 产物路径从 `Output\DeskFox-<ver>-setup.exe` 改为 `target/release/bundle/nsis/DeskFox-<ver>-setup.exe`(或 Tauri 标准命名)
4. `.iss` bump 步骤移除(macOS 的 bump 不涉及 `.iss`)

#### 2.5 bump-installer-version.ps1 调整

移除 `.iss AppVersion` 更新步骤(不再有 `.iss` 文件),只保留 `installer-versions.json` + `installer-versions.md` 更新。

#### 2.6 LO bundle — Windows 对齐 macOS 方案

`build-deskfox.ps1` 加 LO bundle 条件注入(对称 `build-deskfox.sh` 步骤 1.9):
- 检测 `branding/libreoffice-bundle/windows/` 存在
- 通过 Tauri `--config` 动态注入 `bundle.resources`
- NSIS installer 自动打入

#### 2.7 验证 TC-5 / TC-6

构建 prod NSIS → 验产物格式 → 安装 → 启动 → 验功能。

### 阶段 3:构建流程签名 + latest.json 生成(~1 天)

#### 3.1 build 流程加 TAURI_SIGNING_PRIVATE_KEY

`build-deskfox.ps1` / `build-deskfox.sh` 加签名 env 注入:
- 从 `~/.deskfox-signing/config.env` 读取 `TAURI_SIGNING_PRIVATE_KEY`(或 CI Secrets)
- `createUpdaterArtifacts: true` 已配置,设置 env 后 Tauri 自动产出 `.sig` 文件

#### 3.2 创建 DeskFox 版 finalize-latest-json.ts

`packages/branding/scripts/finalize-latest-json.ts`(新文件,DeskFox 版,不改上游原文件):

- 适配 DeskFox 产物命名(NSIS `.exe` / `.app.tar.gz`)
- `url` 字段优先指向 OSS CDN(`dl.clawtray.com`),GitHub 作为 source
- 读取 `.sig` 文件内容写入 `signature` 字段
- 支持 prod / beta 两种 channel

#### 3.3 ship SOP 加 latest.json 步骤

`docs/governance/ship.md`(或相关 SOP)加:
1. 构建后签名验证(TC-8)
2. 运行 `finalize-latest-json.ts` 生成 `latest.json`
3. 上传 `latest.json` 到 GitHub Release
4. SCP `latest.json` 到 Tokyo `updates.deskfox.ai:/var/www/updates/desktop/latest.json`

#### 3.4 验证 TC-7 / TC-8

部署 latest.json → HTTP 断言 → 签名验证。

### 阶段 4:真桌面 e2e 测试用例编写(~1 天)

#### 4.1 macOS updater e2e(`specs/updater-mac.spec.ts`)

扩展 `packages/app/e2e-tauri-mac/specs/`,或独立 spec:
- TC-3:updater 端到端(需 mock latest.json 指向测试版)
- TC-4:无更新时静默

前置:需要测试版 `.app.tar.gz` + `.sig` + 测试 `latest.json` 部署到测试端点。

#### 4.2 Windows updater e2e(`specs/updater-win.spec.ts`)

扩展 `packages/app/e2e-tauri/specs/`,或独立 spec:
- TC-3(Win 版):NSIS updater 端到端
- TC-6:NSIS installer 验证

#### 4.3 构建断言脚本

`packages/branding/scripts/verify-updater-artifacts.ts`(新):
- TC-5:NSIS 构建产物断言
- TC-8:签名验证
- TC-9:pubkey 替换断言
- TC-10:env guard 移除 grep 断言

### 阶段 5:真桌面端到端实测(~0.5 天)

- [ ] macOS:旧版 → 检测新版 → 一键更新 → 验新版本
- [ ] Windows:旧版 → 同流程
- [ ] Windows:存量 Inno 版共存验证(TC-11)
- [ ] TC-12:typecheck + e2e 回归全绿

### 阶段 6:文档收尾 + 回归(~0.3 天)

- [ ] `3-changelog.md` 填实际 commit hash + 行数 + 影响范围 + 回归测试 + 回退方法
- [ ] `docs/features/INDEX.md` 加本 feat 行
- [ ] `bun typecheck` 全绿
- [ ] 现有 e2e 回归全绿

## 决策轨迹

| 决策点 | 选项 | 取舍 | 理由 |
|---|---|---|---|
| 签名方案 | A. minisign / B. 自研签名 / C. 不签名 | A | Tauri v2 强制要求;minisign 是标准方案;上游已验证可行 |
| Windows installer | A. 切 NSIS / B. 保持 Inno + 手动提示 | A | 长远必须切;现在切代价最小;NSIS v2 功能已够 |
| latest.json URL | A. 仅 GitHub / B. 仅 OSS / C. OSS 主 + GitHub fallback | C | 国内走 CDN,海外 fallback;Tauri endpoints 数组天然支持 |
| 存量 Inno 迁移 | A. 自动卸载 / B. 共存 + 手动卸载 / B+. 弹提示 | B+ | Inno uninstaller 是 GUI 操作,NSIS 无法调用;共存不冲突;非阻塞提示可选 |
| e2e 测试范围 | A. 仅构建断言 / B. 真桌面 updater e2e | B | 核心功能需要真桌面验证;构建断言作为 CI gate |

## 预算

| 项 | 行数估算 |
|---|---|
| `constants.rs` | ~5 行(翻转 + FORK marker) |
| `tauri.prod.conf.json` / `tauri.beta.conf.json` | ~4 行(pubkey + endpoint 替换) |
| `cli.rs` | ~7 行(移除 env guard + FORK marker) |
| 删除 Inno 文件 | -153 行(DeskFox.iss + ChineseSimplified.isl) |
| `tauri.conf.json` nsis 配置 | ~15 行(各环境) |
| `pack-installer.ps1` 改造 | ~30 行改动 |
| `bump-installer-version.ps1` 调整 | ~10 行改动 |
| `build-deskfox.ps1` LO + signing | ~20 行改动 |
| `finalize-latest-json.ts`(新) | ~150 行 |
| `verify-updater-artifacts.ts`(新) | ~80 行 |
| e2e spec 文件(2 个) | ~200 行 |
| **代码 staged** | **~350 行净增**(扣除删 Inno) |
| 文档(本目录三件) | ~500 行 |

Medium 规格(改动跨 Rust/TS/PS1/JSON/ISS,触动上游文件 5 个,但都是 fork-only 改动 + FORK marker)。

## 实施期间 note(实时追加)

> 此区开发中实时填,记踩坑 / 方案推翻 / 关键决策。spec 不改,plan 滚动更新。

### 2026-06-05 评审 + 三项决策修正(user 拍板)

初版改动(未 commit)经评审发现三处问题,已修正:

1. **私钥保管** → 决策:挪永久位置 + 备份。查明私钥**已在** `~/.deskfox-signing/config.env`(build 脚本即从此读),`D:\tmp\windows-temp\...\minisign.key` 只是散落副本。待 user 离线备份后清副本。

2. **Layer 3 防御** → 决策:**保留**(撤销原 cli.rs env guard 移除)。Tauri updater 走外壳层,与 CLI 自升级(通道 B)独立,删守卫非必要且重开攻击面。`git restore cli.rs` 还原。

3. **🔴 updater 配置改错层(最严重)** → 原方案把 pubkey/endpoint 改进 `tauri.{prod,beta}.conf.json`:
   - **R4 黑名单 pre-commit 闸拦下** → 复查发现这两个是**上游文件**,且只被 `.github/workflows/publish.yml`(上游 CI,line 352)消费
   - DeskFox 发版走本地 `build-deskfox.ps1 --config tauri-overrides/$Env.json`,**根本不加载这两个 conf** → 原改动对实际产物零效果
   - `createUpdaterArtifacts: true` 同样只在上游 conf 里,fork 构建拿不到 → 不补则永不产 `.sig`
   - **正解(wrapper 可行 → 不走 override)**:updater 配置(pubkey + endpoints + createUpdaterArtifacts)移入 `tauri-overrides/{prod,beta,dev}.json`;两个上游 conf `git restore` 回 upstream。0 黑名单触动,符合 R3/P3。
   - 教训:**fork 改 Tauri 配置前先确认 build 链实际加载哪个 config**;R4 黑名单闸这次直接挡下一个功能性 bug,验证了 wrapper-first 原则的价值。

4. pubkey 注释 typo(`867EA0` vs `.pub` 的 `867EB0`)+ CRLF → 统一为 `minisign.pub` 文件规范 base64(密钥本体一致,验签不变)。

待办(本分支内 merge 前):后端 `latest.json` 部署 + 补测试(TC-5/8/9 本机可做,TC-1/2/3 真桌面)。

### 2026-06-06 本机验收收尾(开发任务完成)

按 R8/R9,把本机可自动化验收的全部跑通后才提 merge。本轮完成:

1. **清理上次中断 build 的工作区残留** — `tauri.conf.json`(version=2026.6.0 + 剥 signCommand)和 `icons/`(prod/dev)是被中断 build 临时改入、没跑到 `git checkout HEAD` restore 的产物(脚本 build 后无条件还原,设计上 git 永不持有这些),`git checkout HEAD` 还原。
2. **minisign 密钥重生成 commit** — 之前散在工作区未提交,正式 commit(`d6f14896e`,key `CB2CEF2CBA58C99F`)。
3. **prod 完整 build** — `build-deskfox.ps1 -Env prod` 产出 NSIS 62.7MB + `.sig`(密钥重生成后 `.sig` 首次成功产出)。
   - 踩坑:首次后台 build 用 `*> $log` 重定向触发 PS5.1 经典坑——native 命令(bun)往 stderr 写 banner,在 `$ErrorActionPreference=Stop` 下被包成 NativeCommandError → 脚本 abort exit 1。**不重定向**(让 harness 自身捕获)即正常。
4. **新增两个测试交付物**(commit `1a870420f`):
   - `verify-updater-artifacts.ts` — 构建产物断言,纯 Node crypto(无外部 minisign 依赖):TC-5/8/9,8/8 通过。TC-8 按 minisign 签名算法字节(`Ed`纯/`ED` blake2b 预哈希)选模式做 Ed25519 全量验签,确定性、无歧义。
   - `updater-cdp.spec.ts` — e2e-tauri CDP 真桌面运行时:TC-1(updaterEnabled)/ TC-2(invoke check 命中线上 endpoint 返 null),2/2 通过。
5. **剩余硬件阻塞**:TC-3(mac 一键安装,需 Mac)/ TC-6(win NSIS 真安装体验)/ TC-11(Inno 共存)。merge 到 main + 真机/Mac 验收待 user 决定(三铁律:merge 需 user 同意)。