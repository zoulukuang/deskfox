---
feat-id: 启用自动升级
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 启用自动升级 — changelog

## ✅ 本机自动化验收矩阵(2026-06-06)

| TC | 验什么 | 手段 | 结果 |
|---|---|---|---|
| TC-1 | updaterEnabled 运行时为 true | CDP(updater-cdp.spec.ts) | ✅ 真二进制 `window.__OPENCODE__.updaterEnabled===true` |
| TC-2 | updater 插件注册 + 活管线 | CDP invoke `plugin:updater|check` | ✅ 命中线上 endpoint 返「无更新」(全链路通) |
| TC-4 | 当前版本静默无更新 | 同 TC-2(版本相等→null) | ✅ |
| TC-5 | NSIS .exe + .sig 产出 | verify-updater-artifacts.ts | ✅ `DeskFox_2026.6.0_x64-setup.exe`(62.7MB)+ `.sig` |
| TC-7 | 后端 latest.json 格式 | curl 三档×三平台 | ✅ 9/9 HTTP 200 + 合法 Tauri 格式 |
| TC-8 | minisign 离线验签 | verify-updater-artifacts.ts(Node crypto) | ✅ key ID 匹配 + Ed25519 全量验签安装包字节 |
| TC-9 | pubkey 替换(!=上游) | 单测 + verify 脚本 | ✅ |
| TC-10 | Layer3 守卫保留 | updater-config.test.ts | ✅(spec 已反转为"保留") |
| TC-12 | typecheck + 测试回归 | bun typecheck + bun test + e2e | ✅ 17/17 typecheck + 13 单测 + 2 e2e 全绿 |
| TC-3 | macOS 一键升级端到端 | 真桌面 e2e | ⛔ 需 Mac + 真实发新版本 |
| TC-6 | Windows NSIS 真安装体验 | 真桌面 e2e | ⛔ 需真机跑 installer 安装 |
| TC-11 | 存量 Inno 共存迁移 | 半自动 | ⛔ 需双版本同机 + Inno GUI 卸载 |

**结论**:本机可自动化验收的全部通过(**2026-06-06 三次重生成密钥 `2A008F3DA4940FDE`【带密码】根治 Windows 空密码传不进子进程导致的 build 弹 `Password:` + 偶发签名失败;prod 完整 build 构建期直接签出 `.sig`、无提示,`verify-updater-artifacts.ts` 8/8 通过** — TC-5/8/9 结论以此密钥为准,前两把 CB2C/1B29 旧结论作废);剩 3 项硬件/真机阻塞,需 Mac 机或真实安装流程,非本分支本机可独立完成。

**关联 commit**: feat/enable-updater 分支(2026-06-06 本机验收完成)
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

- 三档各加 `plugins.updater`:`pubkey`(DeskFox minisign 公钥,**key ID `2A008F3DA4940FDE`**,2026-06-06 三次 `tauri signer generate` 重生成【带密码】 — 见下「签名密钥重生成 → 三次重生成」)+ `endpoints`(按 `{{target}}` 分平台:prod=`updates.deskfox.ai/v1/latest/desktop/{{target}}/latest.json` / beta=`desktop-beta/...` / dev=`desktop-dev/...`)
- prod/beta 额外加 `bundle.createUpdaterArtifacts: true`(产 `.sig` 更新产物;**此字段原也只在上游 conf 里,fork 构建拿不到 → 不补则永远不产签名产物**)。dev 是 Tier 3 本地测试,不产更新产物,不加
- prod 另含 `bundle.windows.nsis.installerIcon`(prod icon)
- Tauri `--config` 对 `plugins` 做深合并,基座 `deep-link` 保留不丢

### 签名密钥重生成(2026-06-05 — 修 .sig 产不出)

- **问题**:初版 minisign 密钥(`minisign -G` 生成,key ID `2733888977867EB0`)存进 `config.env` 的 `TAURI_SIGNING_PRIVATE_KEY` 是**裸二进制的 base64**(解码出 `Ed...`),而 Tauri 要的是**密钥文件文本的 base64**(解码出 `untrusted comment:...`)→ build 报 `failed to decode secret key` → **产不出 `.sig`,updater 无法升级**。
- **修法**:`tauri signer generate` 重新生成(无密码,格式 100% 对),key ID **`CB2CEF2CBA58C99F`**。同步更新 `config.env`(正确格式)+ `minisign.pub` + 三档 override pubkey + 重新离线备份。updater 从未上线 → 换密钥零风险。
- **实测**:prod 完整构建产出未签名 NSIS + `.sig`(见 R2/R8 验证)。

#### 二次重生成(2026-06-06 — 修 fresh shell 签名失败 + 显式密码注入)

- **问题**:CB2C 那次"8/8 验签通过"是**撞运气**——当时 shell 的 ambient env 恰好带着可用的密码状态。`build-deskfox.ps1` 在 Win 上**只 regex 抠了 `TAURI_SIGNING_PRIVATE_KEY`、漏了 `..._PASSWORD`**,fresh shell 一旦 ambient 密码缺失/串台,`createUpdaterArtifacts` 签名就报 `incorrect updater private key password: Wrong password` → 又产不出 `.sig`。Mac 端 `build-deskfox.sh` 用 `source config.env` 一次性导全部变量(含密码)天然没这病。
- **修法**:
  1. `build-deskfox.ps1` 显式从同一 `config.env` 加载 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`(空值也显式 `=""`,杜绝 ambient 旧密码串台);
  2. 再次 `tauri signer generate` 生成一把**全新无密码**密钥,key ID **`1B29DEBA03F02DAB`**,同步 `config.env` + `minisign.pub` + 三档 override pubkey + 离线备份。
- **实测(2026-06-06)**:① `tauri signer sign` 自测——新私钥+空密码签测试文件成功;② prod 完整构建产出 NSIS 安装包 + `.sig`,新密钥首次在 fresh 流程下稳定签出;③ `verify-updater-artifacts.ts` **8/8 通过**(签名 key ID == `minisign.pub` key ID,Ed25519 对安装包字节全量验签通过)。CB2C 的旧验签结论作废,以本次新密钥结论为准。

#### 三次重生成(2026-06-06 — 根治:密钥【带密码】消除 build 弹 `Password:` + 偶发失败)

- **根因(终于定位)**:二次方案的"空密码"在 Windows 上**根本传不到签名子进程**。实测 PowerShell `$env:X = ""` / `.NET SetEnvironmentVariable(...,'','Process')` 在 Windows 上**等于删除变量**(子进程 `GetEnvironmentVariable` 返回 ABSENT)。于是 `createUpdaterArtifacts` 拿不到密码 →:① 交互终端**弹 `Password:` 等输入**(user 截图反馈);② 无 TTY 后台跑则**偶发 `Wrong password` / 二次签名 env 错乱**(= 二次重生成时观察到的"不确定性",真因就是这个,非玄学)。空密码这条路在 Windows 上不可行。
- **修法(根治)**:第三次 `tauri signer generate -p <28位随机密码> --ci` 生成一把**带真实密码**的密钥,key ID **`2A008F3DA4940FDE`**。密码非空 → PowerShell `$env:...PASSWORD = <非空>` **能正常传给子进程** → 签名 deterministic、永不弹提示。`config.env` 同步 key + 密码;`minisign.pub` + 三档 override pubkey 换新;密钥三件套 + **明文密码条**离线备份到 `D:\隐私数据\...\1-minisign-updater签名密钥\`。
- **实测(2026-06-06)**:① 非空密码 env 签测试文件成功、无提示;② **prod 完整 build(含 LibreOffice 190MB)构建期直接签出 `.sig`——日志 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD loaded from config.env` + `Finished 1 updater signature`,全程无 `Password:` 提示、无 Wrong password、无需兜底补签**;③ `verify-updater-artifacts.ts` **8/8**;④ `updater-config.test.ts` 13/13(pubkey==minisign.pub);⑤ typecheck 全过;⑥ 真桌面 CDP e2e TC-1/2 通过。1B29 验签结论作废,以 2A00 为准。
- **遗留价值**:此根治同时让二次方案的 step 3.6「.sig 兜底补签」从"必需"降级为"纯防御"(正常路径已不触发,实测显示"无需补签"分支)。

### `packages/desktop/src-tauri/tauri.conf.json`(+4 / -0)

- `nsis.languages` 加 `["English", "SimpChinese"]`(中英双语安装界面)
- `nsis.installMode` 设 `"currentUser"`(免管理员权限)
- 移除无效 `nsis.desktopShortcut` 字段(Tauri v2 NSIS schema `deny_unknown_fields`,NSIS 默认创建桌面快捷方式)

### `packages/desktop/minisign.pub`(新文件)

- DeskFox minisign 公钥入仓(公钥 ID `2A008F3DA4940FDE`,明文 `RWTeD5SkPY8AKka/1s8lmInaD0cvRyCwip35vP3HiLFFHNLsdNhpbuG8`;2026-06-06 三次重生成【带密码】,见「签名密钥重生成 → 三次重生成」)
- 私钥 canonical 位置:`~/.deskfox-signing/config.env` 的 `TAURI_SIGNING_PRIVATE_KEY`(build-deskfox.ps1 从此读)。绝不入仓(`.gitignore *.key`)
- ✅ 2026-06-05 已离线备份到 `D:\隐私数据\棱界科技\Desk fox 私钥\`(含 README 密钥清单);`D:\tmp\...\minisign-keys\` 散落副本已清除。私钥现仅存 config.env(正本)+ 离线备份两处。私钥一旦全丢 = 永远无法给已装客户端推更新(公钥已编进 binary)

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

### `packages/branding/scripts/build-deskfox.ps1`(累计 +19,2026-06-06 再 +41 / -2)

- 加 `TAURI_SIGNING_PRIVATE_KEY` env 注入逻辑(从 `~/.deskfox-signing/config.env` 读取)
- Tauri build 用此 env 签 updater .sig 文件(配合 override 里的 `createUpdaterArtifacts: true`)
- **(2026-06-06,后续 +33 行)** 见下三条:密码注入 / LO bundle / .sig 兜底补签
- **(2026-06-06)签名密码同步注入** — 显式从同一 `config.env` 读 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`(无此字段则显式设 `=""`),修 fresh shell `incorrect updater private key password` 签名失败 + 杜绝 ambient 旧密码串台(见「签名密钥重生成 → 二次重生成」)
- **(2026-06-06)Windows LibreOffice bundle 注入(step 1.9)** — 对称 `build-deskfox.sh`:Inno→NSIS 切换时 `.iss [Files]` 段删除导致 LO 注入丢失,NSIS 包不再含 LibreOffice。改用第二个 `--config` 动态注入 `bundle.resources`(`branding/libreoffice-bundle/windows` → 安装目录 `libreoffice/`,对齐 `office-installer.ts` Win 分支期望路径)。PS 调原生 exe 吞内联 JSON 双引号 → 写临时 JSON 文件传路径规避;build 后清理临时文件。LO bundle 不存在时跳过(用户首用时下载)
  - **实测(2026-06-06)**:`libreoffice-bundle/windows`(647MB,git-ignored)就位时,prod 包从 62MB → **190MB**,`target/release/libreoffice/program/soffice.exe` 随构建 staging,verify 8/8 通过。该 bundle 目录曾被改名 `_windows_hidden` 临时禁用(测试期加速 build),启用 = 改回 `windows`
- **(2026-06-06)updater `.sig` 兜底补签(step 3.6)** — 实证 `createUpdaterArtifacts` **构建期签名偶发失败**:含 LO 的 ~190MB 包某次报 `incorrect updater private key password: Wrong password`(同 key/空密码,日志先 `Deriving...done` 再报错,疑构建器内部二次签名 env 错乱),**同配置同 build 再跑一次又成功** → 确认是**不确定性**(非 LO 相关、非密码错)。手动 `tauri signer sign` 从 env 读私钥 100% 可靠。兜底逻辑:build 后(即便 buildExit≠0、.exe 已产出)检测 NSIS 安装包,`.sig` 缺失或旧于 .exe 则自动补签,保证 `/ship` 步骤 7.5a 永远拿得到匹配签名。构建期签成功则跳过(实测正确跳过)

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
| `build-deskfox.ps1` | +19,后再 +41 / -2(密码注入 + Win LO bundle),再 +33(.sig 兜底补签) |
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
- ✅ `updates.deskfox.ai` 后端已部署 9 个 per-platform Tauri 格式 manifest(2026-06-05);TC-7 HTTP 实测三档×三平台全 200 + 合法格式;TC-2 CDP 实测 updater 插件真 fetch 该 endpoint 返「无更新」
- ✅ updater 运行时端到端(TC-1/2/4)本机 CDP 实测通过;NSIS .exe+.sig 产物断言(TC-5/8/9)实测通过。剩 TC-3(mac 一键安装)/ TC-6(win 真安装)/ TC-11(Inno 共存)需硬件,非本机可做

## 回归测试点

- **R1 编译时硬开** — `window.__OPENCODE__.updaterEnabled` → `true` → ✅ **CDP 运行时实测**(updater-cdp.spec.ts TC-1,真二进制)
- **R2 设置面板 Updates 段可见且可操作** — 代码层条件 spread true 时 checkUpdate/update 存在 → UI 自动启用;✅ **CDP 实测插件可调**(TC-2 invoke check 返「无更新」,证明 platform.checkUpdate 背后链路通);Windows 上无独立 settings 视觉项,真桌面视觉对齐留 TC-6
- **R3 macOS 菜单"Check for Updates..."出现** — 条件 spread true 时菜单项渲染(本机 Windows 不验 macOS 菜单;代码层确认,TC-3 待 Mac)
- **R4 polling 启动** — `useUpdatePolling` guard `platform.checkUpdate` 存在 → 不短路 → polling 启动;✅ 代码层确认(updaterEnabled=true → spread 生效,与 TC-2 同根)
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
- [x] **R5 测试(静态单测)** — `packages/branding/__tests__/updater-config.test.ts`(13 tests,全绿)静态守护本次三类 bug:配置落点(override 非上游 conf)/ pubkey 正确(==minisign.pub、!=上游)/ Layer3 保留 + createUpdaterArtifacts + UPDATER_ENABLED。覆盖 TC-9 + TC-10
- [x] **R5 测试(构建产物断言)** — `packages/branding/scripts/verify-updater-artifacts.ts`(8/8 通过,2026-06-06 prod full build 实测):TC-5(NSIS .exe+.sig 产出)/ TC-8(纯 Node crypto 离线验签:key ID 比对 + Ed25519 全量验签安装包字节)/ TC-9(pubkey 替换)。**密钥重生成后 .sig 首次成功产出并验签通过**
- [x] **R5 测试(真桌面 CDP 运行时)** — `packages/app/e2e-tauri/specs/updater-cdp.spec.ts`(2/2 通过):TC-1(`window.__OPENCODE__.updaterEnabled===true` 真二进制运行时)/ TC-2(invoke `plugin:updater|check` 命中线上 endpoint 返 null「无更新」→ 插件注册+pubkey+endpoint+manifest 解析+版本比较全链路,兼覆 TC-4 静默)
- [ ] **R5 测试(硬件阻塞,非本机可做)** — TC-3(macOS updater 一键安装端到端,需 Mac + 真实发新版本)/ TC-6(Windows NSIS installer 真安装验证)/ TC-11(存量 Inno 共存迁移,Inno uninstaller GUI 半自动)

## 已知遗留

- **`updates.deskfox.ai` 后端(2026-06-05 实地探测)**:
  - 线上 **prod** `/v1/latest/desktop/latest.json` 返回**占位符** `{"version":"0.0.0","placeholder":true}` —— 缺 Tauri updater 必需的 `platforms` 字段 → updater check 失败
  - **beta** `/v1/latest/desktop-beta/latest.json` 和 **dev** `desktop-dev/...` → **404,未建**
  - ✅ endpoint 路径正确:`/v1/latest/desktop[-beta|-dev]/latest.json` 与 override 配置一致(注:`docs/design-telemetry-and-update.md` §6 写的 `/desktop/latest.json` 旧路径已过时,实际线上是 `/v1/latest/` 前缀)
  - **待办**:发一次真实签名版本 → `finalize-latest-json.ts` 生成 Tauri 格式 `latest.json`(`version`/`notes`/`pub_date`/`platforms.{windows-x86_64,darwin-aarch64}.{url,signature}`)→ SCP 到东京 `52.197.46.120:/var/www/updates/desktop/v1/latest/{desktop,desktop-beta,desktop-dev}/`。**需服务器 SSH 访问 + 一次真实 ship 产物**,非本机可独立完成
- ~~**NSIS installer 完整产出**~~ **✅ 已解决(2026-06-06)**:非 GH Actions 本地环境靠 `build-deskfox.ps1` 在 build 期剥离 `signCommand`(commit `2939914a2`),产出**未签名 NSIS 安装包 `DeskFox_2026.6.0_x64-setup.exe`(62.7MB)+ updater `.sig`**(minisign,Authenticode 缺席只影响"未知发布者"警告,不影响 updater 验签)。`verify-updater-artifacts.ts` 8/8 实测验签通过
- **存量 Inno 用户迁移**:NSIS 安装新路径(`DeskFox/`),两版共存不冲突,用户手动卸旧版。首次 NSIS 安装后需用户引导卸载 Inno 版本

## ✅ 版本号 scheme 已定 + 注入已修(2026-06-05 user 拍板 + 实测打通)

**根因**:`DeskFox.exe` 历史报 `0.0.0` —— `Cargo.toml` version 写死 `0.0.0`,tauri.conf 的 `"version":"../package.json"` 在 Tauri v2 是非法 semver 字面量 → 回落 `0.0.0`;build 链从不注入。updater 比较此值 → 失效。

**决策(user 拍板)**:改用 3 段 semver `YYYY.次.补`,起步 `2026.6.0`(大更新进"次"、小更新进"补");各端独立计数 + `YYYY.次` 弱协同;updater endpoint 按 `{{target}}` 分平台。完整规则落 `docs/governance/版本号与发布渠道规范.md` §三 v2.0。

**注入修复(实测验证)**:`build-deskfox.ps1`(Win,已实测)/ `build-deskfox.sh`(Mac,镜像待 Mac 验)build 前从 `installer-versions.json` 读对应平台版本号,**patch on-disk `tauri.conf.json` version**(tauri-build `rerun-if-changed` 强制 `generate_context!` 重编),build 后 git 还原。Win dev build 实测二进制 bake `2026.6.0`(grep 确认)。

> 踩坑:① `--config` 传 version 走 env,不触发 cargo 重编(无效);② PS5.1 GBK 读 .ps1 → 中文紧邻代码引号吞引号(代码行 ASCII 化);③ PS 调原生 exe 吞双引号 → 内联 --config JSON 失效(改纯 on-disk patch);④ `$root`=packages 非 branding(路径修正)。

## ✅ 服务端 updates.deskfox.ai 已部署(2026-06-05)

通过 SSH(`ubuntu@52.197.46.120`,密钥见 `deskfox-site/deploy/`)创建 **3 渠道 × 3 平台 = 9 个 per-platform manifest**:`/var/www/updates/v1/latest/{desktop,desktop-beta,desktop-dev}/{windows,darwin,linux}/latest.json`,内容为合法 Tauri 格式"已是最新"占位(`version:2026.6.0`,空 platforms)。**全部 HTTPS 200 实测通过**。`{{target}}` endpoint 现可正常 check(版本相等 → "已是最新",不再 404/解析错)。真实版本发布时由 `finalize-latest-json.ts` 生成真 manifest 覆盖。

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