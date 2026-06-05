---
feat-id: 启用自动升级
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 启用自动升级 — changelog

**关联 commit**: feat/enable-updater 分支(WIP checkpoint,2026-06-05)
**所在分支**: feat/enable-updater(从最新 main 535712619 起)
**baseline tag**: 沿用线
**触发原因**: 前序 feat `禁自动升级` 关闭了所有上游自动升级入口(三层防御),防止 DeskFox 被覆盖。现在 DeskFox 自有更新基础设施已就绪,需反向操作:启用 DeskFox 自家更新通道,让用户收到新版本通知并一键升级。同时 Windows 安装包从 Inno Setup 切换到 Tauri NSIS 以获得 updater 全自动兼容。详见 `1-spec.md` 触发原因段。

## 实际改动

### `packages/desktop/src-tauri/src/constants.rs`(+9 / -1)

- `UPDATER_ENABLED: bool = true`(hard-code 翻转,加 FORK marker 说明"前序 feat 禁自动升级翻 false,本 feat 反向翻 true")
- 移除依赖 `option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some()` 的条件判断(前序 feat 用此做"运气好"兜底,本 feat 不需要——DeskFox 有自己的密钥)
- 注释保留设计意图:FORK marker + 两个 feat 的决策链

### `packages/desktop/src-tauri/src/cli.rs`(无改动 — 决策推翻)

- **2026-06-05 user 拍板:保留 Layer 3 防御,撤销原 env guard 移除改动**
- 理由:Tauri updater 在外壳层工作,与 CLI sidecar 自升级(通道 B)是两条独立通道;删 `OPENCODE_DISABLE_AUTOUPDATE` 不是启用 Tauri updater 的必要条件,反而重开通道 B(上游 CLI 自更新替换 opencode 二进制)。保留这层纵深防御是白送的安全垫。
- 结果:cli.rs 回到前序 feat `禁自动升级` 状态,`OPENCODE_DISABLE_AUTOUPDATE=true` env 守卫保留

### `packages/desktop/src-tauri/tauri.prod.conf.json` / `tauri.beta.conf.json`(无改动 — 架构修正)

> **2026-06-05 重大修正**:初版把 updater pubkey/endpoint 改进这两个文件,**既违 R4 黑名单(它们是上游文件)、又改错了层**。
>
> 实证:这两个 conf **只被 `.github/workflows/publish.yml`(上游 CI)消费**(line 352 `--config tauri.{prod,beta}.conf.json`);DeskFox 发版走本地 `build-deskfox.ps1` = `--config tauri-overrides/$Env.json`,**根本不加载这两个文件**。改它们对 DeskFox 实际产物零效果。
>
> R4 黑名单 pre-commit 闸拦下了这笔改动 → 复查发现 wrapper(`tauri-overrides/`)替代**完全可行**,故**不走 override**,改用 wrapper(见下)。两个上游 conf 已 `git restore` 回 upstream 值,FORK 0 侵入。

### `packages/branding/tauri-overrides/{prod,beta,dev}.json`(fork wrapper — updater 配置正确落点)

- 三档各加 `plugins.updater`:`pubkey`(DeskFox minisign 公钥规范 base64,key ID `2733888977867EB0`)+ `endpoints`(prod=`updates.deskfox.ai/v1/latest/desktop/latest.json` / beta=`desktop-beta/...` / dev=`desktop-dev/...`)
- prod/beta 额外加 `bundle.createUpdaterArtifacts: true`(产 `.sig` + `.app.tar.gz` 更新产物;**此字段原也只在上游 conf 里,fork 构建拿不到 → 不补则永远不产签名产物**)。dev 是 Tier 3 本地测试,不产更新产物,不加
- prod 另含 `bundle.windows.nsis.installerIcon`(prod icon,前序已在)
- Tauri `--config` 对 `plugins` 做深合并,基座 `deep-link` 保留不丢
- pubkey 统一为 `minisign.pub` 文件的规范 base64(修初版 `867EA0` typo + CRLF → `867EB0` + LF);密钥本体一致,验签行为不变

### `packages/desktop/src-tauri/tauri.conf.json`(+4 / -0)

- `nsis.languages` 加 `["English", "SimpChinese"]`(中英双语安装界面)
- `nsis.installMode` 设 `"currentUser"`(免管理员权限)
- 移除无效 `nsis.desktopShortcut` 字段(Tauri v2 NSIS schema `deny_unknown_fields`,NSIS 默认创建桌面快捷方式)

### `packages/desktop/minisign.pub`(新文件)

- DeskFox minisign 公钥入仓(公钥 ID `2733888977867EB0`,明文 `RWSwfoZ3iYgzJxWzlZlKUYnZjv1ZF0Wybsx9oPMkiFo3s/2PtiqJ/8zz`)
- 私钥 canonical 位置:`~/.deskfox-signing/config.env` 的 `TAURI_SIGNING_PRIVATE_KEY`(build-deskfox.ps1 从此读,与 Apple 签名配置同文件)。绝不入仓(`.gitignore *.key`)
- ⚠️ **待办**:`D:\tmp\windows-temp\opencode\minisign-keys\minisign.key` 是生成时的散落副本(临时目录,有丢失风险);user 离线备份 config.env 后清掉该副本。私钥一旦丢失 = 永远无法给已装客户端推更新(公钥已编进 binary)

### `packages/branding/installer/DeskFox.iss`(删除 153 行)

- Inno Setup 脚本整删(NSIS 不需要)

### `packages/branding/installer/ChineseSimplified.isl`(删除 418 行)

- Inno 中文语言包整删(NSIS 自带 SimpChinese)

### `packages/branding/scripts/pack-installer.ps1`(重写 98 行)

- 去掉 ISCC(Inno Setup Compiler)调用步骤
- 改为 tauri build 产出 NSIS .exe
- 签名步骤保留(Azure Trusted Signing,非 GH Actions 环境跳过)

### `packages/branding/scripts/bump-installer-version.ps1`(+21 / -6)

- 去掉 `.iss AppVersion` 更新步骤(Inno 已删)
- 只更新 `installer-versions.json` + `installer-versions.md`

### `packages/branding/scripts/build-deskfox.ps1`(+19 行)

- 加 `TAURI_SIGNING_PRIVATE_KEY` env 注入逻辑(从 `~/.deskfox-signing/config.env` 读取)
- Tauri build 用此 env 签 updater .sig 文件(配合 override 里的 `createUpdaterArtifacts: true`)

### `packages/branding/scripts/finalize-latest-json.ts`(新文件)

- DeskFox 版 `latest.json` 生成脚本
- 从本地构建目录读 NSIS .exe + .sig,生成 Tauri updater 格式的 `latest.json`
- 对称上游版本(从 GitHub Release API 读 assets),本版从本地文件系统读

(tauri-overrides 三档的 updater 改动见上文「fork wrapper」段)

### `packages/branding/__tests__/updater-config.test.ts`(新文件)+ `package.json` 加 `"test": "bun test"`

- 11 个静态断言(`bun:test`,无需 build),守护本 feat 三类 bug 回归:
  - updater 配置必须在 `tauri-overrides/*`(fork 实际加载层),pubkey == minisign.pub 且 != 上游 anomalyco
  - prod/beta `createUpdaterArtifacts=true`;endpoint 指 updates.deskfox.ai
  - `constants.rs UPDATER_ENABLED=true` + `cli.rs` 保留 `OPENCODE_DISABLE_AUTOUPDATE`(Layer3)
- 对应 TC-9 / TC-10;branding 包首次引入测试基础设施

### 文档

- `docs/features/启用自动升级/{1-spec,2-plan,3-changelog}.md`(新建)
- `docs/features/INDEX.md` 索引行(待追加)

## 行数

| 项 | 行数 |
|---|---|
| `constants.rs` | +9 / -1(上游 edit,FORK marker) |
| `cli.rs` | 0(改动已撤,Layer3 保留) |
| `tauri.prod.conf.json` / `tauri.beta.conf.json` | 0(改动已撤,回 upstream — 改错层 + 黑名单) |
| `tauri.conf.json` | +4 / -0(base nsis languages/installMode,非黑名单) |
| `tauri-overrides/prod.json` | +13(updater + createUpdaterArtifacts + installerIcon) |
| `tauri-overrides/beta.json` | +10(updater + createUpdaterArtifacts) |
| `tauri-overrides/dev.json` | +7(updater) |
| `minisign.pub` | 新 +2 |
| `DeskFox.iss` | 删 -153 |
| `ChineseSimplified.isl` | 删 -418 |
| `pack-installer.ps1` | 重写 ~98 |
| `bump-installer-version.ps1` | +21 / -6 |
| `build-deskfox.ps1` | +19 |
| `finalize-latest-json.ts` | 新 +~120 |
| **代码** | 净删约 570 行(主要 Inno 删除),功能新增约 100 行(fork-only:overrides + scripts + finalize) |
| 文档(新文件,不计阈值)| ~400 行 |

**0 上游侵入**:唯一上游 edit 是 `constants.rs`(1 行翻转 + FORK marker);conf/cli 改动全撤回。其余全是 fork-only 文件。

## 影响范围

- ✅ 编译时 `UPDATER_ENABLED=true`,updater plugin 注册(Tauri 构建时自动启用)
- ✅ JS 平台接口暴露 `checkUpdate` / `update`(前序 feat 的条件 spread 自动生效——true 时 spread 进,无需改 index.tsx/menu.ts)
- ✅ macOS 菜单"Check for Updates..."出现 / Settings 更新 section 启用 / polling / error 页升级按钮均可触达(条件 spread true 自动亮)
- ✅ **updater pubkey/endpoint 落在 fork 实际使用的 `tauri-overrides/*`**(修正初版改错层的 bug);`createUpdaterArtifacts` 同步补齐,prod/beta build 才真产 `.sig`
- ✅ Sidecar env guard **保留**(Layer 3 不删,通道 B 仍阻断,纵深防御)
- ✅ Windows NSIS 安装包替代 Inno Setup(中英双语 + currentUser installMode)
- ✅ minisign 公钥入仓,私钥在 `~/.deskfox-signing/config.env`
- ⚠️ `updates.deskfox.ai` 后端需部署 Tauri updater 格式的 `latest.json`(当前只有 telemetry 自定义格式)— **未做,updater check 现会失败**
- ⚠️ updater 端到端(TC-1/2/3)+ NSIS installer 真桌面验收未做(本机 Windows 验不了 mac;需后端就绪)

## 回归测试点

- **R1 编译时硬开** — DevTools `window.__OPENCODE__?.updaterEnabled` 应返 `true` → ✅(constants.rs hard-code true)
- **R2 设置面板 Updates 段可见且可操作** — 代码层条件 spread true 时 checkUpdate/update 存在 → UI 自动启用(待真桌面验收)
- **R3 macOS 菜单"Check for Updates..."出现** — 条件 spread true 时菜单项渲染(本机 Windows 不验 macOS 菜单;代码层确认)
- **R4 polling 启动** — `useUpdatePolling` guard `platform.checkUpdate` 存在 → 不短路 → polling 启动(待真桌面验收)
- **R5 错误页升级按钮** — 同 R2 逻辑
- **R6 sidecar env 保留** — `OPENCODE_DISABLE_AUTOUPDATE=true` **不移除**(2026-06-05 决策);Tauri updater 走外壳层独立于 CLI 通道 B
- **R7 Inno→NSIS 无回归** — NSIS 配置(languages/installMode)已验证,DeskFox.iss 删除后 Inno 路径彻底不存在
- **R8 typecheck 全过** — ✅ 17/17 packages 全绿(2026-06-05 实测)

## review 自检

- [x] **唯一上游 edit = constants.rs(1 行 + FORK marker)**;cli.rs / prod conf / beta conf 改动全撤回,回 upstream → 0 黑名单触动
- [x] updater 配置走 fork wrapper(`tauri-overrides/*`),非上游 conf → 符合 R3/P3,无需 R4 override
- [x] base `tauri.conf.json` nsis 改动(非黑名单)无 schema 变更
- [x] 无新增依赖
- [x] typecheck 全过(17/17,2026-06-05 实测)
- [x] 前序 feat 三层防御:Layer1→翻 true / Layer2→条件 spread 自动生效 / Layer3→**保留**(2026-06-05 决策,纵深防御白送)
- [x] **R5 测试(部分)** — `packages/branding/__tests__/updater-config.test.ts`(11 tests,全绿)静态守护本次三类 bug:配置落点(override 非上游 conf)/ pubkey 正确(==minisign.pub、!=上游)/ Layer3 保留 + createUpdaterArtifacts + UPDATER_ENABLED。覆盖 TC-9 + TC-10
- [ ] **R5 测试(剩余)** — TC-8 签名验证 / TC-5 NSIS 产物断言(需 full bundle build);mac/win 真桌面 e2e(TC-1/2/3)待后端就绪 + mac 机器

## 已知遗留

- **`updates.deskfox.ai` 后端(2026-06-05 实地探测)**:
  - 线上 **prod** `/v1/latest/desktop/latest.json` 返回**占位符** `{"version":"0.0.0","placeholder":true}` —— 缺 Tauri updater 必需的 `platforms` 字段 → updater check 失败
  - **beta** `/v1/latest/desktop-beta/latest.json` 和 **dev** `desktop-dev/...` → **404,未建**
  - ✅ endpoint 路径正确:`/v1/latest/desktop[-beta|-dev]/latest.json` 与 override 配置一致(注:`docs/design-telemetry-and-update.md` §6 写的 `/desktop/latest.json` 旧路径已过时,实际线上是 `/v1/latest/` 前缀)
  - **待办**:发一次真实签名版本 → `finalize-latest-json.ts` 生成 Tauri 格式 `latest.json`(`version`/`notes`/`pub_date`/`platforms.{windows-x86_64,darwin-aarch64}.{url,signature}`)→ SCP 到东京 `52.197.46.120:/var/www/updates/desktop/v1/latest/{desktop,desktop-beta,desktop-dev}/`。**需服务器 SSH 访问 + 一次真实 ship 产物**,非本机可独立完成
- **NSIS installer 完整产出**:DeskFox.exe raw binary 已成功构建(39MB),NSIS bundle 在非 GH Actions 环境需要 Azure Trusted Signing 配置才能产出完整安装包。本地开发环境可用 `build-deskfox.ps1` 的签名 env 注入
- **存量 Inno 用户迁移**:NSIS 安装新路径(`DeskFox/`),两版共存不冲突,用户手动卸旧版。首次 NSIS 安装后需用户引导卸载 Inno 版本

## 走过的弯路 / 中途调整

(见 2-plan.md "走过的弯路 / 中途调整" 段)

## 回退方法

```
git revert <code commit hash>
```

恢复前序 feat `禁自动升级` 的三层防御即可回退:
- `constants.rs` UPDATER_ENABLED → false
- `cli.rs` envs vec 加回 `("OPENCODE_DISABLE_AUTOUPDATE", "true")`
- pubkey/endpoint 改回上游值(或删除 updater section)

NSIS 配置和 Inno 删除可保留(NSIS 是长期正确方向),回退只需恢复 Layer1+3 防御。