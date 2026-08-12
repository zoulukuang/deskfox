feat-id: macos-ship-命令
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

## 规模

Medium(skill SOP ~120 行 + 三文档)。纯编排层,0 改上游,0 R4。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `.claude/commands/ship.md` | 新增(**本机,gitignored,不入仓**) | macOS `/ship` skill SOP:完整模式 0-8 + resume 模式 + 公证门禁 + 隐私约束。 |
| `docs/features/macos-ship-命令/{1-spec,2-plan,3-changelog}.md` | 新增(入仓) | 设计 + 步骤映射 + 决策,可据此重建 skill。 |
| `docs/features/INDEX.md` / `改动日志.md` | 改 | 索引各一行。 |

## 关键设计(详见 1-spec)

- **不公证不推送**(3.5 硬门禁)+ **公证失败 `/ship resume` 续发**(应对苹果服务不稳)。
- **双轮验证前置**(不进 ship)+ **触发即授权一口气跑** + **code-review 高危才停**。
- skill 本机不入仓(避免与 Win `/ship` 冲突),SOP 知识入仓本 feat。

## 验证

- 步骤 3/3.5(打包+签名+公证+门禁)本 session 实测过:Tauri 自动签成功、公证撞苹果超时、`spctl=Unnotarized Developer ID`、命名 `DeskFox-2026.6.1.1_aarch64.dmg`。
- 步骤 4-8(真推送)靠 skill 逻辑 review + 复用 user 历史实战过的脚本;真推送待下次实际发版验证。
- skill grep 零硬编码隐私(身份/token 走 config.env + 环境变量)。

## 影响范围

- 无产品代码 / 运行时变化,纯发布工具链编排。
- 与 Win `/ship` 互不干扰(各端本地 skill)。

## commit

本笔 commit:`feat: macOS /ship 一键发版命令 [feat: macos-ship-命令]`(skill 本机 gitignored,仅 docs 入仓)

## 回退

删 `.claude/commands/ship.md`(本机)+ `git revert` docs。无运行时状态。

---

## Follow-up(2026-06-04):国内镜像 Gitee 附件 → 阿里云 OSS [feat: ship-oss-upload]

**起因**:.dmg 内嵌 LibreOffice 后已 **~274MB**,远超 Gitee 100MB 单文件上限 —— 原步骤 7b `mirror-asset-to-gitee.sh` 附件上传**已失效**。官网 `deskfox-site/update-version.ps1` 此前已把国内镜像从 Gitee release URL 迁到阿里云 CDN `dl.clawtray.com/<AssetName>`(Gitee 仅 fallback),本次让 ship 流程对齐这条链路。

**改造**:
- 新增 `packages/branding/scripts/upload-asset-to-oss.sh`(入仓,fork-only 新文件):自动定位/下载 ossutil(到 ExtSSD)→ `ossutil cp` 传到 `oss://downloadbot/<文件名>`(分片+断点续传,无 100MB 上限)→ HEAD 验证 `https://dl.clawtray.com/<文件名>` → 打印机器可解析 `OSS_DOWNLOAD_URL=`。凭据全走环境变量(`OSS_ACCESS_KEY_ID/SECRET/ENDPOINT/BUCKET/CDN_BASE`),**零硬编码**。
- ship skill 步骤 7 重写:7a 跑 OSS 上传取链接;7b Gitee release **正文嵌 CDN 下载链接,不再传附件**。步骤 10 报告 + 隐私段同步更新。
- OSS 凭据写入 `~/.deskfox-signing/config.env`(本机 gitignored,**不入仓**);凭据原始出处 `deskfox-site/deploy/alibaba-cdn.md`(该仓 `deploy/` 亦 gitignored)。
- `mirror-asset-to-gitee.sh` 保留不动(<100MB 包 / Win fallback 仍可用)。

**验证**:脚本 `bash -n` 语法通过 + `--help`/缺凭据报错路径自检通过;真上传(传 274MB 到生产 OSS)按 user 决策留到下次实际发版时跑。

---

## Follow-up(2026-06-10):新增步骤 7.6 — 官网 deskfox-site 一键部署集成 [feat: ship-site-publish]

**起因**:`deskfox-site` 新增 `publish.sh`(自包含 bash 一键部署)。原 ship 步骤 10 只「提醒手动跑 `update-version.ps1`」,官网下载链接更新靠人肉。`publish.sh` 复用 ship 已有凭据,适合直接集成自动化。

**改造**:
- ship skill 新增**步骤 7.6**(放步骤 7.5 之后):`cd deskfox-site && bash publish.sh`。`publish.sh` 一站式:查 GitHub API 认最新 `ship-prod-*`/`ship-mac-prod-*` → 读 index.html(已最新则幂等退出)→ 验 CDN 200 回退 Gitee → patch 下载链接 → commit+push deskfox-site → `git archive`+scp 部署到 **`52.197.46.120:/var/www/deskfox-site`(与步骤 7.5 updater 同一台 Tokyo Lightsail + 同一把 SSH key,零新增凭据)** → 线上 smoke。
- **定位非阻断**(同 OSS/updater):GitHub Release + CDN 已成,publish 失败只报告。**幂等**:Win ship 后可能已跑过(它同时更两端),Mac 再跑多半 `nothing to do`。
- 步骤 10 报告把「手动跑 update-version.ps1」改为「7.6 已自动更新+部署官网」。
- **仅 Mac /ship**;Win 端走 deskfox-site 自己的 `update-version.ps1`/`deploy.ps1`。
- skill `.claude/commands/ship.md` 本机 gitignored(同上,不入仓);本 follow-up 入仓存知识。

**验证**:`publish.sh --dry-run --skip-pull` 实测对刚发的 `ship-mac-prod-2026.7.0` 正确识别(GitHub API 认出 macOS 2026.7.0 / Win 2026.7.1),且官网 index.html 已是最新 → 输出 `already at latest versions, nothing to do`(幂等路径验通)。

> **附记**:本次 2026.7.0 是 `/ship` skill **首次真实完整发版**,跑通了此前 changelog 标注「真推送待下次实际发版验证」的步骤 3-9 全链路(签名+公证+staple+GitHub Release+OSS+Gitee+updater manifest+合 main+push)。中途撞 macOS 收回外置卷 TCC 权限卡在步骤 7,授权后从断点续跑成功(产物零重做)。

---

## Follow-up:换基座 Electron 适配(2026-06-15,阶段4)

换基座 Tauri→Electron 后,`ship.md`(本机 gitignored)整体从 Tauri 链改写成 Electron 链。**本节为入仓知识**(skill 文件不入仓)。

**改了 8 处**:
- 铁律/步骤3:`pack-installer.sh`/`build-deskfox.sh`(Tauri)→ `build-deskfox-electron.sh -Env prod --sign --notarize`(electron-builder 原生签名公证)。
- 版本号:4 段 `YYYY.M.D.N` → 3 段 semver,读 `installer-versions.json` 的 `macos`,**ship 不自动 bump**(bump 是独立前置步骤)。
- 产物路径:`src-tauri/.../bundle/dmg/*_aarch64.dmg` → `dist-deskfox/DeskFox-<v>-mac-arm64.dmg`。
- 步骤4/8:无版本 bump commit(版本已在 main),chore 分支只回填台账。
- 步骤6/7:`-mac-arm64.dmg` + OSS 用 `--asset` 直指(tag 模式硬编码 Tauri 路径)。
- **步骤7.5:Tauri 单 updater → 两条源**:(A) `deploy-electron-updater.sh --platform mac`(Electron 自更新)+ (B) `bridge-electron-updater.sh --deploy`(Tauri→Electron 迁移桥)。

**2026.8.0 prod 实发抓到并修的 2 个真坑**:
1. 🔴 **electron-builder 不公证 .dmg 容器**(只公证 .app):`spctl <dmg>` 直接 `Unnotarized` → 步骤 3.5 **补 `notarytool submit <dmg> --wait` + `stapler staple <dmg>`**(已固化进 ship.md)。详 [[reference_electron_macos_signing]] 坑4。
2. 🔴 **deskfox-site `publish.sh`/`update-version.ps1` 用 Tauri 命名 `_aarch64.dmg`**:官网 Mac 链接一度 404 → 修 publish.sh `MAC_ASSET=-mac-arm64.dmg` + regex 兼容新旧 + 加 `--force`,已 commit/push/部署 deskfox-site(`0785772`)。**Win 侧 `update-version.ps1` + `WIN_ASSET` 仍 Tauri 命名,Win 发 Electron 时需同样对齐(待 Win 协调)**。

**首发实测**:DeskFox 2026.8.0 macOS prod 完整发版成功(GitHub/Gitee/OSS + Electron 自更新源 + Tauri 迁移桥 + 官网,全线上验证生效;复用彩排产物跳过重建)。相关 feat:`electron-macos-sign-notarize`(阶段2)+ `electron-macos-updater-bridge`(阶段3)。

---

## Follow-up(2026-06-21):清剩余 Tauri 文档残留(纸面同步,Tiny)

**起因**:换基座阶段4 已把**真实 skill**(`ship.md`,本机 gitignored)整体改 Electron,但**入仓纸面文档**仍有 Tauri 残留未清——上次会话挂着的 backlog:`2-plan.md` 其余 Tauri 残留 + `版本号与发布渠道规范.md` §5.1/§5.2 SOP 过时。决议**不单独立 backlog 记录**(给"文档过时"再挂待办是纯开销且文档照样错),直接在本分支修干净。

**改动**(纯 docs,0 代码,0 上游):
- `2-plan.md`:顶加换基座横幅 + 步骤3(`pack-installer.sh`→`build-deskfox-electron.sh --env prod --sign --notarize`)+ 复用脚本清单(electron-builder/OSS/updater 桥)+ Resume(`3-notarize.sh`→`notarytool submit`)+ 范围段脚本名,全同步 Electron 现状。
- `版本号与发布渠道规范.md` §5.1/§5.2:加 Electron 基座横幅——**Mac 侧定稿**(electron-builder 链 + 3 段 semver + `/ship` skill 编排,指向本 changelog 阶段4)、**Win 侧显式标「待协调」**(`build-deskfox-electron.ps1` 已就绪但发布链对齐 Electron 待 Win 协调,不擅改 Win 命令)。
- **`1-spec.md` 不动**:签名后锁版,作为 Tauri 时代设计的历史快照保留(换基座事实已由本 changelog 阶段4 记录)。

**未做(刻意)**:§5.1/§5.2 Win 侧 PowerShell 命令(`pack-installer.ps1`/`ISCC`/`DeskFox.iss`)保留原样仅加状态标注——Win 发 Electron 流程未定,不凭推断改写。Win 协调落地后再二次同步。

**同分支顺带清理(2026-06-21,Electron 迁移残留盘点的延伸)**:
- **清 14G 本地垃圾**:`packages/desktop/src-tauri/`(git 0 跟踪,仅剩 `target/` Rust 编译缓存 + `.DS_Store`)整目录 `rm -rf`,ExtSSD 释放 ~13G。仓库零影响(全 gitignored)。
- **CLAUDE.md**:三档 channel 切换命令 `pack-installer.* -Env <env>` → `build-deskfox-electron.* -Env <env>`(权威文件,启动必加载,旧脚本是 Tauri 时代)。
- **代码过时注释**:`packages/app/src/utils/local-asset.ts` 注释指向 `src-tauri/src/local_asset.rs`(已删)→ 改指 Electron 实现 `packages/desktop/src/main/deskfox/local-asset.ts`;`packages/branding/scripts/finalize-latest-json.ts` 用法示例 `--sig` 的 `src-tauri/target/.../nsis/*.exe.sig` 过时路径 → `dist-deskfox/DeskFox-<v>-win-x64.exe.sig`。
- **刻意不碰**:`packages/desktop/scripts/finalize-latest-json.ts`(含 `@tauri-apps/cli signer`)是**上游文件**,按 R2/P1 fork 不动,上游 merge 时处理;fork 自己的 updater 桥 `bridge-electron-updater.sh` 走 minisign,不依赖该上游脚本。

**B/D 批盘点结论(2026-06-21,`chore/electron-governance-doc-sweep` 分支)**:对 governance 文档 + 旧 Tauri 脚本做了系统盘点,**结论是大部分无需动**,只修 1 处真死链。留痕防下次重盘:
- **B(4 个 governance 文档)已合规,只修 B4 一处死链**:`跨平台协作.md`(L8)/`改动规则.md`(L126)/`自动化测试规范.md`(L250)**均已有醒目「⚠️ 换基座对齐(2026-06)」标注**,Tauri 内容按 fork 规则「历史快照加标注、不回填逐行改写」处理,合规;`UPSTREAM-MERGE-GUIDE.md` 全文 `src-tauri` 0 命中、主体已是 Electron。**唯一真 bug**:`自动化测试规范.md` L253 指向 `packages/app/e2e-tauri/README.md`(目录已随换基座删除)= 死链 → 改为「内容见 git 历史 + 指向现行验证」。
- **D(删旧 Tauri 脚本)不在本分支做,需单独立 feat**:`build-deskfox.{sh,ps1}`/`pack-installer.{sh,ps1}`/`pack-preview-dev.sh` 虽被 `build-deskfox-electron.*` 注释标为「取代」(不 source/不调用,非活依赖),但 **`__tests__/lo-bundle-strip.test.ts` 硬 `readFileSync` 旧脚本断言其 LO 校验/NSIS 哨兵逻辑**,且 `electron-builder.deskfox.config.ts` 注释提「换基座漏迁 build-deskfox.ps1 的版本注入逻辑」。删脚本=带 R5 测试迁移 + 确认新脚本职责完整的代码任务,非文档清理,另起 feat(如 `chore/retire-tauri-build-scripts`)处理。

## follow-up(2026-08-12,mac prod 2026.9.1 发版沉淀)

本机 `/ship` 命令(`.claude/commands/ship.md`,gitignored 不入仓)已按下列变更更新;此处记录**知识正本**,便于 Win 端与后来者对齐。

**① 升级源从两条收敛为一条(A 链路)**
- **B 链路(Tauri→Electron 迁移桥)2026-08-11 经 user 拍板永久退役**:用户量小,不值得为存量老 Tauri 用户背历史负担;且该链路事实上早已中断 —— 实测线上桥停在 `2026.8.6`(落后两个版本),资产 URL 指向 `dl.clawtray.com`,而该域名证书 2026-07-14 过期至今(发版当日 16:54 才续期),老用户下载本就 TLS 失败。
- `bridge-electron-updater.sh` **保留在仓里但不再跑**;步骤 7.5 的「两条源硬校验」收缩为只校验 A。
- 连带:`TAURI_SIGNING_PRIVATE_KEY` / minisign 桥签名密钥失去用途。

**② 公证:一律摘代理直连,超 1 小时即重提**
2026.9.1 发版实测:走 Clash 代理提交的两笔 x64 dmg 公证**永久卡在 `In Progress`**(分别 11.6h / 9.3h 至今未终结),`notarytool log` 取不到(未走完不产日志)、Apple 状态页显示 Notary Service 正常、账号无协议类报错 —— **无任何可诊断的失败原因**。同一文件**摘代理直连重提,5 分钟即 Accepted**。代理下 341MB 上传 7 分钟连提交 ID 都拿不到,直连秒回 `Successfully uploaded`。
- 提交前统一 `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy`。
- 公证票**按内容哈希绑定、不绑提交 ID**,任意一笔 Accepted 后 `stapler staple` 即可取票,**重复提交无副作用**;轮询用 `stapler staple` 当探针比盯单笔 `notarytool info` 更稳。
- 🔴 **绝不给 `notarytool` 输出套 `grep`**:会打断 `--wait` 的交互输出使其提前退出,后续 staple 报 `Could not find base64 encoded ticket`,极易误判成公证失败(实际苹果侧那笔是好的)。要脱敏用长 base64 正则 `sed` 替换,或重定向到文件再读。

**③ 绝不发单 arch 的 updater manifest**
electron-updater 6.8.9 `MacUpdater.filterFilesForArch`:Intel 机会把所有含 `arm64` 的条目过滤成空数组 → `findFile` 返 null → 抛 `ERR_UPDATER_ZIP_FILE_NOT_FOUND`。**不会误装 arm64 包到 Intel 机(无破坏性)**,但 Intel 用户每次检查更新都报错。双 arch 都过公证门禁后再发;必须分批时宁可推迟 manifest。
- ⚠️ 但「推迟 manifest」不是中性动作:`allowDowngrade = true`(**上游行为**,`upstream/dev` 至今保留,给的是服务端回滚能力)会让**已装新版的机器被静默降级回 manifest 那一版**(2026-08-11 真机复现:装好 2026.9.1 启动约 15 秒后自动换回 2026.9.0)。要用 prod 包验证新版必须先发 manifest;只想本地测则打 `local` 渠道(`UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev" && CHANNEL !== "local"`,不启用 updater + 数据隔离)。

**④ 官网:收尾必须 curl 线上逐条核对,改 index.html 要 `--force`**
`publish.sh` 当时只 patch 了 GitHub 侧三条链接,**国内三条静默跳过**(正则只认 `dl.clawtray.com`,而链接在证书故障期被 `DESKFOX_ASSET_BASE` 改成了 OSS 直链 `downloadbot.*.aliyuncs.com`)→ 官网国内下载停在 2026.9.0 好几天,脚本却一路显示成功。
- 已修(deskfox-site commit `9509bf6`):主机白名单认两种形态 + 「no match」从 WARN 改**硬失败** + 新增与正则无关的「版本残留」兜底断言 + `test/test-publish-patch.py` 4 场景 15 断言。
- 但**收尾核对仍要做**:curl 线上首页应有 **6 条**下载链接(Win/Mac-arm64/Mac-x64 × GitHub/国内)且全部本次版本号,再逐条验可下载。
- 版本号已最新时 `publish.sh` 会 `nothing to do` 直接退出、**跳过部署**,手工改了 index.html 必须 `--force` 才传得上去。

**⑤ 产物目录**:arm64 落 `dist-deskfox/mac-arm64/`、x64 落 `dist-deskfox/mac/`(electron-builder 规则:`appOutDir = "mac" + getArchSuffix`,未设 `defaultArch` 时默认 x64 故 x64 无后缀)。build 脚本此前把两者写反,已修,详见 `docs/features/electron-replatform-macos/3-changelog.md` 的 2026-08-12 follow-up 段。
