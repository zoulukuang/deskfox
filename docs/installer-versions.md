# DeskFox installer 版本日志

> 版本号规则:`YYYY.M.D.N`(年.月.日.当天第几版,N 从 1 开始)
> **Windows 和 macOS 各自独立 N 序列**(同一天 Win 打 1 次 + Mac 打 2 次,版本号分别为 [Windows] X.1 + [macOS] X.1, [macOS] X.2,**不共享计数器**)
> 每次跑 `pack-installer.ps1`(Windows)/ `pack-installer.sh`(macOS,待补)自动 bump + 编译,产生一条新 entry。
> 这个文件**只记录 ship 出去的 installer 版本**,不等同于 git commit。
> commit 索引看 [`改动日志.md`](改动日志.md)。

---









## [macOS] 2026.11.1 - 2026-08-19 13:41

(to be filled: commits / plugin / installer path after ship)

---
## [macOS] 2026.11.0 — 跳过,从未构建/发布

发版前 code-review(`/ship` 步骤 1)抓出三条问题,user 拍板**先修再发**,版本号顺延到 2026.11.1。
本号只在 `installer-versions.json` 里存在过十几分钟,**没有任何产物、tag 或 release**。
(Windows 侧的 2026.11.0 是真实发布,与本条无关 —— 各平台独立号线。)

---
## [Windows] 2026.11.0 - 2026-08-19 09:35

**主题**:数据库自愈 + 会话呈现与输入修复批**首次进 prod**,并含 Windows 侧完整回验。自
`ship-prod-2026.10.0` 起 **52 commits / 167 文件 / +12636 −7260**(其中 17 笔 feat+fix,
余为 docs/test)。按功能波次 minor 进位 2026.10.0 → 2026.11.0。

**本次内容**(自 `ship-prod-2026.10.0` 起):

- **数据库自愈(REQ-084①,本批最重要)**:内核版本落后于本机数据库时,过去是**每次启动 sidecar
  都打不开同一个库、静默永久坏**。现在分两处兜住:① **迁移期检测** —— 首启迁移到 deskfox 命名空间时,
  超前 schema 的库不迁入(原件保留在旧位置,auth/config/storage 照迁);② **启动期自愈** —— 已在新命名空间
  内的污染库,启动时改名为 `opencode.db.incompatible-<时间戳>` 挪开、以空库起,**只改名绝不删除**,
  并在界面上**明确告诉用户去哪找回原文件**。判定读不出一律 fail-open,绝不误伤正常库。
  ⚠️ 已知设计内行为:若从本版**降级**回旧版,自家新库同样会被判超前而隔离 —— 这是把"静默永久坏"
  换成"显式隔离、文件可手动恢复"。
- **会话呈现与输入(REQ-108/109/110/111/112/113/115/116)**:恢复会话进度条(带设置开关,默认开);
  shell 命令折叠可配置回归,独立成「已运行 N 条命令」组(默认开);时间线噪声治理(invalid 合并计数 +
  同文件连续编辑 ×N);聊天区 LaTeX 补齐主流定界符;修 v2 下「点击收起预览」点了没反应 + 收起动画
  被回退成"啪地弹开";修运行中图标不亮 / 权限过滤层 fail-open / 残骸补盖失效(1.18 把权威源挪到
  全局 store,fork 三处仍读恒空的 child store);修新会话残留已发送的上下文卡导致旧内容被再发一次。
- **构建与打包**:修 sidecar 下载走国内镜像导致 `prebuild` 恒失败、整条桌面打包链路卡死;
  dev/local 档图标从矢量源重生成(icns 由 128×128 提到 1024×1024)。
- **Windows 侧适配回验**(本端新增):修 3 个只在 Win 上出现的缺陷 —— 数据库隔离单测句柄泄漏
  (Windows 不允许改名已打开的文件)、迁移基线闸因 CRLF 恒假红、一条 hover 测试 flaky
  (修时序而非加重试);补齐 REQ-068 Windows 四模态真机抓 errno(6/6,实测**四模态真实 errno 全是
  `ENOENT`**,区分"目录被删"与"整盘离线"全靠盘符根可达性二次探测);两个真机验收脚本跨平台化
  (Win 首次跑通 12/12,与 mac 一致)。
- **测试基础设施**:performance e2e 套件复活(六条红全部定位为测试前提过期);清理 23 个零引用死 key;
  i18n 四个 locale 行尾归一化 LF。

**发版前安全网(Windows 端全部实跑)**:`bun run typecheck` **33/33**;单测 app **1051** /
media-gen **140** / adapter-feishu-lark **792** / desktop **267**(1 fail 为存量上游
`draft-store` `node:sqlite`,mac 侧同样);opencode `test/project`+`test/session` **561 pass**
(@60s 超时,1 fail 是上游测试自身的 POSIX shell 假设,已记入 REQ-107);Playwright 默认套件
**142 passed / 0 failed**;performance 61 passed(4 条 30x 节流超时为 mac 硬件基准阈值所致,
降到 6x 后 5/5,非回归);GUI 冒烟 **22/22 零崩溃**;文件预览定向验证 **5/5**(PDF/docx/xlsx 出
canvas、图片出 img);REQ-084 真机 T4/T5/T6 **12/12** + 隔离 toast 可见性通过;冷启动健康检查
干净配置目录首启 **CLEAN**。上游 schema 漂移检查:本地 38 条 = 上游 38 条,**无漂移**。

**未修的已知问题(不阻断发版,已进需求台账)**:REQ-121 重启后旧会话终端连不上且无提示
(`terminal.tsx` 为纯上游文件,本批未碰;不崩溃不报错,但终端面板空白且不说明原因)。

**产物**:
- `DeskFox-2026.11.0-win-x64.exe` — 339,889,547 bytes
  sha256 `4ecb71f8c04be5194f85f62d48b3ddbd4eeeb51a6713a8183beef1de06f2a0d1`
- **installer 路径**:`D:\project\opencode-fork\packages\desktop\dist-deskfox\DeskFox-2026.11.0-win-x64.exe`
- **国内下载**:https://dl.clawtray.com/DeskFox-2026.11.0-win-x64.exe
- **Release**:https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.11.0

---

## [Windows] 2026.10.0 - 2026-08-14 22:25

**主题**:上游同步 v1.17.4 → v1.18.16(`upstream-sync-2026-08`,1365 commits)首次进 prod 的 **Windows 端**,与 8-14 已发的 macOS 2026.10.0 **同批次同版本号**。按功能波次 minor 进位 2026.9.1 → 2026.10.0。

**本次内容**(自 `ship-prod-2026.9.1` 起,fork 侧改动):

- **界面与布局**:不跟随上游 v2 换代,默认保持经典布局(`keep-legacy-layout`),标题栏图标锚左 + 渠道徽标/工具组挂载点回植;修右侧面板遮挡功能按钮、镜像布局下文件树被 activity rail 盖住(`mirror-layout-overflow`,含源码级守卫防复发);补回文件树与聊天区主分隔线并改伪元素绘制;窄窗口自动收起右侧项目侧栏 + 预览区最小宽度兜底;默认窗口 1440×900。
- **稳定性**:启动前清理孤儿 `project_directory` 行(`db-orphan-prune`)—— 存量库升级撞上游迁移外键约束会导致 sidecar exit 1、应用完全打不开;local 档配置隔离 + 修 plugin-install 写错配置文件的潜伏 bug。
- **交互**:外部拖入非图片改走路径引用(任何类型可拖入)+ 修「模型不支持图片」拦截误伤 .txt/.csv;四条通道的 `@` 路径统一为正斜杠(Win 文件树单选拖入此前给反斜杠);点文件树行焦点真正落入,键盘作用域恢复;`[窗口]` 菜单三个 Electron role 项补中文。
- **测试基础设施**:新增 `uiprobe` 界面交互测试工具包(native 层按平台分派并接入 Windows,四组功能清单已自动化);修若干仅 Win 触发的测试问题(`new URL().pathname` 盘符多斜杠致 row-reverse 守卫从未执行、locale 检测跨 ICU 版本行为分叉、本地包 channel 判据跨不过换行恒报假)。

**发版前安全网**:`bun turbo typecheck`(排除 console)29/29 绿;单测 media-gen 140 / adapter-feishu-lark 792 / app `bun run test` 1008 + 41,**0 fail**。Windows 端验收已在 sync 分支走完(P0/P1/P2 自动化 + 人工单 4 通过 1 跳过 + NSIS 安装/升级/卸载,见 `docs/features/upstream-sync-2026-08/7-windows-verification.md`)。

**打包一处观察(非缺陷)**:electron-builder 对 LibreOffice bundle 内数千个 exe 逐个跑 signtool,该阶段耗时约 8 分钟且日志静默;随后 7za LZMA 压缩的产物大小在末尾才一次性刷盘(中途看 `.nsis.7z` 只涨几 MB,容易误判卡死)。全程 exit 0,post-build 守卫「最终包含 soffice.exe + 非空 presets」通过。

**产物**:
- `DeskFox-2026.10.0-win-x64.exe` — 339,796,119 bytes
  sha256 `e27a0369e6238a36c9919ce3248bb7ebd3bedcacebccd324d6cfc88efa3513ce`
- 体积较 2026.9.1(276 MB)增长约 63 MB,与上游同步后 Dev 2026.7.1(340 MB)同量级。

**发布范围**:
- GitHub Release `ship-prod-2026.10.0`(`--latest`)
- 阿里云 CDN:`dl.clawtray.com/DeskFox-2026.10.0-win-x64.exe`
- Gitee Release(元数据 + 下载链接,附件超 100MB 不传)
- updater(electron):`updates.deskfox.ai/electron/prod/latest.yml`
- Tauri→Electron 迁移桥:`updates.deskfox.ai/v1/latest/desktop/windows/latest.json`
- 官网 deskfox.ai Windows 下载链接

**installer 路径**:`packages/desktop/dist-deskfox/DeskFox-2026.10.0-win-x64.exe`

---

## [macOS] 2026.10.0 - 2026-08-14

**主题**:上游同步 v1.17.4 → v1.18.16 首次进 prod(`upstream-sync-2026-08`,1365 commits / 2359 文件),按功能波次 minor 进位 2026.9.1 → 2026.10.0。双 arch 一次发齐。

- **arm64**:深签 + `.app` 公证 staple + `.dmg` 公证 staple,门禁三项(stapler validate / spctl accepted / source=Notarized Developer ID)全过。
- **x64**:同上全过。`.dmg` 签名一步撞 Apple 时间戳服务抖动,补签后完成(见下)。

**⚠️ 本次两处环境坑 + 处置(可复用)**:

1. **摘代理躲公证滞留 ↔ 构建期需要代理**(新坑,已有解)。按 2026.9.1 的教训全程 `env -u *_PROXY` 直连跑 build,结果 2 分钟即挂在 `prebuild`:`https://models.dev/api.json` 直连 ConnectionRefused。解法是 `generate.ts` 已有的逃生口 —— 带代理 `curl` 一份快照落盘,再用 `MODELS_DEV_API_JSON=<快照>` + 摘代理跑完整 build。两轮公证(arm64/x64 的 `.app`)均一次 Accepted,**未复现 2026.9.1 的永久滞留**,直连结论再次被验证。
2. **x64 `.dmg` 签名撞时间戳服务抖动**:`codesign` 报 `A timestamp was expected but was not found`,electron-builder 以 `⨯ codesign process failed 1` 中止 —— 此时 `.app` 已签名+公证+staple、zip/dmg 都已生成,**只差 dmg 签名这一步**。不必重打:`hdiutil verify` 确认 dmg 校验和有效 → `codesign --sign <hash> --timestamp <dmg>` 补签 → 单独公证 + staple 即可。副作用仅缺 `dmg.blockmap`(部署脚本按 `[[ -f ]]` 条件上传,非硬依赖;mac 自更新走 zip,`zip.blockmap` 两 arch 均在)。
   构建在守卫段之前中止,故 **post-build LO 守卫手工补跑**:两 arch 的 `soffice` 架构与主可执行一致(x86_64 / arm64)、`presets` 各 5 条,均通过。
3. **大文件上传别放前台**:`gh release create`(773MB)与 `notarytool submit`(394MB)都会超出 10 分钟前台窗口被打断 —— `gh` 会留下半截 **draft** release(需删掉重建),`notarytool` 则是上传未完成。一律后台跑。

**产物**:
- arm64 dmg `DeskFox-2026.10.0-mac-arm64.dmg` — 397,106,896 bytes
  sha256 `d597f8bf9050657067ace2a1f0a1772360138bed8685fb4233e5b1619504093e`
- x64 dmg `DeskFox-2026.10.0-mac-x64.dmg` — 413,214,089 bytes
  sha256 `907d2f2112d8718547785b16377b789c6de337f5c9e4434e0b51800e29d98292`
(均为 staple 后实算)

**发布范围(双 arch 齐)**:
- GitHub Release `ship-mac-prod-2026.10.0`(`--latest`,arm64 + x64 两个 dmg asset)
- 阿里云 CDN:`dl.clawtray.com/DeskFox-2026.10.0-mac-{arm64,x64}.dmg`
- Gitee Release id 797518(元数据 + 双 arch 下载链接)
- updater A 链路:`latest-mac.yml` 单本双 arch(4 条 `files[]`),线上 version=2026.10.0 硬校验通过,4 条资产 URL 实测 206 且 Content-Length 与 manifest 逐一吻合
- 官网 deskfox.ai:6 条下载链接实测全 206,Mac 两条为 2026.10.0(Win 保持 2026.9.1,本次未发 Win)

---
## [Windows dev] 2026.7.1 - 2026-08-14 15:16

**⚠️ 非发布版本 —— 为验证 NSIS 安装/升级/卸载而打,未 ship、未上传、未配 publish。**

用途:`upstream-sync-2026-08` 分支的 Windows 端验收(见
`docs/features/upstream-sync-2026-08/7-windows-verification.md` §七)。
验「升级」需要两个不同版本,故从 dev 号线 2026.7.0 bump 到 2026.7.1,
装旧版 → 升级到新版 → 卸载,全程比对安装目录 / 注册表 / appData / prod 隔离。

- 产物:`packages/desktop/dist-deskfox/DeskFox-Dev-2026.7.1-win-x64.exe`(340 MB)
- 源码:`sync/upstream-2026-08-10` @ `77c3d1a8c5`
- 测完**已卸载**,本机不保留安装。
- 号线保持在 2026.7.1(未回退):产物确实存在过,回退会让台账与磁盘对不上;
  下次真正 ship dev 从 2026.7.2 起。

---

## [macOS] 2026.9.1 - 2026-08-11

**主题**:与 Win 2026.9.1 同批次的小成本确定性收口批(REQ-098/019/099)—— 聊天单波浪号误删除线修复 + OAuth 回调端口只绑本机 + 托盘健康状态。补丁版(2026.9.0 → 2026.9.1)。

**本次为分批发布(arm64 先发,x64 次日 05:19 补齐),现双 arch 已全部上线。**

- **arm64**:全套完成 —— 深签 + `.app` 公证 staple + `.dmg` 公证 staple,门禁三项(stapler validate / spctl accepted / source=Notarized Developer ID)全过。08-11 23:00 前完成全渠道。
- **x64**:同样全套完成,但 `.dmg` 公证撞上 **Apple 队列异常滞留**,08-12 05:19 才补齐。

**⚠️ x64 公证滞留事件 + 处置(可复用)**:
- 走**代理**提交的两笔(08-11 17:42 / 19:59)在 Apple 侧**永久卡在 `In Progress`**(截至 08-12 05:20 分别已 11.6h / 9.3h,至今未终结),`notarytool log` 取不到(未走完不产日志),Apple 系统状态页全程显示 Notary Service 正常,账号无协议类报错 —— **无任何可诊断的失败原因,纯滞留**。
- 08-12 05:14 **摘掉代理直连**重新提交第三笔 → **5 分钟即 Accepted**。
- **结论/SOP 改进**:① 公证提交前 `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY ...` 直连(代理下同一文件上传 7 分钟拿不到提交 ID,直连秒回 `Successfully uploaded`);② 提交超过约 1 小时仍 `In Progress` 即可判定滞留,**直接重新提交**比继续等有效(公证票按内容哈希绑定,任意一笔 Accepted 都能 `stapler staple`,重复提交无副作用);③ **不要给 `notarytool` 的输出套 grep 过滤** —— 本次 arm64 dmg 那笔因加了过滤导致 `--wait` 提前退出、staple 无票可贴(误判成公证失败)。

**产物**:
- arm64 dmg `DeskFox-2026.9.1-mac-arm64.dmg` — 325,433,580 bytes
  sha256 `7fb53b3efd6cc9a356612f9674517c678328aff69ebd6bbebb217730471eeab2`
- x64 dmg `DeskFox-2026.9.1-mac-x64.dmg` — 341,520,944 bytes
  sha256 `6a8fba5f299562c8d210b08c6cd5280da4e214503e32c2fd3463927204f418a9`
(均为 staple 后实算)

**发布范围(最终,双 arch 齐)**:
- GitHub Release `ship-mac-prod-2026.9.1`(`--latest`,arm64 + x64 两个 dmg asset)
- 阿里云 CDN:`dl.clawtray.com/DeskFox-2026.9.1-mac-{arm64,x64}.dmg`
- Gitee Release id 788743(元数据 + 双 arch 下载链接)
- updater A 链路:`latest-mac.yml` 单本双 arch(4 条 `files[]`),线上 version=2026.9.1 硬校验通过,4 条资产 URL 实测 206
- 官网 deskfox.ai:6 条下载链接(Win/Mac-arm64/Mac-x64 × GitHub/国内)全部 2026.9.1 且实测可下载

**分批期间的取舍(已随 x64 补齐而解除)**:
- arm64 发布后先只发了 **arm64-only manifest**。原本计划连 manifest 一起压住,但实测发现 **`allowDowngrade = true`**(`packages/desktop/src/main/updater.ts:24`)会让装好的 2026.9.1 被线上旧 manifest **静默降级回 2026.9.0**(真机复现:装好启动 ~15s 后自动换回旧 bundle,`~/Library/Caches/deskfox-updater/pending/` 留有旧包)—— 即「不发 manifest」不是中性动作,会导致新版根本留不住、无法真机验证。故改为先发 arm64-only。
- 该窗口内 Intel 用户检查更新会撞 `ERR_UPDATER_ZIP_FILE_NOT_FOUND`(`MacUpdater.filterFilesForArch` 把含 `arm64` 的条目过滤成空数组 → `findFile` 返 null;已读 electron-updater 6.8.9 源码确认)。**不会误装 arm64 包到 Intel 机,无破坏性**,x64 补齐后即消失。
- 官网则全程压到双 arch 齐才更新,Intel 按钮未出现过 404。

**发版前 code-review**(4 finder,守 ≤5 预算):**无崩溃级**。逐行/删除行为/跨文件/清理四合一各一;marked 覆盖经 1200 个 md 对拍(零多划)+ 6 万条 fuzz;OAuth 改动经实测确认 localhost 双栈回落 IPv4,登录链路不回归。

**本次踩到并已定位的问题**:
- **`build-deskfox-electron.sh:63-64` arch→产物目录映射与 electron-builder 实际行为相反**(脚本:arm64→`mac`/x64→`mac-x64`;实际:arm64→`mac-arm64`/x64→`mac`)。后果:x64 因 `ls` 失败被 `set -euo pipefail` 中断 → `EXIT=1`,post-build 的 LibreOffice 完整性守卫一行没跑;arm64 则是**假绿** —— 去 `mac/` 找到的是上次 x64 构建的残留包,验的不是本次产物。本次已**手工补验双 arch**(soffice 可执行 + presets 非空 + 架构匹配,全过)。**修复待发版后单开 fix 分支处理**。
- **CDN 证书**:`dl.clawtray.com` 证书原已于 2026-07-14 过期,**本日 16:54 已完成续期**(新证书有效期至 2026-11-09),国内链路恢复走 CDN,不再需要 `DESKFOX_ASSET_BASE` 切 OSS 直链绕行。
- **官网 `publish.sh` 只 patch GitHub 侧链接,国内链接静默不更新**:本次实测,`publish.sh` 跑完日志只报 `patched Win/GitHub` / `Mac/GitHub` / `MacX64/GitHub`,**三条国内链接一条没打上**,线上 Mac 国内下载仍指向 2026.9.0(国内用户会下到旧版,且无任何报错)。根因:2026.9.0 证书过期时把国内链接改成了 OSS 直链形态(`downloadbot.oss-...`),而脚本替换规则匹配的是 `dl.clawtray.com/...`,对不上即静默跳过。本次手工改 `index.html` 两行 + `publish.sh --force` 重部署修正(site commit `9c75eb9`)。**待办**:修 `publish.sh` 的国内链接匹配规则,使其对两种主机形态都生效,否则每次发版都要人工兜底。
- **`publish.sh` 版本幂等会吞掉链接修正**:版本号已是最新时脚本直接 `nothing to do` 退出、**跳过部署**,导致手工改的 index.html 传不上去。修链接需带 `--force`。

---
## [Windows] 2026.9.1 - 2026-08-10 23:16

**主题**:小成本确定性收口批(REQ-098/019/099)— 聊天单波浪号误删除线修复 + OAuth 回调端口只绑本机(安全加固)+ 托盘健康状态;补丁版(2026.9.0 → 2026.9.1)。

**本次内容**(自 `ship-prod-2026.9.0` 起,主要 commit):
- **chat-tilde-del-fix**(REQ-098,`96c9e50ddf`+`de920bd4ad`+`91f7587c6d`+`444e740a18`):同行两个「数字~数字」区间(如 4.80~5.05 … 5.20~5.35)不再被 GFM 内置 `~~?` 规则误闭成删除线;ui/web 两包 marked tokenizer 覆盖(override-blacklist 备案),share 分享页同修 + 真浏览器 e2e;防漂移守卫兼容 Win CRLF checkout。
- **oauth-loopback-bind**(REQ-019,`6fe215459f`):OAuth callback server 绑 `127.0.0.1` 不再绑 `0.0.0.0`(修前从本机非环回 IP 实测端口暴露在 LAN);override-blacklist 备案。
- **tray-health-status**(REQ-099,`d94720afb4`+`cc7d688025`):托盘图标/菜单实时反映 sidecar 健康状态(三态图标),修 setTrayStatus 被 buildMenu 重建覆盖回「就绪」的自覆盖 bug。
- **治理/测试**(不进产品包):pre-commit 黑名单对 fork 自建文件动态豁免(`d40c7a3f2c`)/ fork 关键参数 `--conditions=browser` 三道锁(`b3eefc5621`)/ REQ-105 opencode 单测可信基线 Mac 段(`664d9045b7`)。
- **发版前 code-review**(high,16 agents):**无高危**,9 条备案留 follow-up — ① MCP OAuth 自定义 redirectUri 主机名不再被监听(CONFIRMED,仅影响自定义配置,默认 127.0.0.1 路径实测正常);② pre-commit upstream-base tag 过期后豁免静默失效(CONFIRMED,dev 工具);③④ DO/Codex OAuth 在 localhost 仅解析 ::1 的机器上回调断(PLAUSIBLE 边缘);⑤ watchdog emit 窗口销毁后可抛异常跳过 sidecar 重启(PLAUSIBLE);⑥-⑨ cleanup(死状态/死代码/守卫文案/e2e fixture 重复)。
- **渠道**:prod;tag `ship-prod-2026.9.1`
- **Release**:https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.9.1 + Gitee release(正文挂 OSS 直链)
- **installer**:`packages/desktop/dist-deskfox/DeskFox-2026.9.1-win-x64.exe`(~263 MB);国内下载 `https://downloadbot.oss-rg-china-mainland.aliyuncs.com/DeskFox-2026.9.1-win-x64.exe`(OSS 直链)
- **升级源**:electron `updates.deskfox.ai/electron/prod/latest.yml` + Tauri 迁移桥 `…/v1/latest/desktop/windows/latest.json` 均 version=2026.9.1,下载 url 均指 OSS 直链
- **⚠️ 证书状态**:`dl.clawtray.com` 证书仍过期(notAfter 2026-07-14,本次 ship 前实查),国内链路继续全量走 OSS 直链(deploy 脚本 `DESKFOX_ASSET_BASE` 覆盖);续期仍待办。

---

## [Windows] 2026.9.0 - 2026-08-07 14:20

**主题**:会话检索三件套(⌘K 全文搜索 + 会话列表操作 + ⌘F 会话内查找)+ 稳定性/日常体验双专项批次 + 原生菜单 i18n;大版本波次进"次"位(2026.8.6 → 2026.9.0)。

**本次内容**(自 `ship-prod-2026.8.5` 起,38 笔非 merge commit / 11 个 feat 分支):
- **session-content-search**(REQ-095,`e71b0ba15`+`5efb6855a`):⌘K 新增「会话内容」分组 — 会话记录全文检索(sidecar trigram FTS5 + LIKE 短词降级),高亮片段 + `#message-` 锚点跳转 + 「在所有项目中搜索/只搜当前项目」切换;FTS 不可用整组静默隐藏。
- **session-list-ux**(REQ-096,`d47b30849`+`333be8b75`+`c7cf6d50c`):会话行右键菜单(改名/分享/复制链接/归档/删除)+ 标题失焦即保存 + 归档撤销 toast;修取消归档被投影层静默丢失(重启即复原)的上游隐性 bug。
- **in-session-find**(REQ-097,`ec3f0650b`+`09494cd28`+`f91711b70`):⌘F 会话内查找条 — CSS Highlight 高亮 + 计数 + Enter/⇧Enter 轮次环形跳转;修真实长会话「计数走视图不动」(虚拟列表几何失效+reveal 竞态+scrollTop 钳制);V2 深位历史后台渐进加载(总数收敛,几百轮前的命中可跳达)+ ⌘K 内容命中点击带词开条联动。
- **稳定性专项**(REQ-087/049/078/085,`a35091984`/`fe784b7cd`/`3894243df`/`dbeff2a4b`):renderer 快照 OOM 治理(写盘节流+历史剥图+熔断+连环崩自愈)/ sidecar 内存刹车(execArgv 硬帽+采样软刹车+断连提示)/ 并发第二权限弹窗藏死修复 / 浮层 Enter 穿透误 toggle 预览区修复。
- **日常体验专项**(REQ-086/092/093/079/094/026,`a128e3782`/`4db83ce12`/`102678729`/`785b7049e`/`335fee7f4`/`ce948764f`+`ff3fcca8d`):飞书绑定默认当前项目+重绑保留 model/workspace / 启动期侧栏即点即应 / 飞书 LLM 重试期播报 / 侧栏列表提速(heal stat 3s 竞速+进程闩)/ imbot agent 按 schemaVersion 自动升级 / 图片能力前端拦截(能力徽标挤爆行宽已撤除)。
- **native-menu-i18n**(`1e3ad74ca`):原生右键菜单标签跟随 app 语言设置,切语言 IPC 重挂即时生效。
- **真机自查批次**(`c2115cfd9`+`c10451385`+`fe4e214cc`+`6ca544566`):中文单字(如「南」)⌘K 内容搜索放行(CJK 单字高频有效,ASCII 单字符仍拦)/ ⌘K→查找条联动在打包产物断裂修复(同会话 hash 导航重挂竞态,消费登记+垂死回投+TTL)/ e2e 竞态断言修复 / handoff 跨 chunk 单例同类加固。
- **发版前 code-review**:无高危。主进程改动全带 FORK 标记且经各批次 R9 验收;发版内容全量验证 — typecheck 26 包 / app 单测 606 / e2e 32×2 轮 / 真机冒烟 21 项 / 冷启动 2×CLEAN(打包产物)/ 真机 CDP 逐项(内容搜索/联动接力/右键菜单/归档撤销/复制链接)。
- **渠道**:prod;tag `ship-prod-2026.9.0`
- **Release**:https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.9.0 + Gitee release(正文挂 CDN 链)
- **installer**:`packages/desktop/dist-deskfox/DeskFox-2026.9.0-win-x64.exe`;国内下载 `https://downloadbot.oss-rg-china-mainland.aliyuncs.com/DeskFox-2026.9.0-win-x64.exe`(OSS 直链)
- **升级源**:electron `updates.deskfox.ai/electron/prod/latest.yml` + Tauri 迁移桥 `…/v1/latest/desktop/windows/latest.json` 均 version=2026.9.0,下载 url 均指 OSS 直链
- **⚠️ 证书事件**:发版时发现 `dl.clawtray.com` HTTPS 证书 **2026-07-14 已过期**(SEC_E_CERT_EXPIRED,国内下载与升级下载全断,裸奔约三周无人发现)。本次国内链路(latest.yml / 迁移桥 / 官网 / Gitee / GH notes)**全部临时切 OSS 直链**(阿里官方证书,实测 206 可下载)。**待办**:阿里云控制台给 CDN 域名续期/重新部署免费证书 → 后续 ship 可切回 `dl.clawtray.com`(deploy-electron-updater.sh 第 77 行硬编码基址,切换时留意)。

---



## [macOS] 2026.9.0 - 2026-08-07 14:42

**主题**:「找回内容」功能波次 — ⌘K 会话内容全文检索(REQ-095,trigram FTS5 中文子串+锚点跳转)+ ⌘F 会话内查找(REQ-097,计数/跳转/高亮/⌘K 联动/深位历史渐进遍历)+ 会话列表操作体验(REQ-096,标题 blur 保存/行右键菜单 重命名-分享-复制链接-归档-删除/归档撤销,含投影层取消归档持久化修复)+ 原生右键菜单 i18n(19 语言跟随 app 设置)。

- **渠道**:prod;tag `ship-mac-prod-2026.9.0`;main `5328d49f33`(bump merge)
- **产物**(Developer ID 签名 + 公证 + staple,双 arch):
  - `DeskFox-2026.9.0-mac-arm64.dmg` sha256 `4e1a457df63700fe5b8ff4da80675e9b520da6abaaf8227f5f4f23a7fbbaf5d3`
  - `DeskFox-2026.9.0-mac-x64.dmg` sha256 `61b59df8f1a9552444675418ee09982b3b899415caf4c393e45af613e92b9eac`
- **公证**:两 dmg 均 Accepted + staple + spctl Notarized Developer ID ✅
- **升级源**:A latest-mac.yml version=2026.9.0(双 arch 4 资产)✅;B 迁移桥 latest.json version=2026.9.0(arm64 tar.gz + minisign)✅
- **⚠️ 运维事件(本次发版撞出)**:CDN `dl.clawtray.com` **SSL 证书 2026-07-14 已过期**(存量用户自动升级三周静默失败);本次两条升级源资产 URL 应急切 **OSS bucket 直链**(`downloadbot.oss-rg-china-mainland.aliyuncs.com`,证书正常)恢复升级;Gitee 正文同用直链。**证书续期(阿里云 CDN 控制台)待办**,修复后可切回 CDN 域名(脚本已支持 `DESKFOX_ASSET_BASE` 覆盖)。
- **附带脚本修复**:`upload-asset-to-oss.sh` HEAD 校验段 `$code` 后跟全角逗号被 bash 3.2 吞进变量名致 set -u 崩(本次 3 次触发,上传本体不受影响);`deploy/bridge-electron-updater.sh` CDN base 支持 `DESKFOX_ASSET_BASE` 环境覆盖。
- **发版 code-review**:4 finder 无高危;8 条 minor 备案(FTS 首搜 backfill 同步阻塞规模边界~100MB 文本、触屏归档入口、深挖 loading 暂停等,详见 workflow 记录)
- **已知包构建怪相**:x64 electron-builder appOutDir 落 `mac/`(非脚本预期 `mac-x64/`)覆盖 arm64 .app,产物 dmg/zip 不受影响;迁移桥 .app 从 arm64 zip 恢复。待查 builder 目录约定(follow-up)。

---
## [macOS] 2026.8.6 - 2026-07-14 18:40

**主题**:三 feature 波次(与 Win 2026.8.5 同内容)—「加入聊天」浮窗键位对齐 + 首启新手引导(含老用户升级不打扰)+ 运行期数据命名空间隔离(与上游 OpenCode 物理分家);另含 e2e session-timeline flaky 根治。**REQ-081 双 arch 首战**:arm64 + x64 同版本双包,单本 latest-mac.yml 分流。

- **渠道**:prod;tag `ship-mac-prod-2026.8.6`;main `cf3afafb67`(bump merge)
- **产物**(Developer ID 签名 + 公证 + staple,双 arch):
  - `DeskFox-2026.8.6-mac-arm64.dmg` sha256 `2e0ffdbe1c91f7a1779958418645fbbf7408927581bc70d864c968c55abb2234`
  - `DeskFox-2026.8.6-mac-x64.dmg` sha256 `9106285b5055892cc7e98b49119a188405bd44d44d574cb64a5d7003476c05ba`
- **公证**:.app 内联 + 双 dmg 补公证均 Accepted,spctl `Notarized Developer ID`
- **分发**:GitHub Release(--latest,双 dmg)+ 阿里云 CDN `dl.clawtray.com` 双链 + Gitee release(链接)
- **升级源**:A Electron `latest-mac.yml` version=2026.8.6(4 files 双 arch)✅ / B Tauri 迁移桥 darwin latest.json version=2026.8.6 ✅(硬校验回读过)
- **官网**:deskfox.ai 已更新部署(54e201f)

---
## [Windows] 2026.8.5 - 2026-07-14 16:27

**主题**:三 feature 波次 — 「加入聊天」浮窗键位对齐 + 首启新手引导(含老用户升级不打扰)+ 运行期数据命名空间隔离(与上游 OpenCode 物理分家);小更新进"补"位(2026.8.4 → 2026.8.5),与 mac prod 2026.8.5 号面追平。

**本次内容**(自 `ship-prod-2026.8.4` 起):
- **quick-ask-enter-align**(`2825c13c4`+`319a7773c`):「加入聊天」浮窗(markdown 选区 + PDF/Office 右键)快捷键对齐主输入框 — 裸 Enter 提交 / Shift+Enter 换行 / IME 组合态守卫(`isImeComposingEvent` 共享纯函数);修浮窗提交后文件预览被关闭(提交后主动 `reviewPanel.open()` + 保持当前文件 active)。
- **first-launch-onboarding**(`732b0c61a`+`aa3736a4a`+`148f42fb1`):首次启动自动建 `Documents/New DeskFox/` + 介绍文档(base64 内嵌官方群二维码,单文件),deep link 自动打开为工作区 + 介绍文档作首个 tab 激活;**老用户升级不自动打开**(复用 data-namespace 迁移 reason 做新老用户信号,存量用户只建不跳转、不打断恢复上次项目)。
- **deskfox-data-namespace-isolation**(`b27670758`):运行期数据/配置隔离到 `~/.local/share/deskfox` / `~/.config/deskfox`(XDG env 注入,0 改上游 core),修与另装上游 OpenCode 共用 `opencode.db` schema 打架必崩(2026-07-12 Intel 报障根因);首启非破坏 copy 迁移(旧目录保留、幂等 marker、失败保守回落)。**升级用户首启会做一次数据迁移(约 20s~1min,视库大小),属正常。**
- 其余:e2e smoke 外链资源加载失败过滤(session-timeline flaky 修,`ec4559e2d`)/ deploy yml 部署前磁盘实算 sha512(`d12fc7cdf`,Mac 端加固)/ macos-intel-x64-build(Mac 交叉打包,Win 路径 no-op 已审)。
- **Windows 端 QA(`chore/win-adapt-namespace-isolation`)**:TC-W1~W7 全过 — xdg-basedir Windows 实读 XDG env 坐实、真机实迁 2.1G 非破坏 + 原子完成、稳态 already-migrated ~66ms 零开销;发版前最终闸 G1-G5 全绿(全量单测 desktop 74/app 530/feishu 779/media-gen 140 + typecheck 22/22、老用户升级真机建而不开、新用户回归、冷启动 ×2 CLEAN、smoke 21/21)。详见 [docs/features/deskfox-data-namespace-isolation/](features/deskfox-data-namespace-isolation/3-changelog.md)。
- **发版前 code-review**:无高危。Win 运行时改动 21 文件全部经 G1-G5 实测;唯一未测 diff(`electron.vite.config.ts` node-pty 按目标 arch)在 Win 上 `DESKFOX_TARGET_ARCH` 未设回落 `process.arch`,行为不变。

**Release**:GitHub `ship-prod-2026.8.5`(latest)+ Gitee release(正文挂 CDN 链接)+ 阿里云 OSS CDN。
**updater**:Electron 自更新源 `updates.deskfox.ai/electron/prod/latest.yml` version=2026.8.5;Tauri→Electron 迁移桥 `v1/latest/desktop/windows/latest.json` version=2026.8.5。
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.5-win-x64.exe`(Electron;含 LibreOffice)

---

## [macOS] 2026.8.5 - 2026-07-08 16:30

**主题**:两笔小修的 patch 发版(2026.8.4 → 2026.8.5)— 右键项目「关闭」失效修复 + updater 部署脚本旧 IP 根治。

**本次内容**(自 `ship-mac-prod-2026.8.4` 起):
- **project-close-heal-race(Win 端修,Mac 同炸)**:右键项目「关闭」失效 — REQ-072 折叠竞态自愈效应误追踪 `projects.list()`,关闭当前项目时路由未切走被误判"被折叠"又补回 → 关不掉。修法 `isListed` 包 `untrack`(自愈只由路由进入/boot 完成驱动),效应抽 fork-only `project-restore.ts`。6 单测(3 复现+3 回归)+ 变异验证;Win CDP 三路径 + **Mac 本机真机 CDP 三路径**(关当前/关非当前/关最后一个,7 次关闭 0 次补回)+ user 真机确认,双端全过。`--conditions=browser` 修 bun 解析 solid server 构建 createEffect no-op 坑。
- **updater-deploy-stale-ip(Mac 端修)**:2026.8.4 发版后升级源静默不发的根因 — 3 个部署脚本 SSH host 硬编码旧 IP `52.197.46.120`(服务器已换 IP,SSH 22 死了 web 443 还活,scp 静默超时)。修法 SERVER 改 `${DESKFOX_UPDATE_SSH:-ubuntu@updates.deskfox.ai}`(域名 DNS 跟随 + env override)。**本次 ship 首战验证生效**(7.5 A/B 部署全走域名成功)。ship.md 步骤 7.5 新增 (C) 硬校验收尾(两条源 curl version==本次,红灯不许跳过),本次首跑 PASS。
- **发版前 code-review(4 finder,守 ≤5 预算)**:无启动崩溃/高危。5 项记录不阻断:① untrack 收窄自愈窗口(boot 后折叠场景,单窗口 reconciler booted guard 兜住,跨窗口单实例锁下不可达)② bridge 脚本 DESKFOX_UPDATE_SSH 读取时机早于 source config.env(与 deploy 不一致,override 写 config.env 对 bridge 无效;shell export 两者都生效)③ bootedWorktree 裸 `!==` vs pathKey 归一化不对称(既有行为,fail-safe)④ --conditions=browser 翻转 SSR 分支覆盖(全量 521 绿)⑤ 域名方案 DNS TTL/host key 残余风险(失败响亮 + (C) 硬校验兜底)。
- **验收**:app 单测 521 pass(Mac 复跑)+ 新 6 单测 + typecheck 0 错;公证 .app(DeskFox.zip Accepted)+ .dmg(ae73843c Accepted + staple)双过;spctl `Notarized Developer ID`。

**Release**:GitHub `ship-mac-prod-2026.8.5`(latest)+ Gitee release id 737621(正文挂 CDN 链接)+ 阿里云 OSS CDN。
**updater**:Electron 自更新源 `updates.deskfox.ai/electron/prod/latest-mac.yml` version=2026.8.5 ✅;Tauri→Electron 迁移桥 `v1/latest/desktop/darwin/latest.json` version=2026.8.5 ✅;7.5(C) 硬校验 PASS。staple 后 dmg 脏数据(size/sha512)已在部署前主动修正(上版踩坑本版内化为流程)。
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.5-mac-arm64.dmg`(Electron;含 LibreOffice;arm64)
**sha256**:`e96c0bc633113a47294b6c22086eeeaa8385ad93dac15f2bd330c35dd67920ca`(size 324464942)

---
## [Windows] 2026.8.4 - 2026-07-08 14:33

**主题**:右键项目「关闭」失效修复(REQ-072 自愈效应回归,Win/Mac 同炸)+ updater 部署脚本旧 IP 修;小更新进"补"位(2026.8.3 → 2026.8.4),与 mac prod 2026.8.4 号面追平。

**本次内容**(自 `ship-prod-2026.8.3` 起):
- **project-close-heal-race**(`defc4fe3e`):侧栏项目图标右键 →「关闭」点了没反应 — 2026-07-05 REQ-072 引入的"折叠竞态自愈"效应把 `projects.list()` 当依赖追踪,关闭当前项目时 list 先变、路由还没切走,效应误判"被误折叠"又 `open` 补回。修法:`isListed` 包 `untrack`(自愈只由路由进入 / 实例 boot 完成驱动),效应抽 fork-only `project-restore.ts` 可单测;6 单测(3 复现 + 3 回归)+ 变异验证红/绿;app `test:unit` 加 `--conditions=browser`(bun 把 solid-js 解析到 server 构建致 createEffect no-op,effect 类单测跑不动)。详见 [docs/features/project-close-heal-race/](features/project-close-heal-race/3-changelog.md)。
- **updater-deploy-stale-ip**(`5bb212798`,Mac 端修):`deploy-electron-updater.sh` / `bridge-electron-updater.sh` / `deploy-updater-manifest.sh` SSH host 硬编码旧 IP → 换 `updates.deskfox.ai` 域名,修 mac 2026.8.4 升级源静默不发;本次 Win ship 是该修复后首次 Win 端部署验证。
- **发版前 code-review(high workflow,8 agent 撞会话额度 → 候选 10 条人工逐条核验)**:无高危。2 条最重候选(「boot 后折叠不再自愈」)经 reconciler 守卫分析驳回(booted 项目根不可能被折叠);其余为治理/清理级记账 — SSH 默认值三脚本重复未收口 / DEPRECATED `deploy-updater-manifest.sh` 建议删 / mac dev·beta 号线落后 prod 历史倒挂 / `package.json` 改 script 无法留 FORK marker(靠 changelog+commit message 记录)/ updater-deploy-stale-ip 台账 hash 未回填(本次 chore 分支顺手补)。
- **验收**:main 上合并后全绿 — fork 范围 typecheck 22/22 + app 521(browser 条件)+ media-gen 140 + adapter-feishu-lark 779;真冷启动健康检查 ×2 CLEAN;CDP 真机三路径(关当前/非当前/最后一个项目)全 PASS。

**Release**:GitHub `ship-prod-2026.8.4`(`zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN)+ 阿里云 OSS CDN。
**updater**:Electron 自更新源 `updates.deskfox.ai/electron/prod/latest.yml` version=2026.8.4;Tauri→Electron 迁移桥 `v1/latest/desktop/windows/latest.json` version=2026.8.4。
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.4-win-x64.exe`(Electron;含 LibreOffice)
**sha512**:`4gCbXan6/FO0VxeetjVT5fM1f6kpZYB4vbmFEJ8pBAIl/c28Q6W1vI+T0dfLvRxeXzh/SIU3Yyc8pvkpsWLzTA==`(size 276038941)

---

## [Windows] 2026.8.3 - 2026-07-07 19:15

**主题**:飞书↔桌面 session 协同 + Windows 锚点适配 + 三笔独立小修(端口缓存/编辑按钮/聊天链接空白);小更新进"补"位(2026.8.2 → 2026.8.3)。

**本次内容**(自 `ship-prod-2026.8.2` 起,三批已合 main 的 feat):
- **feishu-desktop-session-sync(REQ-073/055)**:飞书↔桌面 session 协同 — 合并转发发言人昵称(chat-members 优先→contact 兜底 + 引用路径展开)/ 跨-DB dangling session 挂死修复(回读校验存在再复用)/ session 标题与桌面一致(描述性标题 + [botName] 前缀)/ 群场景标题竞态与发言人回落 / 桌面授权跨-instance 404 优雅降级 / 权限「谁触发谁展示」方案D + 按需查 permission.list。
- **win-anchor-hide-case-fold(REQ-069/072 Win 适配)**:`.deskfox` 锚点目录 attrib 隐藏 + 路径大小写折叠 relocate(Win 大小写不敏感、盘符差一位致 relocate/setId/forget 静默失效)/ boot autoselect·lastProject 匹配同款折叠 / 飞书权限卡片 reply 静默失败修复(SDK throwOnError 缺省吞错 → 显式检查,权限卡「允许一次」端到端解锁)。
- **batch-port-edit-mdlink(REQ-029/074/075)**:飞书 plugin 重启换端口后不再打旧端口(feishu.ts 缓存 mtime 失效,半自动端到端验杀 sidecar 自愈)/ 文件查看器右键「编辑」按钮复活(isTauri→isDesktopApp 换基座回归,真机验通)/ 聊天消息相对路径 md 链接点击不再整窗空白(共享拦截 util + 聊天区接线开预览 tab + main 进程 will-navigate/setWindowOpenHandler 兜底,顺手修 exa/webfetch _blank 弹裸窗 → 系统浏览器;CDP+真机验通)。详见 [docs/features/batch-port-edit-mdlink/](features/batch-port-edit-mdlink/3-changelog.md)。
- **发版前 code-review(high workflow)**:确认 1 项非高危记账 — `session.ts:597` scope=project 列表自愈对死路径 `fs.stat` 无超时,离线网络盘/U 盘残留目录场景侧栏刷新变慢(非崩溃非数据风险,待立 REQ 修);部分验证 agent 撞订阅限额、覆盖打折。无启动崩溃/高危项。
- **验收**:三批各自合 main 前全绿(typecheck 22/22 + app 515 + desktop/media-gen/adapter-feishu-lark 全过);batch 批 25 新单测;CDP 自测 + user 真机 QA 全过。

**Release**:GitHub `ship-prod-2026.8.3`(`zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN)+ 阿里云 OSS CDN。
**updater**:Electron 自更新源 `updates.deskfox.ai/electron/prod/latest.yml` version=2026.8.3;Tauri→Electron 迁移桥 `v1/latest/desktop/windows/latest.json` version=2026.8.3。
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.3-win-x64.exe`(Electron;含 LibreOffice)
**sha512**:`evjRRLA/q3ux6spbBzNC0TfJ+HeKV0QoBAU4CCKxcz2tNlx6+JOngZxVvIrP7Xu1NYwQKMYlcb6A10U56Yx3lA==`(size 276039679)

---

## [macOS] 2026.8.4 - 2026-07-08 00:31

**主题**:macOS 端发布飞书↔桌面 session 协同 + 锚点大小写折叠 + 三笔独立小修(与 Win prod 2026.8.3 同源 main),小更新进"补"位(mac 2026.8.3 → 2026.8.4)。

**本次内容**(自 `ship-mac-prod-2026.8.3` 起,三批已合 main 的 feat,与 Win 2026.8.3 同批):
- **feishu-desktop-session-sync(REQ-073/055)**:飞书↔桌面 session 协同 — 合并转发发言人昵称(chat-members 优先→contact 兜底 + 引用路径展开)/ 跨-DB dangling session 挂死修复(回读校验存在再复用)/ session 标题与桌面一致(描述性标题 + [botName] 前缀)/ 群场景标题竞态与发言人回落 / 桌面授权跨-instance 404 优雅降级 / 权限「谁触发谁展示」方案D + 按需查 permission.list。
- **win-anchor-hide-case-fold(REQ-069/072)**:`.deskfox` 锚点目录隐藏 + 路径大小写折叠 relocate / boot autoselect·lastProject 匹配同款折叠 / 飞书权限卡片 reply 静默失败修复(SDK throwOnError 缺省吞错 → 显式检查)。注:大小写折叠按路径形态判定(POSIX 不折叠),macOS APFS 默认大小写不敏感的同款场景为已知遗留(非本批新引入,待深修)。
- **batch-port-edit-mdlink(REQ-029/074/075)**:飞书 plugin 重启换端口后不再打旧端口(feishu.ts 缓存 mtime 失效)/ 文件查看器右键「编辑」按钮复活(isTauri→isDesktopApp 换基座回归)/ 聊天消息相对路径 md 链接点击不再整窗空白(共享拦截 util + will-navigate/setWindowOpenHandler 兜底)。详见 [docs/features/batch-port-edit-mdlink/](features/batch-port-edit-mdlink/3-changelog.md)。
- **发版前 code-review(3 角度收敛,4 角度撞会话额度未跑)**:无启动崩溃/高危项。记账 1 项非崩溃窄路径 bug — 方案D 权限过滤 `session-composer-state.ts:53` 的 `myPermissionIds` resource 以布尔 memo 为 source,同 session 并发两个待批权限时第二个本地权限会被陈旧快照过滤(飞书无人值守并发流才碰得到,imbot 常规顺序调用不触发),待立 REQ 修;另 `session.ts:597` scope=project 列表自愈死路径 fs.stat 无超时(承 Win 2026.8.3 记账)+ 若干 cleanup 项(inFlight 影子状态/标题逻辑重复/navigation-guard 死分支)一并入 follow-up。
- **验收**:三批各自合 main 前全绿;tag push pre-push 钩子 779 测试 0 fail;公证门禁 stapler validate + spctl「Notarized Developer ID」双过。

**Release**:GitHub `ship-mac-prod-2026.8.4`(`zoulukuang/deskfox`,latest)+ Gitee 镜像(id 736993,正文挂 CDN)+ 阿里云 OSS CDN。
**updater**:Electron 自更新源 `updates.deskfox.ai/electron/prod/latest-mac.yml` version=2026.8.4;Tauri→Electron 迁移桥 `v1/latest/desktop/darwin/latest.json` version=2026.8.4。
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.4-mac-arm64.dmg`(Electron;arm64;含 LibreOffice;Developer ID 签名 + 公证 + staple)
**sha256**:`e7fa755cd2c7f91c12df0b34b7a0eb9cf1a047e525f6cc030417bf92c4e4ea7a`(size 324459422)

---
## [macOS] 2026.8.3 - 2026-07-04

**主题**:macOS 端补发 stale 路径全族根治(与 Win prod 2026.8.2 同源代码),小更新进"补"位(mac 2026.8.2 → 2026.8.3)。mac 2026.8.2 曾用于「安装并重启」修复,故本批 stale-path 顺延到 2026.8.3。

**本次内容**(自 `ship-mac-prod-2026.8.2` 起,主体 [feat: stale-path-hardening]):
- **stale 路径全族根治**:同 Win 2026.8.2 —— REQ-067 大小写不一致 `/file` 500 兜底 / REQ-068 启动默认路径不存在 pre-check + 分模态引导 / REQ-061 改名后 worktree 三态重绑 + 侧栏显示新名 / REQ-064 编辑保存 stale id update 自愈重试。核心逻辑全抽 fork-only 新文件(`ignore-path` / `project-rebind` / `startup-precheck` / `fs-probe` / `project-update-selfheal`),上游仅 ≤数行注入。
- **两批发版前 code-review 修复(A-G + 批次2 A-D)**:fs-probe stat 超时竞速 / 死路径防呆 / 沙箱 orDie 保守保留 / update 自愈错误映射回原 id 干净 404 / 多选目录串行防竞态 / 离线盘 ENOENT 不误 forget / 自愈真错透传不掩盖 404 / 跨盘符绝对路径不泄漏 `.git`。
- **发版前验收**:main HEAD 合并态全套自动化测试全绿 —— typecheck 22/22 + media-gen 140 + feishu 740 + app 471 + opencode stale-path 63 + desktop fs-probe 10,0 fail;发版前 code-review(逐行 + 删除行为/跨文件)无崩溃/高危。mac 真机 QA(REQ-067/068/061)此前已回填验通。
- **公证**:.app + .dmg 均 Developer ID 签名 + Apple notary 公证 + staple;spctl accepted / source=Notarized Developer ID。(首跑撞 Apple 法律协议过期 403,签署后重跑通过。)

**Release**:GitHub `ship-mac-prod-2026.8.3`(`zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN)+ 阿里云 OSS CDN。
**updater**:Electron 自更新源 `updates.deskfox.ai/electron/prod/latest-mac.yml` version=2026.8.3;Tauri→Electron 迁移桥 `v1/latest/desktop/darwin/latest.json` version=2026.8.3。
**官网**:deskfox.ai 下载链接已更新部署。
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.3-mac-arm64.dmg`(309 MB)
**sha256**:`e57160da12d8376b9c3bfa3b3d55fa1db6c764e41f404e2cd1a9f61bd8e2e8c0`

---
## [Windows] 2026.8.2 - 2026-06-28

**主题**:项目入口 stale 路径全族根治(REQ-067/068/061/064)+ 两批发版前 code-review 修复;小更新进"补"位(2026.8.1 → 2026.8.2)。

**本次内容**(自 `ship-prod-2026.8.1` 起,主体 [feat: stale-path-hardening]):
- **stale 路径全族根治**:系统性修掉「项目文件夹改名/移动/默认路径不存在/路径大小写不一致」导致的文件树/文件请求 **500**、编辑保存静默失败、侧栏显示旧名、启动静默空白。四条 REQ —— REQ-067 大小写不一致 `/file` 500 防御兜底(护 mac 发布版)/ REQ-068 启动默认项目路径不存在的 pre-check + 分模态引导(目录删/改名/盘符未映射)/ REQ-061 改名后拉不到数据 + 侧栏旧名的 worktree 三态重绑 / REQ-064 编辑保存 stale id update 自愈重试。核心逻辑全抽 fork-only 新文件(`ignore-path` / `project-rebind` / `startup-precheck` / `fs-probe` / `project-update-selfheal`),上游仅 ≤数行注入。
- **发版前 code-review 批次1(A-G)**:fs-probe stat 超时竞速(离线盘不挂起阻塞启动)/ 首页最近列表手点死路径防呆 / 沙箱 orDie→保守保留 / update 自愈错误映射回原始 id 干净 404 / media-gen 增量重建。
- **发版前 code-review 批次2(A-D)**:high-effort workflow 复审命中并修掉 —— 多选目录串行打开防 navigate 竞态(A)/ 离线盘 ENOENT 用盘符根可达性区分真删 vs 整盘离线、可移动盘拔出不误 forget(D)/ 自愈重试真实错误透传不掩盖成 404(B)/ Windows 跨盘符/UNC 绝对路径不泄漏 `.git`/`node_modules`(C)。
- **同源 mac 修复随附**(mac 已发,Windows 二进制含但 mac-only 代码无副作用):macOS「安装并重启」只关窗口不升级修复 [feat: macos-install-restart-no-quit]。
- **验收**:两批共新增/扩展 30 单测全绿 + 回归全绿 + monorepo typecheck 全绿(强制无缓存);批次1 Windows 真机 QA 通过(REQ-068 目录删/改名模态 + REQ-061 改名重绑 + 侧栏显示新名端到端),REQ-067 mac 大小写 500→200 / REQ-068 unreachable 物理盘场景交接 mac QA。R4 override 本季累计 4 笔(季度自查重点项)。

**Release**:GitHub `ship-prod-2026.8.2`(`zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN)
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.2-win-x64.exe`(Electron;含 LibreOffice)
**sha512**:`g+M4eqVliYniboixfrx2LIz/yUYVIR8BItzSEs3lbhqObLTq/IUagNDlbkBp2WVWx2joNIPUCECNA5mTOR3K8g==`(size 275964945)
**国内下载**:`https://dl.clawtray.com/DeskFox-2026.8.2-win-x64.exe`
**升级源**:Electron 自更新 `updates.deskfox.ai/electron/prod/latest.yml` + Tauri 迁移桥 `…/v1/latest/desktop/windows/latest.json`(均线上回读校验 2026.8.2)

---

## [macOS] 2026.8.2 - 2026-06-22

**主题**:macOS「安装并重启」只关窗口不升级修复(patch,2026.8.1 → 2026.8.2)。

**本次内容**:仅一处 bug 修复 [feat: macos-install-restart-no-quit] —— 点更新提示「安装并重启」后只关桌面窗口、软件不真退、不升级(仅 macOS)。根因:DeskFox「关闭到托盘」在 `isQuittingFlag=false` 时把窗口 close 拦成 hide;`quitAndInstall()` 走 Squirrel.Mac 的 `before-quit-for-update`(非 `before-quit`)从不调 `setQuitting()` → 窗口被 hide、app 不退 → Squirrel.Mac 无法替换 bundle。修法:`withQuitIntent(autoUpdater, setQuitting)` 包一层,quitAndInstall 前先标记退出意图。**发版前验收**:复现单测 2 pass + desktop main 71 pass + typecheck 通过;真机端到端待存量用户升级实测。⚠️ 存量 2026.8.0/2026.8.1 用户旧版本身带 bug,需手动下载本版一次,之后应用内升级恢复正常。

**Release**:GitHub `ship-mac-prod-2026.8.2`(`zoulukuang/deskfox`,latest)+ Gitee 镜像(id 718726,正文挂 CDN)
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.2-mac-arm64.dmg`(Electron;含 LibreOffice,324304622 bytes / ~309 MiB;Developer ID 签名 + 公证 + staple)
**sha256**:`7f256a52827fc326fe3e74053f85895bf836dd1a34314af1ec6aacb0d80b2ebf`
**国内下载**:`https://dl.clawtray.com/DeskFox-2026.8.2-mac-arm64.dmg`
**升级源**:Electron 自更新 `updates.deskfox.ai/electron/prod/latest-mac.yml` + Tauri 迁移桥 `…/v1/latest/desktop/darwin/latest.json`(均线上回读校验 2026.8.2)
**公证**:notarytool Accepted(submission `86edb2c6-e5de-410e-bffa-5417bbd0b58e`)+ .dmg `stapler validate` 通过 + `spctl` accepted/Notarized Developer ID

---

## [Windows] 2026.8.1 - 2026-06-22 00:12

**主题**:Electron 首个 Win 稳定版 2026.8.0 之后的一波累积更新——自定义供应商模型列表实时同步 + 思考链/工具折叠对齐原生 + local 第 4 档本地测试版渠道 + 项目磁盘改名自愈重绑;小更新进"补"位(2026.8.0 → 2026.8.1)。

**本次内容**(自 `ship-prod-2026.8.0` 起):
- **自定义供应商模型列表同步**(feat: v2026.8.3):U2 连接/断开供应商后 providers query 强制失效实时刷新(`refreshProviders`);U3 GetBot 模型一键刷新 + 清除幽灵条目(`mergeGetbotModels` 纯函数);U4「检查更新」重复 toast 收敛为单一 region;U5 连续 shell/bash 工具纳入「已探索」折叠组(U1 REQ-066 Build 摘要重排已撤销)。
- **思考链对齐原生**(U6 REQ-053/058):AI 思考链默认收起 + 点击展开,复用原生折叠组件。
- **项目磁盘改名自愈**(U3 REQ-061/064):项目在磁盘改名/移动后,用选择器重开自动重绑 worktree;编辑项目保存失败不再静默卡死(弹 toast)。
- **local 第 4 档本地测试版渠道**:独立身份(appId `.local`)+ 数据隔离(`opencode-local.db`),永不发布;Win/Mac wrapper 双端对等;发布三档(prod/dev/beta)共享 `opencode.db` 杀进程规则矩阵定稿。
- **工程**:清退 10 个 Tauri 时代构建残留脚本;ship 流程健壮性(deploy 自加载 config.env + upload 跨平台 ossutil);L2/L3 e2e 测试体系 + 文件预览自动化 `verify-fileviewer.py`。
- 发版前 code-review:无高危项;思考链默认折叠 / bash 纳入折叠组为明确接受的交互变化。

**Release**:GitHub `ship-prod-2026.8.1`(`zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN)
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.1-win-x64.exe`(Electron;含 LibreOffice,263 MB;signtool 代码签名)
**国内下载**:`https://dl.clawtray.com/DeskFox-2026.8.1-win-x64.exe`
**升级源**:① Electron 自更新 `updates.deskfox.ai/electron/prod/latest.yml`(2026.8.1)② Tauri→Electron 迁移桥 `…/v1/latest/desktop/windows/latest.json`(2026.8.1,存量 Tauri 用户迁移)

---

## [macOS] 2026.8.1 - 2026-06-22

**主题**:累积发布(自 macOS 2026.8.0 换基座 Electron 首发以来)。内容属功能波次,user 拍板按 patch 号线发(2026.8.0 → 2026.8.1)。

**本次内容**:自 `ship-mac-prod-2026.8.0` 累积 ~110 文件 / ~3952 行 —— v2026.8.3 自定义供应商模型列表实时同步(U2 连接/断开后强制刷新 providers / U3 GetBot 刷新去幽灵 + mergeGetbotModels 纯函数 / U4 重复 toast 收敛 / U5 shell 折叠入「已探索」组)+ 本地测试版渠道(local 第 4 档独立身份 `ai.deskfox.app.local` + `opencode-local.db` 数据隔离 + LOCAL 徽标,prod 路径恒等保留)+ U1~U6 GUI(思考链默认收起点击展开 / 项目改名移动后选择器重开自愈重绑 worktree / 文件树文件夹选中态 filled 底色 / 编辑项目保存失败不静默 / 上下文卡片按 commentID 去重)+ Build 摘要行结构重排折叠 + 检查更新重复 toast 收敛 + Tauri 构建残留清退 + `.claude/commands` gitignore。**发版前验收**:步骤1 code-review 无高危(主进程 server/index/constants/migrate 改动对 prod 路径全部恒等保留)。

**Release**:GitHub `ship-mac-prod-2026.8.1`(`zoulukuang/deskfox`,latest)+ Gitee 镜像(id 718608,正文挂 CDN)
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.1-mac-arm64.dmg`(Electron;含 LibreOffice,324301530 bytes / ~309 MiB;Developer ID 签名 + 公证 + staple)
**sha256**:`c9d00b48f91dabd73b2d138538e26e234458b3f8e0690d5fe44679242a482c9a`
**国内下载**:`https://dl.clawtray.com/DeskFox-2026.8.1-mac-arm64.dmg`
**升级源**:Electron 自更新 `updates.deskfox.ai/electron/prod/latest-mac.yml`(线上 2026.8.1 回读校验)+ Tauri 迁移桥 `updates.deskfox.ai/v1/latest/desktop/darwin/latest.json`(线上 2026.8.1 回读校验)
**公证**:notarytool Accepted(submission `357e29a9-6b61-4975-9bb0-0048a761377e`)+ .dmg `stapler validate` 通过 + `spctl` accepted/Notarized Developer ID

---

## [Windows] 2026.8.0 - 2026-06-16

**主题**:换基座 Tauri → Electron 首个 Windows 稳定版(补齐 8.0 波次,与 macOS 8.0 对齐;`[Windows] 2026.7.2` 是最后一个 Tauri Windows prod)。SkipBump 发当前号 2026.8.0(不进补位)。

**本次内容**:Electron 基座 Windows 包(electron-vite build + electron-builder NSIS,内置 LibreOffice + 飞书/media-gen 插件 + electron-updater 自更新;signtool 代码签名)。自 `ship-prod-2026.7.2` 以来累积:Electron 换基座 Windows 打包链 + DeskFox verify 验收链(L0 静态 / L1 冷启动健康 / L2 CDP 交互 / L3 发布物编排器)+ verify-core Logic 清单单测(29 例)+ Tauri 作废脚本 DEPRECATED 横幅(防误用)+ electron 阶段2/3/4 与各 feature 文档收尾。**发版前验收**:L0 绿(typecheck + lint 0 error)/ L1 冷启动 CLEAN / L2 交互 24/24 PASS。

**Release**:GitHub `ship-prod-2026.8.0`(`zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN)
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.0-win-x64.exe`(Electron;含 LibreOffice,~263 MB;signtool 代码签名)
**国内下载**:`https://dl.clawtray.com/DeskFox-2026.8.0-win-x64.exe`
**升级源**:Electron 自更新 `updates.deskfox.ai/electron/prod/latest.yml`(2026.8.0)

---

## [macOS] 2026.8.0 - 2026-06-15

**主题**:换基座 Tauri → Electron 首个 macOS 稳定版。大更新进"次"位(2026.7.x → 2026.8.0)。

**本次内容**:Electron 基座(替换验证 + Developer ID 签名/公证 + electron-updater 自更新 + Tauri→Electron 迁移桥)。

**Release**:GitHub `ship-mac-prod-2026.8.0`(`zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN)
**installer**:`packages/desktop/dist-deskfox/DeskFox-2026.8.0-mac-arm64.dmg`(Electron;含 LibreOffice,~310 MB;Developer ID 签名 + 公证 + staple,.app 与 .dmg 均 Notarized)
**国内下载**:`https://dl.clawtray.com/DeskFox-2026.8.0-mac-arm64.dmg`
**升级源**:① Electron 自更新 `updates.deskfox.ai/electron/prod/latest-mac.yml`(2026.8.0)② Tauri→Electron 迁移桥 `…/v1/latest/desktop/darwin/latest.json`(2026.8.0,存量 Tauri 用户迁移)
**官网**:deskfox.ai Mac 下载链接已更新(`-mac-arm64.dmg`,deskfox-site `0785772`)

---

## [macOS] 2026.7.2 - 2026-06-13 09:52

(to be filled: commits / plugin / installer path after ship)

---
## [Windows] 2026.7.2 - 2026-06-12 10:15

**主题**:两笔体验型 bug fix——编辑项目头像保存不生效 + AI 回复"永久思考中"(SSE 死流空闲超时)。小更新进"补"位(2026.7.1 → 2026.7.2)。

**本次内容**(自 `ship-prod-2026.7.1` 起):
- **项目头像保存修复**(feat: project-avatar-save,bug-repro):编辑项目上传头像保存后侧边栏不显示(所有项目所有端)。根因:无 id / global 项目走 meta 保存路径时 override 只写 `projectMeta`(渲染端 enrich 不读)→ 死数据。修法:写入侧两条路径统一补写 canonical 的 `childStore.icon` + 读取侧 enrich 经 fork-only `resolveLocalIconOverride` 兼读 `projectMeta.icon.override`(4 单测)。
- **SSE 流空闲超时**(feat: llm-stream-idle-timeout,bug-repro + override-blacklist):直连 provider 的 LLM 流式请求原默认无任何超时,网络死连接(NAT/LB 静默丢链)→ 会话永久"思考中"留 tokens.output=0 残骸。修法:`chunkTimeout` 默认 120s(相邻 SSE chunk 间隔超时即 abort 走正常错误路径,可见可重试),只杀停滞流不杀健康长回复;用户可 per-provider 配置覆盖或 `false` 关闭。默认值逻辑抽 fork-only `stream-timeout.ts`(7 单测含停滞流 bug-repro),上游 `provider.ts` 仅 3 行接线;config schema 文档默认值与代码对齐。
- 发版前 code-review:4 角度审查无高危项;SSE 默认超时为 spec 内明确接受的行为变化(留 `chunkTimeout: false` 退出口)。

**Release**:GitHub `ship-prod-2026.7.2`(主仓 `zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN 地址)
**installer**:`packages/desktop/src-tauri/target/release/bundle/nsis/DeskFox_2026.7.2_x64-setup.exe`(含 LibreOffice,189 MB;NSIS 产物,未 Authenticode 签名但 updater 经 minisign 验签)
**updater manifest**:`updates.deskfox.ai/v1/latest/desktop/windows/latest.json`
**国内下载**:`https://dl.clawtray.com/DeskFox_2026.7.2_x64-setup.exe`

---

## [macOS] 2026.7.1 - 2026-06-12 10:33

**主题**:与 Win 2026.7.2 同批两笔体验型 bug fix——编辑项目头像保存不生效 + AI 回复"永久思考中"(SSE 死流空闲超时)。小更新进"补"位(2026.7.0 → 2026.7.1;Mac N 序列独立于 Win)。

**本次内容**(自 `ship-mac-prod-2026.7.0` 起):
- **项目头像保存修复**(feat: project-avatar-save,bug-repro):编辑项目上传头像保存后侧边栏不显示(所有项目所有端)。根因:无 id / global 项目走 meta 保存路径时 override 只写 `projectMeta`(渲染端 enrich 不读)→ 死数据。修法:写入侧两条路径统一补写 canonical `childStore.icon` + 读取侧 enrich 经 fork-only `resolveLocalIconOverride` 兼读 `projectMeta.icon.override`(4 单测)。**真机已验生效**。
- **SSE 流空闲超时**(feat: llm-stream-idle-timeout,bug-repro + override-blacklist):直连 provider 的 LLM 流式请求原默认无超时,死连接 → 永久"思考中"留 tokens.output=0 残骸。修法:`chunkTimeout` 默认 120s,只杀停滞流不杀健康长回复,可 per-provider `false` 关闭。
- 发版前 code-review:3 角度独立审查无高危项(守 ≤5 agent 预算)。

**Release**:GitHub `ship-mac-prod-2026.7.1`(主仓 `zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN 地址)
**签名公证**:Developer ID Application: shimin yue (GZ4LT9W9H9) + Apple 公证 Accepted + staple;下载双击直接打开,无 Gatekeeper 拦截
**installer**:`DeskFox-2026.7.1_aarch64.dmg`(含 LibreOffice,~224 MB)
**updater manifest**:`updates.deskfox.ai/v1/latest/desktop/darwin/latest.json`(线上 version=2026.7.1)
**国内下载**:`https://dl.clawtray.com/DeskFox-2026.7.1_aarch64.dmg`

---
## [Windows] 2026.7.1 - 2026-06-10 00:36

**主题**:追赶式 prod 发布——首页品牌化定稿 + LibreOffice 打包健壮性(干净机器首启修复)+ 飞书编辑弹窗 UX + 文件预览 UX 三件套 + macOS 修复 + 冷启动 toast 静默 + dev 独立版本号工具链。小更新进"补"位(2026.7.0 → 2026.7.1)。

**本次内容**(自 `ship-prod-2026.7.0` 起):
- **首页品牌化定稿**(feat: home-empty-onboarding-copy):上游 `<Logo>` 换 DeskFoX.Ai wordmark(半透明)+ 常驻欢迎引导文案(有无最近项目都显示)+ 钢蓝实心「打开文件夹」CTA(取色自 logo)+ 全 17 语言;品牌色走自有 CSS 变量,不动上游 token。
- **LibreOffice 打包健壮性**(feat: lo-bundle-coldstart-smoke-gate / lo-bundle-macos / libreoffice-user-install-fail-win):**剥皮保留 `presets/`** 修干净机器内置 LO 首启 `User installation could not be completed` fatal error(Win/Mac 双端,bug-repro)+ 冷启动 smoke 闸防过度剥皮 + 「发布物必含 LO」硬失败发布闸 + 打包后产物验证 + 防回归测试接入 CI。
- **飞书编辑弹窗 UX**(feat: feishu-edit-dialog-ux / feishu-settings-workspace-above-advanced / feishu-workspace-picker-hang):编辑弹窗去跟随勾选 + 默认自动免费模型 + 标题带 bot 名 + 列表显 workspace;`workspace_effective` 序列化 snake_case + 哨兵友好文案;选工作目录原生 picker 第一步卡死修复(async + spawn_blocking + set_parent/set_directory);工作目录区上移到高级能力之上。
- **文件预览 UX 三件套**(feat: new-project-hide-file-viewer-default / file-tab-close-others / filetree-hover-collapse-hint):新项目默认收起内容预览器(点文件才展开)+ 文件 tab 右键「关闭其他标签」+ 文件树「正在查看」行 hover 提示点击收起。
- **macOS 修复**(feat: macos-dock-reopen-show-window / macos-monterey-no-launch):Dock 图标点击重开主窗口(补 `RunEvent::Reopen`)+ Monterey 12 装完点击无反应修复(sidecar minos 13.0 → 12.0)。
- **冷启动 toast 静默**(feat: coldstart-project-reload-toast / coldstart-toast-race):冷启动重载项目的 transient 错(Missing queryFn / 连接级不可达)+ sidecar 看门狗重启窗口不再弹冗余红 toast;toast 起始位置上抬清过聊天输入框提交按钮。
- **dev 独立版本号工具链**(feat: dev-independent-version-line):DEV 预览版版本号从稳定版独立出来(Dev 领先模式),`installer-versions.json` 新增 `dev-*` 三端独立号线 + bump/build/pack 脚本按 `-Env` 选号线;prod 路径不受影响(已 Win 端实测三步验证)。

**Release**:GitHub `ship-prod-2026.7.1`(主仓 `zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN 地址)
**installer**:`packages/desktop/src-tauri/target/release/bundle/nsis/DeskFox_2026.7.1_x64-setup.exe`(含 LibreOffice,~189 MB;NSIS 产物,未 Authenticode 签名但 updater 经 minisign 验签)
**updater manifest**:`updates.deskfox.ai/v1/latest/desktop/windows/latest.json`
**国内下载**:`https://dl.clawtray.com/DeskFox_2026.7.1_x64-setup.exe`

---


## [macOS] 2026.7.0 - 2026-06-10 00:50

**主题**:匿名使用统计重做 + macOS Monterey 启动修复 + 首页品牌化 + 文件预览 UX 三件套 + 飞书与冷启动稳健性。新功能波次,版本号进"次"位(2026.6.0 → 2026.7.0)。

**本次内容**(自 `ship-mac-prod-2026.6.5.1` 起):
- **telemetry-usage-stats**:匿名使用统计重做(Node SDK → Tauri Rust 原生客户端,opt-out 默认开,最小匿名集 version/os/arch/install_id,fire-and-forget 不阻断启动)。
- **macos-monterey-no-launch**:Monterey 12 装完点击无反应修复(sidecar minos 13→12 回贴 + ad-hoc 重签 + `minimumSystemVersion` 钉 12.0)。⚠️ 真 Monterey 12 机器启动待验。
- **home-empty-onboarding-copy**:首页品牌化(wordmark + 常驻引导 + 钢蓝 CTA + 全 17 语言)。
- **文件预览 UX 三件套**:新项目默认隐藏预览器 / tab 右键关闭其他 / 文件树「正在查看」hover 收起提示。
- **feishu**:编辑弹窗 UX(去跟随勾选 + 默认自动免费模型 + workspace 路径单一真相源)+ 原生选目录 picker 卡死修复 + 设置 dialog 工作目录区上移。
- **coldstart**:看门狗重启窗口冗余红 toast 静默 + 重载项目 transient 错不弹冗余 toast + toast 起始位置上抬。
- **macos-dock-reopen-show-window**:Dock 图标点击重开主窗口(补 `RunEvent::Reopen`)。
- **lo-bundle-coldstart-smoke-gate**:LO 打包全链路稳健性(冷启动 smoke 闸 + 出货硬失败 + 发布闸 + 打包后验证)。
- **dev-independent-version-line**:DEV 预览版独立版本号号线(Dev 领先模式,构建工具,不影响 prod 运行时)。

**installer**:`DeskFox-2026.7.0_aarch64.dmg`(arm64,Developer ID 签名 + 公证 + staple)。

**已知边界**:① Monterey 12 真机启动待验(赌 Bun runtime 不依赖 macOS 13 符号)② 3 个新增 i18n key 仅 en/zh/zht,14 语言回退英文。

---
## [Windows] 2026.7.0 - 2026-06-07 15:56

**主题**:飞书桥接两大能力(账号级 workspace + LLM 卡死防护)+ 防休眠开关 + 匿名使用统计 + UI 品牌字收尾。新功能波次,版本号进"次"位(2026.6.1 → 2026.7.0)。

**本次内容**(自 `ship-prod-2026.6.1` 起):
- **飞书账号级 workspace**(feat: feishu-account-workspace):每个飞书账号可绑一个**专用真实项目目录**作为 agent 工作目录,让飞书 Agent 远程参与该项目开发;收到的文件/图片落 `<workspace>/_deskfox/feishu/{files,images}`(下划线前缀可见约定 + `.gitignore` 自动维护,未来多 IM 共用此根);改 workspace = 换新家从零开始(hot 生效无需重启);GUI 文件夹选择器(Rust `feishu_pick_workspace_dir`)+ 安全/对话记忆提示。
- **飞书 LLM 卡死防护**(fix: feishu-llm-stall-fastfail):provider 卡在可重试错误(如 503)不发任何输出时,dispatcher 原本干等 30min 硬超时致同 chat 串行队列堵死、整个聊天失联直到重启;新增「首字节活动」快速失败 —— 240s 内毫无输出即判 provider 无响应,提前失败 + 给飞书友好提示 + 释放队列(正常长任务有输出不误杀)。
- **防止电脑休眠开关**(feat: prevent-sleep):飞书桥接设置页新增防休眠开关,保障"飞书远程随时可用"(人不在电脑前时不被系统休眠中断);Rust 真相源 + 托盘/前端双向同步。
- **匿名使用统计**(feat: telemetry-usage-stats):Tauri 主力端接入匿名使用统计(Rust 原生客户端替代 Node SDK),config 原子写 + channel 隔离 + install_id 0600/UUID 校验;**默认可在设置/jsonc/env 关闭**(opt-out)。
- **UI 品牌字收尾**(feat: ui-brand-deskfox):UI 残留 "OpenCode" 品牌字统一改 "DeskFox"(走 i18n 替换层,保留 OpenCode Zen);修文件禁编辑提示硬编码中英混杂。

**Release**:GitHub `ship-prod-2026.7.0`(主仓 `zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN 地址)
**installer**:`packages/desktop/src-tauri/target/release/bundle/nsis/DeskFox_2026.7.0_x64-setup.exe`(含 LibreOffice,~198 MB;NSIS 产物,未 Authenticode 签名但 updater 经 minisign 验签)
**updater manifest**:`updates.deskfox.ai/v1/latest/desktop/windows/latest.json`
**国内下载**:`https://dl.clawtray.com/DeskFox_2026.7.0_x64-setup.exe`

---

## [Windows] 2026.6.1 - 2026-06-06 16:14

**主题**:启用 DeskFox 自家自动升级通道(Tauri updater)+ Win 安装包切 NSIS + 版本号改 3 段 semver + "运行中"图标卡死修复。**本条为新版本号体系(semver)首发 + 自动升级首发。**

**本次内容**:
- **启用自动升级**(feat: 启用自动升级):打通 DeskFox 自有 updater 通道——客户端按平台拉 `updates.deskfox.ai/v1/latest/desktop/{{target}}/latest.json`,minisign 公钥验签(私钥离线备份)。**装上本版后,后续版本可静默推送升级**(本版仍需手动安装一次)。
- **Win 安装包 Inno → Tauri NSIS**:删除 Inno Setup 脚本(`DeskFox.iss` + `ChineseSimplified.isl`,-571 行),改由 Tauri bundler 直接产 NSIS `.exe`(updater 兼容格式 + 自动产 `.sig` 签名)。
- **版本号 4 段日历号 → 3 段 semver `YYYY.次.补`**:旧 `2026.6.4.1` 非法 semver,updater 三端无法比较;新体系起步 `2026.6.0`,本版 `2026.6.1`(补位 +1)。build 时注入真实版本号,**修复历史 app 报 `0.0.0` bug**。
- **"运行中"旋转图标永久卡死修复**(feat: stuck-working-indicator-fix):进程被硬杀时残骸消息漏盖 `time.completed` 致图标永久转;后端 idle 自愈补盖 + 前端 `isWorking` 只看末条消息,provider 无关(飞书桥接等同样适用)。
- 配套:updater 配置回归守护(11 静态断言)+ branding 测试基建 + per-target manifest 生成器 `finalize-latest-json.ts`。

**Release**:GitHub `ship-prod-2026.6.1`(主仓 `zoulukuang/deskfox`,latest)+ Gitee 镜像(正文挂 CDN 地址)
**installer**:`packages/desktop/src-tauri/target/release/bundle/nsis/DeskFox_2026.6.1_x64-setup.exe`(含 LibreOffice,~189 MB;NSIS 产物,未 Authenticode 签名但 updater 经 minisign 验签)
**updater manifest**:`updates.deskfox.ai/v1/latest/desktop/windows/latest.json`
**国内下载**:`https://dl.clawtray.com/DeskFox_2026.6.1_x64-setup.exe`

---

## [macOS] 2026.6.5.1 — 2026-06-05 00:10

(to be filled: commits / plugin / installer path after ship)

---
## [Windows] 2026.6.4.1 - 2026-06-04 09:53

**主题**:sidecar 稳定性加固(REQ-049 看门狗自愈 + 插件截流)+ UI 细节优化 + 国内分发改走阿里云 CDN。

**本次内容**:
- **sidecar 看门狗自动重启**(REQ-049 Layer③):sidecar 崩溃/假死后,主进程每 5s 健康轮询、连续 3 次失败即**同 port 自动重启**(~15-20s 自愈),带熔断防 restart storm + 主动退出防误重启;前台"正在重连"提示。真机验证「杀 sidecar → 自愈」通过。起因 6/03 内置 agent 经 claude-code 插件跑重型 Workflow 撑爆 sidecar 致卡死。
- **claude-code 插件截流**(REQ-049 Layer①,配套 `deskfox-plugins` 仓):claude 海量 Workflow 事件(超长思考 / 大工具结果 / 大入参)进 sidecar 前有界化,防单进程内存撑爆(exit `0x80000003`),**答案与执行不变**。
- **UI**:toast 弹窗宽度收窄 1/5(400→320px,右下角更紧凑);文件树再次点击「正在查看 + 面板已开」的文件 → toggle 收起查看面板。
- **分发**:国内镜像改走阿里云 OSS/CDN(`dl.clawtray.com`),Gitee release 仅挂下载地址(prod 含 LibreOffice 超 Gitee 100MB 上限)。**本条为首次用阿里云 CDN 发 prod**。

**Release**:GitHub `ship-prod-2026.6.4.1`(主仓 `zoulukuang/deskfox`)+ Gitee 镜像(正文挂 CDN 地址)
**installer**:`packages/branding/installer/Output/DeskFox-2026.6.4.1-setup.exe`(含 LibreOffice,192 MB)
**国内下载**:`https://dl.clawtray.com/DeskFox-2026.6.4.1-setup.exe`

---

## [Windows] 2026.6.3.1 - 2026-06-03 19:10

**主题**:飞书文件接收(REQ-035/036)+ Windows LibreOffice 预捆绑 —— 装完零下载渲染 Office 文档(自 prod `2026.6.2.1` 起)。

**本次内容**:
- **飞书文件接收**(REQ-035/036):接收 txt/docx/pdf/xlsx/pptx/图片并提取文本注入会话 + 引用回复上下文注入;`file-content-extractor` + `message-pipeline` 大幅扩展,配套回归测试(xlsx 数字实体解码 / PDF pdfjs-dist 提取)。
- **Windows LibreOffice 预捆绑**(lo-bundle):精简版 LO 25.8.7 内置进安装包,装完无需二次下载即可渲染 Office 文档(安装包净增 ~123MB → 总 ~192MB)。
- Office 预览上限 200MB→1GB + 后端转换超时 30s→120s;`file-size-guard` 适配。
- Win ship SOP 入仓(`win-ship-命令` feat)+ ship 流程新增「步骤 3.5 填实台账」(**本条即首次实践**)。

**Release**:GitHub `ship-prod-2026.6.3.1`(主仓 `zoulukuang/deskfox`)+ Gitee 镜像
**installer**:`packages/branding/installer/Output/DeskFox-2026.6.3.1-setup.exe`(含 LibreOffice,192 MB)

---

## [macOS] 2026.6.3.1 — 2026-06-03 16:51

(to be filled: commits / plugin / installer path after ship)

---
## [Windows] 2026.6.2.1 - 2026-06-02 16:15

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

---

## [macOS] 2026.6.2.1 — 2026-06-02 16:23

(to be filled: commits / plugin / installer path after ship)

---
## [macOS] 2026.6.1.1 — 2026-06-01 18:33

**主题**:🔏 **首个 Apple Developer ID 签名 + 公证的 macOS 包**(自 prod `2026.5.29.1` 以来)。下载双击直接打开,不再被 Gatekeeper 拦/报「已损坏」。

**本次内容**:
- **macOS 代码签名 + 公证落地**(feat `macos-codesign-notarize`):集成进 `build-deskfox.sh`,Tauri 自动签 sidecar+.app(Developer ID + Hardened Runtime + 时间戳)+ API Key 公证 + staple。⚠️ 公证当时本地 `--wait` 超时,苹果服务端后来 `Accepted`,已 `stapler staple` 补票据。
- 创作模式 catalog 数据/代码分层 + 能力标签统一(feat `media-catalog-data-extract` / `catalog-capability-label-sync`)
- 测试治理:R8 测试用例清单 + R9 分支内验收闸 + pre-push 单测 backstop(feat `test-gate-and-spec-cases`)
- 工具:打包产物自动化验证脚本 A+B(feat `package-verify-script`)+ macOS `/ship` 一键发版命令(feat `macos-ship-命令`)

**Release**:GitHub `ship-mac-prod-2026.6.1.1`(主仓 `zoulukuang/deskfox`)+ Gitee 镜像
**installer**:`packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox-2026.6.1.1_aarch64.dmg`(已签名+公证+钉票)
**公证验证**:`stapler validate` ✅ / `spctl -a` = `Notarized Developer ID` ✅

---
## [Windows] 2026.6.1.1 — 2026-06-01 14:44

**主题**:catalog 数据/代码分层 + 测试治理 R8/R9 落地 + 一批桌面/飞书修复(自 Win prod `2026.5.29.1` 起)。

**本次内容**:
- 创作模式 catalog 数据/代码分层阶段1 + UI 能力标签对齐(CDP 真机验证)
- 测试纪律:R8 测试用例清单 + R9 分支内验收闸 + pre-push fork 包单测 backstop
- Ctrl+C 复制错内容 v2 根治 + 聊天输入框 focus scroll 修复
- 飞书 bot LLM 超时 / 空响应 surface 修复

**Release**:GitHub `ship-prod-2026.6.1.1`(主仓 `zoulukuang/deskfox`)+ Gitee 镜像

> 回填说明:本条 2026-06-03 从 ship 分支 `chore/ship-prod-win-2026.6.1.1` 的 commit `bd7946120`(原为待填占位)回流补录并填实 —— Win ship 流程当时未把台账合回 main,此次清理顺带修复。

---
## [macOS] 2026.5.29.1 — 2026-05-29

**主题**:多模态创作模式扩到三家 + Phase 2 Mac 真桌面 e2e 启用 + 桌面体验修复 + sortable bug 入需求池(自 prod `2026.5.28.1` 以来)

**新功能 / 改进**:
- **media-gen 第三家小米 MiMo Token Plan 接入**(REQ-030):3 档 TTS + Omni-ASR + 首次加 `tts_clone` / `tts_design` capability;前端模式菜单加两档 + VoiceDesign 输入框 + capability 联动(前端 3 处副本同步)。
- **Phase 2 真桌面 e2e Mac 端启用**:`packages/app/e2e-tauri-mac/` 平级独立,helpers 4 文件(osascript / cliclick / screencapture / window-bounds)+ saveDialog mock 方案 ②(env var + Tauri command `read_e2e_save_path_env`)+ deep_link 注入项目跟 Win page.goto 看齐;全量套件 3 passed + 1 skip / 1.3min(smoke-mac 2 + command-palette-flow-mac user-flow + md-to-word-real-mac fixme)。
- **聊天主循环 Phase 1 mock e2e 套件**:3 case 覆盖 user 视角(发消息→user msg→AI 回复 / sidebar 新 session 出现 / busy 期 progress 显示);chat-mock 路由全 RegExp 化 + SSE 改 `addInitScript` 路线 + assistant mock 补 `parentID + tokens + cost` 三件套。

**修复**:
- **主窗口标题品牌泄漏修复**:`title` 改读 `productName`(`DeskFox`),不再泄漏上游硬编码 `OpenCode`。
- **officeToolingInstall HttpApi 跟 Hono 对齐**:Effect endpoint 去掉多余 `payload Schema.Struct({})`,跟同 group 内 `initGit` / `abort` / `share` 无 body POST idiom 一致(P1 unit test stable fail 修,SDK 同步 regen)。
- **e2e Phase 1 webServer 走 dev:e2e-mock 激活 mock plugin**:原 `bun run dev` 缺 `--mode e2e-mock`,导致 `@tauri-apps/api/core` 未 alias + `window.__deskfoxE2eInvoke` 未注入,5 个 spec 同源 fail;改 webServer.command 一行修(P0 fix,13 pass / 0 fail / 32s,之前 5 fail 1.2min)。
- **md-editing-iter-3-visual 2 spec 标 `test.fixme`**:让 pre-push gate 不被 pre-existing fail 拦(REQ-035 走 A 方案,根因待深挖)。

**Revert(本期发现)**:
- **startup-sidebar-ready-gate revert(2 笔)**:① user 实测 Mac 上撞 2 个 bug(第一次点击未选 project tile 只变灰不切换 + gate 状态下鼠标 hover/move 误触发 sortable drag)② 后续诊断证实跟 ready-gate **无关**,是 **macOS Tahoe 26.5 WKWebView + Apple 触摸板 Tap to Click 上游 + 依赖兼容性 latent bug**(`sortable` / `DragDropProvider` / `@thisbeyond/solid-dnd@0.7.5` fork 0 改)③ 3 次 sensor fix 尝试均失败(提阈值 / mouseup 兜底 / 三重 capture phase 兜底),真根因待 WebKit Inspector 取 event timeline 实证 ④ ready-gate 本身 UX 不佳(opacity-60 + 阻 click 让 user 困惑),revert 后续重设计走 grip handle 避开 sortable activator 冲突 ⑤ sortable bug 入 OPENCODE-PLAN REQ-037 跟踪,Mac user 临时按压切换 / 外接 mouse 规避。

**配套 plugin**(随 .app bundle,同 Win 端 bundle 机制):feishu-bridge + media-gen(`DeskFox.app/Contents/Resources/plugins/` 下,启动自动注入 user opencode 配置)。
**质量**:全仓 typecheck 17/17;pre-push e2e 14 pass / 3 skipped(24.2s)。
**.dmg**:`DeskFox-2026.5.29.1_aarch64.dmg`(62 MB,Tauri bundle,未签名 — macOS Gatekeeper 首次右键 → 打开 → 仍要打开,或 `xattr -cr` 去 quarantine)。

---
## [Windows] 2026.5.29.1 — 2026-05-29

**主题**:多模态创作模式扩到三家(阿里 + MiniMax + 小米)+ 一批桌面体验修复(自 prod `2026.5.28.1` 以来)

**新功能 / 改进**:
- **media-gen 第二家 MiniMax 接入**(REQ-030):`speech-2.8-hd`(TTS,Token Plan 计费)/ `image-01`(文生图)/ `Hailuo-2.3`(海螺视频,异步三步引擎);catalog 改 by-provider 路由。
- **media-gen 第三家小米 MiMo Token Plan 接入**(REQ-030):3 档 TTS + Omni-ASR + 首次加 `tts_clone` / `tts_design` 能力;前端模式菜单加两档 + VoiceDesign 输入框 + capability 联动。
- **创作模式 @<路径> 文件引用** 接入 refFile / audioUrl(图编辑 / ASR / 图生视频可直接 @ 项目文件)。
- **国内 sidecar npm 走国内镜像 + 探活自愈**:Clash 网络环境下 sidecar 安装不再卡 registry。
- **冷启动 sidebar ready gate**:project tile 等 globalSync.ready 才出,顺手修 `globalSync.ready` 语义反了的 bug;splash 屏改极简版。

**修复**:
- **主窗口标题品牌泄漏修复**:`title` 改读 `productName`(`DeskFox`),不再泄漏上游硬编码 `OpenCode`。
- **REQ-031 托盘图标重开窗口**:关闭到托盘后点桌面 / Dock 图标重开窗口无反应。
- **REQ-032 选区菜单贴边沿被遮挡**:共享 `clampMenuToViewport` helper,溢出视口看不到点不到的菜单回正。
- **officeToolingInstall HttpApi 跟 Hono 对齐**:去掉多余 `payload Schema.Struct({})`(P1 fix,SDK 同步 regen)。
- **e2e Phase 2 真桌面 e2e 启用**(Win + Mac 双端):saveDialog mock + md-to-word-real 跑通,Phase 1 mock e2e 收敛三条 fixme。

**配套 plugin**(随安装包,同 2026.5.27.1 起的 bundle 机制):feishu-bridge + media-gen(`{app}\plugin\` 下,启动自动注入 user opencode 配置)。
**质量**:全仓 typecheck 17/17 cached;pre-push e2e 14 pass / 3 skipped。
**installer**:`DeskFox-2026.5.29.1-setup.exe`(~60 MB,Inno Setup,未签名)。

---

## [Windows] 2026.5.29.1-dev - 2026-05-29 16:02

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

---

## [macOS] 2026.5.28.1 — 2026-05-28

**主题**:多模态创作模式 + 飞书图片/合并转发识别 上线(macOS 端,自 prod `2026.5.25.1` 以来),含一批 mac 实测修复。

**新功能 / 改进**:
- **多模态创作模式(REQ-030)**:阿里通义全能力(文生图/图片编辑/文生视频/图生视频/语音合成/语音识别/专业翻译),结果融入聊天滚动流 + 产出落当前项目根 `creations/`,创作卡按 session 隔离,音/视频卡播放本地文件。
- **飞书**:图片识别 + 合并转发识别 + 单测 Win 兼容 + 合并转发图片优雅降级。

**本版 macOS 实测修复**:
- 创作模式 6 bug 链(首页卡片不显示 / 音视频播本地文件 / 创作卡 session 隔离 / 视频卡卡死 / 新建会话清 draft)。
- **飞书插件 "failed to load plugin (fs.existsSync undefined)" 修复**:插件入口不再 export 裸 helper(被 opencode getLegacyPlugins 误当插件调致 fs undefined),挪到 `workspace-migrate.ts`。
- bun.lock 补 media-gen workspace 条目。

**验证**:双轮 ship 验证通过(现有状态 + 干净状态,feishu 加载 0 错 / media-gen ok / 无 401/404/panic);飞书 622 单测 + 全仓 typecheck 17/17 + pre-push e2e 13 pass。

**产物**:`DeskFox-2026.5.28.1_aarch64.dmg`(arm64,不签名)。

---

## [Windows] 2026.5.28.1 — 2026-05-28

**主题**:飞书插件加载修复 hotfix(自 prod `2026.5.27.1` 以来)

**修复**:
- **飞书插件入口不再 export 裸 helper**(`e6d0735dd`):`migrate` / `cleanup` 等内部 helper 被上游 `getLegacyPlugins` 当成插件调用,触发 `failed to load plugin (fs.existsSync undefined)`。入口只 export 真正的 plugin 工厂,helper 内部化。

**配套 plugin**(随安装包):feishu-bridge + media-gen(`{app}\plugin\` 下,启动自动注入 user opencode 配置)。
**installer**:`DeskFox-2026.5.28.1-setup.exe`(~62 MB,Inno Setup,未签名)。

---

## [Windows] 2026.5.27.1 — 2026-05-27

**主题**:多模态创作模式上线 + 飞书图片/合并转发识别(自 prod `2026.5.25.1` 以来)

**新功能 / 改进**:
- **多模态创作模式(REQ-030)**:底部统一模式菜单(Chat + 文生图 / 图片编辑 / 文生视频 / 图生视频 / 语音合成 / 语音识别 / 专业翻译),阿里通义全能力;结果融入聊天滚动流(轻量卡 + 打开/文件夹),产出落**当前项目根 `creations/`**;创作卡按 session 隔离;音/视频卡播放本地文件。
- **media-gen 插件随包内置**(同飞书机制):安装后在「连接提供商」选 **Alibaba (China)** 填 API Key 即自动可用、零手动配。
- **飞书**:user 发图 bot 识别(image-recognition)+ 合并转发消息识别(merge-forward);Windows 兼容修复(图片下载路径越界真 bug);合并转发内图 graceful 降级(飞书平台 234043 限制,诚实提示用户)。
- **窗口可鼠标拖拽改大小**修复(不再开局锁死全屏/最大化)。

**配套 plugin**(随安装包):feishu-bridge + media-gen(`{app}\plugin\` 下,启动自动注入 user opencode 配置)。
**质量**:全仓 typecheck 17/17;单测全绿(app 711 / media-gen 28 / 飞书 622);创作模式真机 CDP 实测通过。
**installer**:`DeskFox-2026.5.27.1-setup.exe`(~62 MB,Inno Setup,未签名)。

---

## [Windows] 2026.5.25.1 — 2026-05-25

**主题**:首个生产级飞书桥接 + 文件编辑器增强(自 2026-05-15 prod `2026.5.15.1` 以来 175 commits,跟 Mac prod 2026.5.25.1 同源)

**新功能**:
- 🔗 **飞书桥接(全新)**:绑飞书 bot 账号后,直接在飞书 IM 跟 AI 对话
  - 私聊 / 群聊全支持(群聊默认 @ 才响应,可在 GUI 改"允许免@")
  - `/new` 清当前对话切话题
  - `/group <群名>` 显式创建群(替代易误触的自然语言建群)
  - `[ATTACH:/path]` 文件回传(图片 ≤10MB / 文件 ≤30MB)
  - 多账号支持 + 多群独立 session
- 📝 **文件查看器**:
  - 编辑态 1s 自动落盘 + 切 tab/关窗口前 flush 兜底(REQ-001 dirty tab)
  - 100MB+ 大文件预览防护 4 层(office 200MB / 媒体 ∞ / 用本机软件兜底)
  - 选区右键"加入聊天" + 焦点自动跟回输入框
- 🔍 **文件树**:
  - 多选 Shift/Ctrl 拖到聊天接通
  - AI 创建新文件后自动浮现(不用 F5)

**修复**:
- 聊天拖拽接收浮层卡死
- 飞书 ATTACH 上传 100% 失败(Bun + axios + Node form-data + Buffer 互操作 bug,iter 4 绕开整条 SDK 链才修)
- 中文文件名飞书展示乱码(`%E6%8A%A5%E5%91%8A.md`)

**治理**:
- 三档发布渠道规范化(Tier 1 prod / Tier 2 dev / Tier 3 本地)+ ship 脚本统一
- e2e 测试基础设施(Phase 1 mock mode)+ pre-push gate
- 主分支重命名 `dev` → `main`(2026-05-21,跟 installer channel `dev` 命名空间解耦)

**安装**:
- Windows:`.exe` 装到 `C:\Program Files\DeskFox\`(默认);沿用旧版安装路径自动检测(若之前装在 `D:\...` 等自定义路径会原地升级)
- 不签名 → 双击安装包 SmartScreen 弹"未识别"→ 点"更多信息"→"仍要运行"
- 配套 plugin:`feishu-bridge`(打包在 installer 内,装到 `<install>/plugin/feishu-bridge/`)

**已知遗留**(配套 backlog):
- 设置面板飞书桥接 OAuth `error sending request` — 触发原因:user `opencode.jsonc` 编码损坏导致 plugin entry 静默不注入(实测命中)。即将做的 [REQ-028 jsonc 编码自检](../docs/features/../OPENCODE-PLAN/需求池/opencode-jsonc-编码损坏自检.md) + [REQ-029 plugin port 前端刷新](../docs/features/../OPENCODE-PLAN/需求池/飞书plugin端口前端刷新.md) 会从根上解决

**回退**:之前 prod 是 `2026.5.15.1`(2026-05-15),如有问题可回装那个 .exe。

---

## [macOS] 2026.5.25.1 — 2026-05-25

**主题**:首个生产级飞书桥接 + 文件编辑器增强(自 2026-05-12 prod `2026.5.12.1` 以来 148 commits)

**新功能**:
- 🔗 **飞书桥接(全新)**:绑飞书 bot 账号后,直接在飞书 IM 跟 AI 对话
  - 私聊 / 群聊全支持(群聊默认 @ 才响应,可在 GUI 改"允许免@")
  - `/new` 清当前对话切话题
  - `/group <群名>` 显式创建群(替代易误触的自然语言建群)
  - `[ATTACH:/path]` 文件回传(图片 ≤10MB / 文件 ≤30MB)
  - 多账号支持 + 多群独立 session
- 📝 **文件查看器**:
  - 编辑态 1s 自动落盘 + 切 tab/关窗口前 flush 兜底(REQ-001 dirty tab)
  - 100MB+ 大文件预览防护 4 层(office 200MB / 媒体 ∞ / 用本机软件兜底)
  - 选区右键"加入聊天" + 焦点自动跟回输入框
- 🔍 **文件树**:
  - 多选 Shift/Ctrl 拖到聊天接通
  - AI 创建新文件后自动浮现(不用 F5)

**修复**:
- 聊天拖拽接收浮层卡死
- 飞书 ATTACH 上传 100% 失败(Bun + axios + Node form-data + Buffer 互操作 bug,iter 4 绕开整条 SDK 链才修)
- 中文文件名飞书展示乱码(`%E6%8A%A5%E5%91%8A.md`)

**治理**:
- 三档发布渠道规范化(Tier 1 prod / Tier 2 dev / Tier 3 本地)+ ship 脚本统一
- e2e 测试基础设施(Phase 1 mock mode)+ pre-push gate
- 主分支重命名 `dev` → `main`(2026-05-21,跟 installer channel `dev` 命名空间解耦)

**安装**:
- macOS:`.dmg` 装到 `/Applications/DeskFox.app`(Apple Silicon)
- 不签名 → 首次打开右键 → 打开 → 仍要打开

**回退**:之前 prod 是 `2026.5.12.1`(2026-05-12),如有问题可回装那个 .dmg。

**包内容**:
- main HEAD ship 节点:`2842ef378`
- 配套 plugin / sidecar:本地构建,跟 .app 同 commit
- 配套 installer:`DeskFox-2026.5.25.1_aarch64.dmg`(64.7 MB)

- GitHub Release `ship-mac-prod-2026.5.25.1`(主仓 `zoulukuang/deskfox`)
- Gitee Release(镜像 `zoulukuang/deskfox`)

---
## [macOS] 2026.5.24.1-dev — 2026-05-24

**包含**:feishu-bridge-light 三件套全套(`/new` 私聊清话题 / `[ATTACH:path]` 文件回传 / `[CREATE_GROUP:name]` opt-in 自动建群) + e2e-pre-push-gate + e2e-vite-warmup 等 main 上 commits。

- main HEAD ship 节点:`3842689c2`(Merge 'main' of github)
- feishu-bridge-light merge commit:`433a7557b`
- 测试基线:adapter-feishu-lark 391 pass / 0 fail / 803 expect
- 范围:仅本机自测,**未公开 ship**(不发 GitHub / Gitee Release)
- 用途:user 真机飞书 IM 实测 Phase 2/3 marker 协议(`[ATTACH:]` / `[CREATE_GROUP:]`),回归 OK 后再补完整 Tier 2 公开发布

---
## [macOS] 2026.5.21.1-dev — 2026-05-21 22:43

**主题**:Mac 端首次 Tier 2 预览版(`-dev` 后缀)— 自 [macOS] `2026.5.12.1`(2026-05-12 prod)以来主线 21 笔 commit 全部治理 / 工具改进,**无新增用户可见功能**。本笔 ship 重点是验证 Tier 2 流程闭环 + 把两笔 ship 翻车 fix 合入产品。

包内容:

- **sdk-falsy-empty-body-fix** ([changelog](features/sdk-falsy-empty-body-fix/3-changelog.md))— 补 2026-05-12 sdk-falsy-error-fallback-fix(surface fix)没盖的路径 ②(fetch.return-with-empty-body-4xx),wrapFetchWithFalsyGuard layer 2 不让 SDK 抛 `{}`。**5.21.1-dev ship 第一次撞**:user 装上启动报"Unknown error / 原因: {}",诊断后写此 fix。
- **frontend-stale-session-fallback** ([changelog](features/frontend-stale-session-fallback/3-changelog.md))— 接力上一笔到产品级闭环:`directory-layout.tsx` 启动 createResource 识别 stale session error 后 navigate 去掉 stale id 降级到主界面,不撞 ErrorBoundary。**5.21.1-dev ship 第二次撞**:fix 上一笔后错误信息从 `{}` 变成 `Server returned 401 with empty body: ...` 但 ErrorBoundary 仍出,写此 fix。
- **abandon-cloud-build-workflows** ([changelog](features/abandon-cloud-build-workflows/3-changelog.md))— 治理决策:云端 build workflow 永久废止,所有 ship 走本地。
- **ship-scripts-naming-fix** ([changelog](features/ship-scripts-naming-fix/3-changelog.md))— ship 脚本 4 个对齐新命名规则(strip env suffix + productName 空格转横杠),Tier 2 tag 识别。本笔实战首验。
- **installer-naming-cleanup** + **3tier-versioning-governance** + **rename-dev-to-main** + **installer-version-env-suffix** — 4-tier 体系治理(主分支 dev→main / installer 文件名去重 / 版本号 B2 双维独立 N / pack/bump 透传 env)2026-05-21 同期落地。
- **large-file-preview-guard** + **chat-drop-overlay-stuck-fix** + **chat-input-focus-follow** + **chat-selection-menu** + **file-tree-multi-drag-to-chat** + **file-tree-llm-write-refresh** + **html-viewer-ux-polish** + **html-viewer-allow-scripts** — 文件预览 + 聊天 UX 改进合集。

**Build**:

```
bash packages/branding/scripts/pack-installer.sh --env dev
# (5.21.1-dev 首 build → frontend bug,后续含 fix 重 build 走 --no-bump 保版本号)
```

**Release**:[GitHub Release `ship-mac-dev-2026.5.21.1-dev`](https://github.com/zoulukuang/deskfox/releases/tag/ship-mac-dev-2026.5.21.1-dev)
- 文件:`DeskFox-Dev-2026.5.21.1_aarch64.dmg`
- 大小:64.5 MB
- 架构:Apple Silicon(arm64,`aarch64-apple-darwin`)
- Bundle ID:`ai.deskfox.app.dev`(Tier 2 独立 AppId,跟 prod 同机共存)
- Prerelease 标:✅(对外预览版)

**双平台分发**(Mac ship 跟 prod 一致规则):
- GitHub Release `ship-mac-dev-2026.5.21.1-dev`(主仓 `zoulukuang/deskfox`)
- Gitee Release(镜像 `zoulukuang/deskfox`)

**验证**:e2e — restore stale state(`~/Library/Application Support/ai.deskfox.app.dev/`)后启动新 .app,frontend 通过 stale-session-fallback 自动 navigate 去掉 stale id,直接进 deskfox-plugins 工作区主界面。

---
## [Windows] 2026.5.21.1-dev - 2026-05-21 20:40

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

---

## [Windows] 2026.5.15.1 - 2026-05-15 09:39

**主题**:文件查看器 + 聊天对话区 UX 一致性大补 — HTML 预览 iframe 翻页 / UX 优化 + 文件树自动刷新 + 多选拖到聊天 + 聊天选区右键菜单。

5 笔 feat 合 dev 一次性 ship(12 commits 跨 4 笔 feat 分支,每笔代码 + docs + merge):

- **[html-viewer-allow-scripts](features/html-viewer-allow-scripts/3-changelog.md)**(`9acf2e5c3`)— iframe sandbox 加 `allow-scripts`,解决 PPT/Slides 翻页按钮等内嵌 JS 失效(讲师版 PPT 21 页 `◀ 1/21 ▶` 点击无反应)。跨 origin 论证(Win `tauri.localhost` vs `localasset.localhost` 不同 host、Mac `tauri://` vs `localasset://` 不同 scheme)→ MDN "scripts+same-origin combo" 警告不适用,iframe 内 JS 无法 reach parent。反转 `md-office-improvements` spec A1.9 "script 失活"决策

- **[html-viewer-ux-polish](features/html-viewer-ux-polish/3-changelog.md)**(`2ae3e14eb`)— Medium 4 块改动:① 去顶部 `预览/源码` toolbar + iframe 占满 + 编辑入口走右键 → CodeMirror html 语法模式(`@codemirror/lang-html@6.4.11` 新 dep,R4 第 6 笔本季已超配 user 授权) ② iframe 跨 origin 右键弹自家菜单 — `local_asset.rs` 给 HTML 响应注 capture-phase contextmenu listener(preventDefault native + postMessage x/y/选区文本 → 父),父侧 message handler 翻译坐标弹 mdMenu ③ 同注入脚本扩展 mousedown 通道修"右键弹菜单后左键点 iframe 内菜单不消失"bug ④ 阈值 2MB→10MB 对齐 `MAX_EDITABLE_BYTES`,>10MB 走 placeholder。5 个 Rust 单测覆盖 HTML 注入行为

- **[file-tree-llm-write-refresh](features/file-tree-llm-write-refresh/3-changelog.md)**(`5aa50eeec`)— AI 创建新文件后右侧文件树自动浮现。根因:`watcher.ts` `file.edited` 主路径对"路径不在 cache/open"直接 return,不刷父目录;busy→idle 兜底只走 expanded 目录,跳过 `loaded:true + expanded:false` 缓存目录 → user 重新展开看到旧 children,唯一破解 F5。修法:`!hasFile && !isOpen` 时若 `isDirLoaded(parent)` 则 `refreshDir(parent)`。R5 复现测试先写 + `[bug-repro: ...]` tag。watcher.test.ts 10→12

- **[file-tree-multi-drag-to-chat](features/file-tree-multi-drag-to-chat/3-changelog.md)**(`e2f7fef6c`)— 文件树多选(Shift/Ctrl 选 N 项)拖到聊天窗口接通。`file-tree-dnd` feat 留的 `application/x-deskfox-paths` MIME(JSON[abs paths])原本只设计树内移动,聊天侧 `attachments.ts` 只读单选 `text/plain: file:<rel>` → 多选拖等于啥都没拖。修法:新 `multi-path-drop.ts` 纯 helper(7 种边界容错)+ `handleGlobalDrop` 加多选 MIME 分支 N 个路径循环 addPart。helper extract 模式 + 10 单测

- **[chat-selection-menu](features/chat-selection-menu/3-changelog.md)**(`b71a4ad2e`)— 聊天对话区右键选区菜单替换 WebView2 原生菜单。DeskFox 自家两项(添加到聊天 / 复制)+ 输入面板模式跟文件查看器一致(textarea + Ctrl/Cmd/Opt+Enter)+ 红色 overlay(textarea 焦点丢原生选区 → 自家 fixed div 兜底)。新 `chat-selection-quote.ts` 纯 helper(composeQuotedMarkdown + insertTextIntoPrompt,12 单测)+ 新 `chat-selection-menu.tsx` 独立组件(capture-phase document contextmenu + scope `[data-slot="session-turn-list"]` + Portal 弹菜单)

**实测验证**(本机 2026-05-14/15):
- typecheck 16/16 ✅
- bun test:watcher 12/12 + attachments 17/17 + chat-selection-quote 12/12 + html-viewer Rust 单测编译干净 ✅
- pack-installer.ps1 -Env prod 1m32s + iscc 72s → 59.2 MB installer
- 安装到 `D:\softwares\DeskFox\`(user 自选路径)→ 启动 → 飞书绑定 OAuth ✅(首次撞 opencode jsonc plugin entry 残留,memory `reference_opencode_config_path_win.md` 沉淀)
- 五项 feat runtime 实测全过(PPT 翻页 + 文件树自动刷 + 多选拖 + 聊天选区菜单)

**installer**:`packages/branding/installer/Output/DeskFox-2026.5.15.1-setup.exe`(62,032,805 bytes)

**📦 安装步骤(给 user 看的)**:
1. 下载 `DeskFox-2026.5.15.1-setup.exe`
2. 双击运行(InnoSetup 向导),默认装 `C:\Program Files\DeskFox\` 或可自选路径
3. 装完会自动覆盖现有 prod 5.12.1(同 AppId `{F9F6F6C5-...}` → InnoSetup 升级模式,保留用户配置)
4. 首次启动 setup hook 自动 inject 飞书桥接 plugin 到 `~/.config\opencode\opencode.jsonc`(若 inject 缺失,手动 `plugin: ["file:///<install_dir>/plugin/feishu-bridge"]`)

**双平台分发**:
- GitHub Release `ship-prod-2026.5.15.1`(主仓 `zoulukuang/deskfox`)
- Gitee Release(镜像 `zoulukuang/deskfox`,Claude 自动跑 mirror-asset-to-gitee.ps1)

**已知**:setup hook `inject_plugin` 在某些场景(2026-05-15 user 实测)未自动写入 plugin URL(`inject_imbot_agent` 同步骤成功但 plugin 字段未注),手动 inject 即修。真 bug 留 backlog 后续 feat 调研

---

## [macOS] 2026.5.12.1 - 2026-05-12 12:22

**主题**:跟 Win 5.12.1 同步 — imbot v3 极简档(13 ask:9 unix + 4 win)+ dedup-cache-persist + feishu-plugin-dedup-decision + build-script-json-fallback + bug-repro grep 兜底 fix,Mac 端本地 build 出 prod .dmg。

跟 Win 5.12.1 内容完全一致(全部 feat 都在 dev 上,5.11.4 之后第一次 Mac ship),包内容:

- **imbot-permission-minimal**(v3 极简档,跟 Win 5.12.1 相同)
- **imbot-windows-delete-cmds**(v3.1 micro-patch,Mac 端 dead weight 但保留对齐 — bash 13 条 ask 含 4 条 Win 风格 pattern;Mac LLM 不会用 PowerShell 命令,0 行为影响)
- **dedup-cache-persist**(DedupCache 加 persistPath,Mac 端实测 sidecar 重启后 reload + skip 老 message_id)
- **feishu-plugin-dedup-decision**(开发机三档累积根因诊断 + 决策不做产品层防御 + build-deskfox.{sh,ps1} post-build 清理 hook)
- **build-script-json-fallback**(双 jsonc/.json fallback)+ **follow-up `33c7dd948`** Mac 端 bug-repro fix(`grep -c` 0 match 时 `|| echo 0` 多输出 `0\n0` 撞 bash arithmetic syntax error)
- **sdk-falsy-error-fallback-fix**(5.11.x 翻车真因 fix,在 dev 已合)

Mac 端实测验证(本机 2026-05-12 11:55 + 11:59 + 12:22 三次 build/launch):
- typecheck 16/16 ✅
- cargo test feishu_plugin_install 19/19 ✅
- bash -n build-deskfox.sh ✅,**stderr 干净**(grep fix 生效)
- prod build 1:22(总时间)/ cargo 35s
- setup hook 自动 inject prod 路径 + imbot v3.1 skip + 1 plugin instance + dedup persist load 6 entries + wss connected ✅
- **观察**:fresh prod 首次启动 sidecar idle 2 分钟+,user 反馈"晚了一会儿才点系统授权对话框",高度可能 TCC 阻塞 → backlog `prod-首次启动-sidecar-idle.md`

**installer**:`packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox-2026.5.12.1_aarch64.dmg`(64,645,764 bytes)

**📦 安装步骤(给 user 看的)**:
1. 下载 `DeskFox-2026.5.12.1_aarch64.dmg`(Apple Silicon arm64)
2. 双击 .dmg 挂载 → 拖 DeskFox 到 Applications
3. ⚠️ **不要双击 .app 启动!** .app 没数字签名,新版 macOS 直接提示 "DeskFox 已损坏,无法打开。您应该将它移到废纸篓"。先打开「终端」执行(只需一次):
   ```bash
   xattr -cr /Applications/DeskFox.app
   ```
   清掉系统的 quarantine(隔离)标记。
4. 然后双击 Applications 里的 DeskFox 启动
5. 首次启动会弹系统授权对话框 — 请点「同意」给本地文件访问授权,否则 DeskFox 内的飞书桥接 sidecar 不会立即启动(可能要 1-2 分钟才恢复 — 即`prod-首次启动-sidecar-idle.md` 需求池记的 TCC 阻塞)

**已知**:
- pack-installer.sh `--no-bump` 时跳过 rename(NEW_VERSION 为空)— 本次手动 rename,加进需求池后续修
- 首次启动 sidecar idle 2 分钟+ 是 TCC 授权对话框阻塞,user 必须点同意

**双平台分发**(2026-05-12 起新规则反转 — Mac 端 ship 也推 Gitee,之前 memory 立的"Mac 不跑 Gitee"分工撤回):
- GitHub Release `ship-mac-prod-2026.5.12.1`(主仓 `zoulukuang/deskfox`)
- Gitee Release(镜像 `zoulukuang/deskfox`)

---

## [Windows] 2026.5.12.1 - 2026-05-12 11:38

**主题**:imbot v3 极简档 + Windows PowerShell 删除命令补丁(v3.1)+ dedup-cache-persist + 多 feat 打包发车

继 5.11.4 之后第一次干净 build。这一版打包内容:

- **imbot-permission-minimal** ([changelog](features/imbot-permission-minimal/3-changelog.md))— v2 务实档(~30 条 ask)→ v3 极简档(8 条 ask):read 只拦 `.env` + `.ssh`,bash 只拦 8 条真不可逆破坏(`rm -rf` / `git push --force` / `aws s3 rb` / `aws ec2 terminate` / `dd` / `mkfs` / `fdisk` / `shutdown`),webfetch 撤回 allow。user 安全偏好"把隐私保护住,不能随意删除电脑信息就是相对可控的" — 信任飞书 IM 消息流可见(看得到 LLM 在做什么),把可逆操作信任度调高,正常 ship/dev/装包接近 0 打扰

- **imbot-windows-delete-cmds** ([changelog](features/imbot-windows-delete-cmds/3-changelog.md))— v3.1 micro-patch:实测发现 LLM 在 Win 默认 PowerShell shell 跑 `rm -rf` 时,opencode session sqlite 拿到铁证 `{"tool":"bash","input":{"command":"Remove-Item -LiteralPath ..."}}` — LLM 用 PowerShell 原生 `Remove-Item` 而非 unix `rm`,绕过 `bash["rm -rf *"]: ask`,**目录被真删**。补 4 条 Win 风格 pattern(`Remove-Item *` / `rmdir *` / `del *` / `rd *`)覆盖跨 shell 调用。bash 规则数 8 → 13

- **dedup-cache-persist** ([changelog](features/dedup-cache-persist/3-changelog.md))— Mac 端推的 DedupCache 持久化(JSON 落盘 + 原子 rename + corrupt 不 crash),Win 端 smoke test + 真飞书实测 dedup skip 日志铁证全过。sidecar 重启后 load 老 message_id 防 WSS 重连服务器重推老 message 时失忆

- **feishu-plugin-dedup-decision** ([changelog](features/feishu-plugin-dedup-decision/3-changelog.md))— "opencode.jsonc 累积多 feishu-bridge plugin entry → multi-instance → 双推" 根因诊断 + 不做产品层防御决策显式写下;`build-deskfox.{ps1,sh}` 加 post-build 清开发机 jsonc 多余 entry hook

- **build-script-json-fallback** ([changelog](features/build-script-json-fallback/3-changelog.md))— 修 build-deskfox 脚本 jsonc 清理只查 `.jsonc` 漏掉 `.json` 用户的开发者便利 bug。**只影响开发机**,普通用户 0 感知

- **sdk-falsy-error-fallback-fix** ([changelog](features/sdk-falsy-error-fallback-fix/3-changelog.md))— 5.11.x 翻车真因 fix。SDK `client.gen.ts` 的 `finalError || ({} as unknown)` falsy fallback 抛空 `{}` → SolidJS castError → "出了点问题 原因: {}" 错误页。在 `createSdkForServer` fetch 边界兜底转有效 Error,SDK 看到的 error 永远 truthy → fallback 不触发

实测验证(user Win 端 2026-05-12 上午):
- typecheck 16/16 ✅
- adapter bun test 286/289 ✅(3 fail 是 `defaultFilePath` / TTL / hasAndMark LRU touch,**pre-existing flake** 跟 imbot 无关)
- cargo test ⚠️ STATUS_ENTRYPOINT_NOT_FOUND env 老问题持续(dev 基线就有,跟改动无关,留 backlog)
- 飞书实测 imbot v3.1 + dedup-cache-persist 在 Win 真生效(sidecar log 铁证 `[wss] dedup skip om_xxx` + `[permission-card] sent card (bash) → Hebing—one + xiaobei_win`,user 主动点 once 删除测试目录)
- prod installer 装机预检全过(WSS 2/2 connected,1 plugin entry 不会双推,imbot v3.1 配置加载)

ship 流程: bump 2026.5.11.4 → 2026.5.12.1 → tauri build prod → ISCC pack 62MB(2026-05-12 11:38)→ 静默装 prod + 飞书实测 3 条全过

installer:`D:\project\opencode-fork\packages\branding\installer\Output\DeskFox-2026.5.12.1-setup.exe`

---

## [Windows] 2026.5.11.4 - 2026-05-11 23:02

**主题**:5.11.x 系列 ship 修复(vite chunking 非确定性 workaround) + imbot 安全 agent 终于推给 Win 用户

5.11.1 / 5.11.2 / 5.11.3 三次 ship 全撞 **vite chunking 非确定性 bug** — 同源码不同时刻 build 出来的 prod bundle,有时 OK 有时启动期 `castError` 撞死(SolidJS createResource → session.sync → SDK falsy-error fallback 抛 `{}` → SolidJS castError → 错误页)。详见 [`win-ship-prod-5.11.4` 3-changelog](features/win-ship-prod-5.11.4/3-changelog.md) bug 调查段。

- **win-ship-prod-5.11.4** ([changelog](features/win-ship-prod-5.11.4/3-changelog.md))— workaround:用当前 known-working `target/release/DeskFox.exe`(`b268ce694` dev tip 这次 build 实测多轮 UI 正常)**直接 ISCC 重打 installer,不重新 vite build**,避免再撞非确定性。**接受 mismatch**:installer 文件名 + Windows 控制面板显示 `5.11.4` / DeskFox UI 左下角版本牌显示 `v2026.5.11.2`(bundle 没动)
- 失败 ship 记录(均撤回 GitHub + Gitee):
  - `[Windows] 2026.5.11.1` — 用户实测装完立刻崩(撞 castError)
  - `[Windows] 2026.5.11.2` ([changelog](features/win-ship-imbot-5.11.2/3-changelog.md))— 同上,**已从 GitHub draft 删除 + 从 Gitee release 删除**(2026-05-11 16:50 清理)
  - `[Windows] 2026.5.11.3` — 本地 build 5.11.3 第二次重试,仍崩,未推外网

installer 路径:`packages/branding/installer/Output/DeskFox-2026.5.11.4-setup.exe`(59.2 MB,本地 ISCC pack,**target/release 沿用 22:53:13 dev tip 那次 build 的 binary**)

**用户视觉警告**:装出来 UI 显示 `v2026.5.11.2` 是预期,**不是 bug**。Windows "已安装应用"显示 `5.11.4` 才是 ship 标识。两个版本号都对应同一个 ship。

**根因还没真修**,留 backlog(vite manualChunks 显式分块 / SDK falsy-error fallback 改 Error 而非 `{}` / 下次 ship 时干净 rebuild 消除 mismatch),详见 5.11.4 changelog 后续 backlog 段。

---

## [Windows] 2026.5.11.2 - 2026-05-11 15:22 — **撤回**

> ⚠️ **此版本已撤回,GitHub + Gitee 两端 release 已删除**。安装会撞 vite chunking bug 启动期崩。新装请用 [`5.11.4`](#windows-202651114---2026-05-11-2302)。本 entry 保留作历史记录。

**主题**:Win 端补 ship 把 `feishu-bridge-imbot-agent` 安全 agent 推给 Win 用户(对齐 Mac 5.11.1)

[`2026.5.11.1`](#windows-2026511---2026-05-11-815) ship 时序撞 imbot merge 之前(10:24 ship → 13:14 imbot merge → 13:53 Mac ship),导致 Win 5.11.1 不含 imbot,同号 Mac 5.11.1 含。Win 用户飞书桥接 unattended 默认全权限,**安全 regression(相对 Mac)**,本笔补齐:

- **win-ship-imbot-5.11.2** ([changelog](features/win-ship-imbot-5.11.2/3-changelog.md))— Win 跨平台代码 0 改动需求(`feishu_plugin_install.rs` / `config-schema.ts` / `account-store.ts` 全部跨平台原生设计,含 Win UNC 路径处理 + Win Crypto 敏感目录),只走 ship 层补齐。前置审计(`chore/win-port-audit-mac-pack-installer` 分支已销毁)+ 三层 e2e 验证(独立 Rust binary 5 场景 / TS 16 unit / dev installer 实地装 + jsonc 注入确认)全过
- 走 [win-ship-local-pack-switch](features/win-ship-local-pack-switch/3-changelog.md) 第二次实战:本地 `pack-installer.ps1 -Env prod` build + 手动 `gh release create --draft` 带 `.exe` 附件 + curl Gitee API 创 release + `mirror-asset-to-gitee.ps1` 传附件

installer 路径:`packages/branding/installer/Output/DeskFox-2026.5.11.2-setup.exe`(59.4 MB,本地 build)

---

---

## [macOS] 2026.5.11.1 — 2026-05-11 13:49

**主题**:Mac 端跟随 Win [`2026.5.11.1`](#windows-2026511---2026-05-11-815) 同期更新,**新增 `imbot` 安全 agent 收紧飞书桥接 unattended 危险工具默认权限**

自 [`[macOS] 2026.5.7.1`](#macos-202657---2026-05-07-1418)(2026-05-07)以来 dev 主干推进约 50 commits,Mac 端首次 ship。除 Win 端 5.11.1 主题(权限卡片 + 4 笔机制 fix + pack-installer 修)外,Mac 端独立 ship 加 `feishu-bridge-imbot-agent` feat,主要包括:

- **feishu-bridge-imbot-agent** ([changelog](features/feishu-bridge-imbot-agent/3-changelog.md),merge `4a8970f50`)— 飞书桥接默认 agent `build` → `imbot`(setup hook 自动注入到 user opencode.jsonc,idempotent)。同 build 能力同 system prompt,但收紧 `bash` / `edit` / `write` / `apply_patch` / `webfetch` + 敏感目录 read(SSH / AWS / Kube / GPG / Keychain / Crypto)默认 ask。**安全闭环**:LLM 经 webfetch 拉 prompt injection 网页被诱导用 bash 数据 exfil 时,user 在飞书看到权限卡可即时拒绝。**主 GUI 0 影响**(仍走 build agent)
- **feishu-bridge-newuser-onboarding** ([changelog](features/feishu-bridge-newuser-onboarding/3-changelog.md))— 全新用户拿 .dmg 装完即用 happy path 加固:A1 plugin 路径失效自愈 / A4 default model 缺失检测 + 友好降级 / A3 .dmg 拖拽引导背景图(Swift CoreGraphics 660×400 PNG)
- **feishu-bridge-permission-card** + **feishu-bridge-empty-reply-ghost** + **feishu-server-loopback-bind** + **network-bind-safety-guard** + **feishu-plugin-install-win-path** 等 Win 同源 feat(同步进 Mac 端)
- 实测验证:**不通过飞书 IM 界面也能 e2e 测**(plugin server `/debug/simulate-message` curl + log 实证 imbot 真触发 + plugin permission card 完整渲染),memory `reference_imbot_agent.md` 已沉淀技巧

installer 路径:`packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox_1.14.33_aarch64.dmg`(arch=aarch64 / Apple Silicon)

**首次打开**:不签名 .dmg → 拖 .app 到 Applications → 右键 .app → 打开 → "仍要打开"(.dmg 内置 A3 背景图已引导)

---
## [Windows] 2026.5.11.1 - 2026-05-11 08:15

**主题**:飞书桥接 v1 深度迭代(权限卡片真互动 + 4 笔机制 fix)+ Win 网络监听安全规则 + pack-installer 顺序错位修

自 [`2026.5.10.1`](#windows-2026511---2026-05-10-1154) 以来 dev 主干推进约 30 commits,主要 feature:

- **feishu-bridge-permission-card** ([changelog](features/feishu-bridge-permission-card/3-changelog.md),merge `8d86d440d`)— opencode `permission.asked` Bus event 拦截 → 飞书 CardKit 渲染交互卡片(允许一次 / 始终允许 / 拒绝)→ user 飞书侧点击 → plugin 走 v1 SDK `postSessionIdPermissionsPermissionId` 回写 opencode 解锁。**保持 user 显式批准 trust 边界,不做 auto-allow**。实测踩 4 个坑陆续修通(v1 vs v2 SDK / patch 不刷新视觉 → delete+send / parentID 约束防 reject 回放上轮答案)
- **feishu-bridge-system-prompt-disable-question** + **feishu-server-loopback-bind** + **network-bind-safety-guard** + **feishu-bridge-completion-signal-rewire** ([4 笔机制 fix changelog 见各自 features/](features/),merge `183183119`)— ① 注入 system prompt 禁 LLM `question` 反问工具(修 agent loop 死锁,user 在飞书无法回答的场景)② plugin server bind 127.0.0.1 only(Win Firewall "Bun" 弹窗消除) ③ R6 网络监听安全规则 + pre-commit 4.5 hook 拦截 `Bun.serve(` 默认 0.0.0.0 ④ Layer 2 dispatcher 切换尝试 revert(opencode 多 assistant 消息序列锁第一条问题暴露,Layer 2.1 backlog)
- **office-installer-mirror-cascade** (`2d54b184d`)— LibreOffice 自动安装 mirror cascade fallback,单 mirror 失败不再 break 整流程(R4 override 延续 office 引擎 fork-only 链)
- **pack-installer-rebuild-step** ([changelog](features/pack-installer-rebuild-step/3-changelog.md),merge `b91e5f353`)— `pack-installer.ps1` 加 step 1.5 自动重 build,修 bump→build→ISCC 顺序错位 SOP bug(本笔 ship 即首次实战验证 — UI 版本号跟 installer 文件名对齐)

**Installer**:`packages/branding/installer/Output/DeskFox-2026.5.11.1-setup.exe`(62,263,972 bytes / 59.4 MB)

**配套 plugin**:`packages/branding/plugin/feishu-bridge/dist/`(plugin 已 bundle 进 installer,无独立分发)

**user 实测验证**(本笔 ship 即验证场景):
- ✅ 安装包文件名 `DeskFox-2026.5.11.1` + 装出来 UI 左下角显示 `v2026.5.11.1` 对齐(pack-installer fix 修通)
- ✅ 飞书 user 任务遇 opencode 权限请求 → 飞书侧弹交互卡片 → 点[允许一次]后 LLM 解锁继续,settled 卡片绿色 + 移除按钮
- ✅ user 点[拒绝]后,本轮无 useful assistant text → plugin 不回飞书,不再回放上一轮答案
- ✅ "始终允许"路径真飞书实测通过(2026-05-11 user 复测)
- ⏳ Mac 端跟随 ship 未启动(本笔仅 Win)

**Release**:等 user 决定走 GitHub Actions release-deskfox.yml workflow(push `ship-prod-2026.5.11.1` tag 触发)还是仅本地存档

**上游 baseline**:跟 dev 同步(sync-2026-05-03-2 后基线,~1.14.x + 上游推进)

---

## [Windows] 2026.5.10.1 - 2026-05-10 11:54

**主题**:飞书桥接 v1 首发 ship — adapter / OAuth Device Flow / WSS / plugin 架构 + Inno Setup 加 plugin bundle(让首装即用)

自 [`ship-prod-2026.5.9.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.9.1) 以来 dev 主干推进约 65 commits,主要 feature:

- **feishu-bridge** ([changelog 系列](features/) — `feishu-bridge` / `feishu-bridge-newuser-onboarding` 等多 feat 协同)— 飞书 IM 接入 opencode 的完整桥接 v1:adapter-feishu-lark workspace(SecretRef 三档凭证 + zod config schema + opencode HTTP client + OAuth Device Flow + localhost server + WSS 长连接 + chatQueue 串行 + FlushController CardKit/Patch 双路径节流 + DedupCache LRU)/ 桌面 system tray + close GUI ≠ exit + Tauri commands / Settings 飞书桥接 Tab + i18n 三本字典 + 扫码绑定弹窗 / chat-session-store(chatId → sessionID 持久化映射)/ per-account model 编辑 + hot reload / plugin + server(architecture X1:plugin 自带 server 多 IM 演进路径)
- **feishu-installer-bundle-plugin** (`39e487f75`,本笔 bump commit)— Win Inno Setup `DeskFox.iss` 加飞书 plugin bundle,prod installer 打 `packages/branding/plugin/feishu-bridge/dist/` 进 resource_dir,装完插件直接可用(修 bug-repro:之前 installer 不打 plugin → resource_dir 找不到 plugin → 飞书桥接永远显示"未启动")
- **feishu-bridge-empty-reply-ghost** ([changelog](features/feishu-bridge-empty-reply-ghost/3-changelog.md),merge `9ccaa391e`)— 5 条丢失 reply 修复(ghost filter + timeout 30min)

**Installer**:`packages/branding/installer/Output/DeskFox-2026.5.10.1-setup.exe`(61,462,332 bytes / 58.6 MB)

**user 实测验证**:
- ✅ 装出来飞书桥接 Settings 可见,OAuth 扫码绑定走通
- ⚠️ **已知 UI 版本号 mismatch bug**(本笔触发后立修)— user 装 .10.1 后想再 ship .11.1,跑 `pack-installer.ps1` 出 `DeskFox-2026.5.11.1-setup.exe`,但脚本顺序错位(先 bump JSON 再 ISCC 编但中间没 rebuild exe)导致**文件名 .11.1 + 内部 UI 仍 .10.1**。本版本身 .10.1 文件名 + UI 一致,可用。但触发 `pack-installer-rebuild-step` 修(见 [`2026.5.11.1`](#windows-2026511---2026-05-11-0815))

**Release**:本地存档,未上 GitHub Release(快速被 [`2026.5.11.1`](#windows-2026511---2026-05-11-0815) 取代)

**上游 baseline**:跟 dev 同步

---

## [Windows] 2026.5.9.1 - 2026-05-09 10:19

**主题**:MD → Word 导出第二轮迭代 — 全面保真度提升([feat: md-export-word-iter-2](features/md-export-word-iter-2/3-changelog.md),merge `ae96d138b`)

**包含 commit**(6 笔):
- `185ad127c` feat(desktop): fetch_url_base64 后端命令(远端图片走 Tauri reqwest)
- `194172129` chore(deps): 加 katex@0.16.45 + mathml2omml@0.5.0(数学公式 OMML 路径)
- `f5b22a840` feat(ui): viewer marked 4 个扩展(<mark>/emoji/heading anchor/嵌套 link 图片)
- `a8030f1f3` feat(md-export-word): docx 主体 — 15+ helper(HTML 标签/Alerts/blockquote/图片/表格/数学/目录跳转)
- `bfb6ca503` test(md-export-word): 单测 72 → 147
- `b2740f19a` docs(features): 三文档 + 索引

**用户可见亮点**:
- HTML 标签全转 Word 元素 + GFM Alerts 5 类彩色独立块 + blockquote 同段一体
- 远程图片自动嵌入 / 表格全边框 + header 灰底 / Mermaid 居中
- **数学公式 LaTeX → Word 原生公式可编辑可矢量**(KaTeX→MathML→OMML 路径)
- 目录 Ctrl+点击跳转 / ==高亮== 黄底 / GFM emoji shortcode / Word default 字号行距

**已知 deferred**(2 项,详见 OPENCODE-PLAN/需求池/):积分公式 ∫ 后占位框 + save dialog 默认按钮

**Installer 路径**:`build/installer/DeskFox-2026.5.9.1.exe`(GitHub Actions CI 产出)
**回退方法**:`git revert ae96d138b`

---

## [macOS] 2026.5.7.1 — 2026-05-07 14:18

(to be filled: commits / plugin / installer path after ship)

---
## [Windows] 2026.5.6.2 - 2026-05-06 15:25

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

---

## [Windows] 2026.5.6.1 - 2026-05-06 15:23

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

---

## [macOS] 2026.5.5.1 — 2026-05-05 23:43

**主菜:Mac 端 4 天累积更新一次性出 ship** — 自 [macOS] `2026.5.4.1`(2026-05-04 00:05)以来 dev 主干推进 38 笔 commit,涉及 markdown viewer 渲染 / 编辑 / 文件树 / i18n 全面增强,与 Win 端 [`2026.5.5.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.5.1) 同源。

主要内容:

- **md-editing-enhance** ([changelog](features/md-editing-enhance/3-changelog.md)) — MD 编辑体验增强(Tier B 全套 + Ctrl+F 查找 + post-launch 18 轮修复);加 `@codemirror/search` dep,新 `markdown-editor-extensions.ts`(+439 行)
- **md-office-improvements** ([changelog](features/md-office-improvements/3-changelog.md)) — MD 渲染 4 phase 全套上线:Phase 1 本地资源 protocol(.md 内 `<img>/<video>/<audio>` + HTML 预览)/ Phase 2 Frontmatter 隐藏 + Callout + 脚注 / Phase 3 Mermaid 流程图动态加载 / Phase 4 TOC 常驻面板 + MD 内链跳转;含 6 项 P0 渲染修 + 中文路径双重编码 + 脚注 SANITIZE_NAMED_PROPS 锚点 + 切 tab 文件树自动 active 高亮 + Win path 分隔符 + 4 项视觉 polish + 内链下划线密集恐惧修
- **file-tree-ux-polish** ([changelog](features/file-tree-ux-polish/3-changelog.md)) — 文件树 UX 5 项:① LLM 响应结束自动递归刷新 ② 节点右键菜单 4 组重整(删打印 + 加复制路径/刷新)③ 空白菜单 + 修刷新递归 ④ 默认面板展开 + tab "all" ⑤ 键盘 ↑↓/Enter/F2/Delete + macOS Backspace
- **menu-i18n** ([changelog](features/menu-i18n/3-changelog.md)) — 文件树菜单 / 对话框 / toast 接入 i18n 框架(en / zh / zht 三本 dict)
- **filetree-ctrlc-textsel-fix** + **viewer-ctrlc-fix** — 修聊天气泡 / md 查看器 / 非 .md 文档选文本后 Ctrl+C 失效(B 路径加文本选区闸 + shadow DOM 路径修)
- **actions-node24-bump** ([changelog](features/actions-node24-bump/3-changelog.md)) — workflows 升级 Node 20→24,清掉 GitHub 6/2 deadline 前 deprecation 警告
- **branch-pull-rule** — 治理硬规则:开新分支前必先拉最新 dev(CLAUDE.md 分支策略 v2 段)
- 其他治理沉淀(数据目录隔离评估暂搁 / spec 过期 frontmatter 修等)详见 [改动日志.md](../改动日志.md)

**Release**:[GitHub Release `ship-mac-prod-2026.5.5.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-mac-prod-2026.5.5.1)
- 文件:`DeskFox-2026.5.5.1_aarch64.dmg`
- 大小:55.49 MB(58,185,315 bytes)
- 架构:Apple Silicon(arm64,`aarch64-apple-darwin`)
- SHA256:`84957d09bb5bba2f3f558d77e27f21778adf71ca1d42912fedffce601c341f03`
- Bundle ID:`ai.deskfox.app`(prod,跟 sst/opencode 0 命名空间共享)

key commit: `c7e7cbb57`(本笔 bump commit;基于 dev `98cbe12d7`)
build run: [Actions run 25386808671](https://github.com/zoulukuang/deskfox/actions/runs/25386808671)(success)

**Gitee 镜像**:user 在 Win 端处理(2026-05-06 起 Mac 端 ship 不跑 mirror,见 memory)

**上游 baseline**:跟 dev 同步(同 `2026.5.4.1`,sync-2026-05-03-2 后基线)

---
## [Windows] 2026.5.5.1 - 2026-05-05 23:39

(待填: ship 后回填本条 — 包含 commits / 配套 plugin / installer 路径等)

---

## [macOS] 2026.5.4.1 — 2026-05-04 00:05

**主菜:Mac 端首次走 GitHub Actions 全自动 release**(对应 Win 端 [`ship-prod-2026.5.1.2`](https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.1.2) 已落地的同款链路,延伸到 mac 平台)。

自 [macOS] `2026.4.30.3`(2026-04-30)以来 Mac 端 4 天未 ship,这中间 dev 主干推进显著(跟 Win [`ship-prod-2026.5.3.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.3.1) 同源):

- **release-mac-ci** ([changelog](features/release-mac-ci/3-changelog.md)) — 新增 `release-mac-deskfox.yml` workflow,push `ship-mac-(prod|beta)-*` tag 触发 GitHub Actions `macos-latest` runner build .dmg + 创 draft Release;workflow 内自带 .dmg 重命名(对齐 Win)+ Release body 含 Gatekeeper "右键打开" 提示;**本笔即首次实战验证**(dispatch dev 7m13s + tag prod 4m50s 全绿)
- **sync-2026-05-03-2** ([changelog](features/sync-2026-05-03-2/3-changelog.md)) — 本季首次 sync upstream 成功,upstream 462 commits / 1157 文件 / +58k/-53k 行 全 take(Effect HttpApi infra / shared→core rename / Updater API rename 等)
- **office-routes-effect-httpapi** ([changelog](features/office-routes-effect-httpapi/3-changelog.md)) — fork 的 4 个 office routes(`/file/office-pdf` + `/office-tooling/{status,install,progress}`)迁到 PublicApi,httpapi-mode SDK 含 fork office method
- **updater-disable-adapter-rollback** — Updates 段控件灰显恢复(撤回 sentinel pattern UX bug)
- **repo-migration-deskfox** + **user-rename-zoulukuang** — GitHub 主仓 `yuesoue/opencode-for-office-deskfox` → `zoulukuang/deskfox`(同时 user rename),本笔 release 已挂在新仓
- **gitee-release-mirror** + 其他 sync 链路相关 prep / postmortem,详见 [改动日志.md](../改动日志.md)

**User 实测验证**:本机 `gh run download` 拉 .dmg + SHA256 校验通过(`831580ac... = Release body 期望值`,字节级一致)。dispatch dev 模式 .dmg 已开启 Gatekeeper 流程通过,prod 跟 dev 仅 productName / Bundle ID / icon 三档差异。

**Release**:[GitHub Release `ship-mac-prod-2026.5.4.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-mac-prod-2026.5.4.1)
- 文件:`DeskFox-2026.5.4.1_aarch64.dmg`
- 大小:52.32 MB(54,866,286 bytes)
- 架构:Apple Silicon(arm64,`aarch64-apple-darwin`)
- SHA256:`831580ac51aebd8ded330b32e63482b96aaa10929716f056f9198656723f08b7`
- Bundle ID:`ai.deskfox.app`(prod,跟 sst/opencode 0 命名空间共享)

key commit: `e9048e591`(bump commit;基于 dev `dd137fee5`)
build run: [Actions run 25284065820](https://github.com/zoulukuang/deskfox/actions/runs/25284065820)(4m50s,actions/cache 命中)

**上游 baseline**:跟 dev 同步(sync-2026-05-03-2 后,~1.14.x + 上游推进)

---
## [Windows] 2026.5.3.1 - 2026-05-03 14:04

**主菜:本季首次 sync upstream 成功**(吃了 462 commits / 1157 文件 / +58k/-53k 行 — 2-3 周的所有上游改进)。

主要内容:
- **sync-2026-05-03-2** ([changelog](features/sync-2026-05-03-2/3-changelog.md)) — upstream 462 commit 全 take,8 个 conflict 全 resolve,含 Effect HttpApi infra 大 PR / shared→core rename / Updater API rename(update→updateAndRestart + 加 relaunch)等
- **office-routes-effect-httpapi** ([changelog](features/office-routes-effect-httpapi/3-changelog.md)) — fork 的 4 个 office routes(`/file/office-pdf` + `/office-tooling/{status,install,progress}`)迁到 PublicApi,httpapi-mode SDK 含 fork office method
- **updater-disable-adapter-rollback** ([changelog](features/updater-disable-adapter-rollback/3-changelog.md)) — Updates 段控件灰显恢复(撤回早些时候 sentinel pattern UX bug)
- **win-bun-install-fix** ([changelog](features/win-bun-install-fix/3-changelog.md)) — Windows install 不再被 tree-sitter-powershell native build 阻断(对 dev env 影响,user 不感知)
- **changelog-archive-pre-v2** + **zod-schema-bridge** + **post-sync-build-fix** + **sync-2026-05-03-aborted** + **dev-typecheck-fix** + **updater-disable-adapter** — sync 链路相关 prep / postmortem / 治理沉淀,详见 [改动日志.md](../改动日志.md)

User 实测全过(office viewer / 聊天 / 文件操作 / 设置面板 / 安装入口 5 项)。

key commit: `ac5af022d`(本笔 release 起点 = bump commit 父,bump commit 是 release tag 内容)
installer 路径: 等 GitHub Actions 跑完 `ship-prod-2026.5.3.1` tag 后,从 [GitHub Release](https://github.com/zoulukuang/deskfox/releases/tag/ship-prod-2026.5.3.1) 下载

---

## [Windows] 2026.5.1.2 - 2026-05-01 22:20

**主菜:Win 首次走 GitHub Actions 全自动 release**(release-自动化 feat 落地首笔实战 ship,延伸到 Mac 端的链路即 [`ship-mac-prod-2026.5.4.1`](https://github.com/zoulukuang/deskfox/releases/tag/ship-mac-prod-2026.5.4.1))。

自 `2026.5.1.1`(同日早些时候)以来,新增内容全部为 release-自动化 feat 实施:
- **release-自动化** ([changelog](features/release-自动化/3-changelog.md)) — 5 笔 commit(`10c98374a` / `17b159f25` / `49ba8005c` / `b1092742a` / `59afb8413`):`.github/workflows/release-deskfox.yml` 主体 workflow + pre-commit 黑名单豁免 `*-deskfox.yml` + DeskFox.iss IconFile 按 AppEnv 走 + sidecar copy 前确保目标目录;push `ship-prod-*` tag 触发 GitHub Actions `windows-latest` runner build .exe + 创 draft Release

**Release**:[GitHub Release `ship-prod-2026.5.1.2`](https://github.com/zoulukuang/opencode-for-office-deskfox/releases/tag/ship-prod-2026.5.1.2)(**老仓** `zoulukuang/opencode-for-office-deskfox`,2026-05-03 仓库迁移到 `zoulukuang/deskfox` 时 release 没自动跟过来 — GitHub 设计如此)
- 文件:`DeskFox-2026.5.1.2-setup.exe`
- 大小:46.63 MB(48,897,142 bytes)
- 架构:x86_64 Windows(Inno Setup 打包,未签名)
- SHA256:`9751BECBC56FD280F97A4CBA5C6189F6B3C2D6374D23B70FE479D3CAB1A49FE3`
- AppId:prod GUID(锁死,详见 win-tri-env-appid feature)

key commit: `59afb8413`(bump commit;基于 `2026.5.1.1` 基础)
publish 时间:2026-05-01 22:50(UTC+8)

**上游 baseline**:1.14.21(沿用)

---

## [Windows] 2026.5.1.1 - 2026-05-01 14:21

**性质:Win prod 首笔自用 build**(本地 `pack-installer.ps1` 走 bump → build,**未挂 GitHub Release**;后续被同日 [`2026.5.1.2`](#windows-202651-2--2026-05-01-2220)(GitHub Actions 自动)取代,本笔保留作 build 链路验证记录)。

自 [Windows] `2026.4.29.2`(2026-04-29)以来 Win 端 2 天未 ship,这中间 dev 主干推进显著:
- **win-tri-env-appid** (`21c3f80f9`) — Win 三档 AppId 同机共存,`DeskFox.iss` 加 `#if AppEnv` 切 GUID(prod 锁死 / beta `{86413DCA-EA81-415A-A309-473EBFD78990}` / dev `{4C5D29F2-3BBB-49A2-B248-B74B716F8EA1}` 新生成),`pack-installer.ps1` 加 `-Env` 参数,Mac/Win 三档共存能力对齐
- **同期 macOS 工作**(对 win build 透明,但占同期 dev 主干):`macos-pack-installer` / `office-installer-macos` / `prod-bundle-id-fix` / `bundle-id-debrand` 等 — ship 在 `[macOS] 2026.4.30.2/.3` 两笔 mac entry 里
- **分支策略-v2** v1.0/v1.1 — dev 单一稳定主干 + 上游同步分离(`sync/upstream-<日期>` 临时分支)+ 远端主仓策略调整(GitHub 升 origin / Gitee 降镜像)
- **双端协作-SOP** v1.2 — feat 一次性容器 + Win/Mac 双端协作流程(rebase/merge/删分支)+ dev 上小补丁直推规则

**installer**:`packages/branding/installer/Output/DeskFox-2026.5.1.1-setup.exe`(**本地路径**,未上传 GitHub Release)

key commit: `60e617451`(bump commit;`pack-installer.ps1` 跑 bump → build → record bump 三联自动产物)

**上游 baseline**:1.14.21(沿用)

---

## [macOS] 2026.4.30.3 — 2026-04-30 16:30

**包含**(自 `2026.4.30.2` 之后唯一增量):
- `bundle-id-debrand`(`3fd5ceaf5`):Bundle ID 完整品牌切割,三档全去 `opencode` 字眼,改 `ai.deskfox.app` 系列(prod / `.beta` / `.dev`),reverse-DNS 与域名 `deskfox.ai`(在 user 手中)对齐;与 sst/opencode 上游 0 命名空间共享,未来 TCC / URL Scheme / Universal Link / OAuth callback 都不会冲突

**配套要求**:**首装零额外步骤** ✅ — 实测 macOS 14+ 对用户目录(~/Downloads / ~/Documents 等)TCC 自动放行,**无任何弹窗,直接可用**(此实测推翻了 `2026.4.30.2` entry 中"长期治理:加 Info.plist usage description"的提议 — 不需要做,问题不存在)。

**installer**:`packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox-2026.4.30.3_aarch64.dmg`(49,263,356 bytes)

**user 验收**:
- ✅ 装到 `/Applications/DeskFox.app`,Bundle ID 验证 `ai.deskfox.app`(完全无 opencode 字眼)
- ✅ 启动后访问 ~/Downloads → 无弹窗 → 直接列出文件 / 加载会话(macOS 14+ 自动 TCC 放行)
- ⚠️ **已知遗留**:应用程序网格里能看到 DeskFox 图标,但顶上**搜索框搜 "desk" / "fox" 搜不到**(Cmd+Space Spotlight 搜得到,Raycast 等第三方启动器也搜得到,只有 macOS 自带应用程序网格搜索没收录)。猜测原因:`ai.deskfox.app` 是全新 reverse-DNS 命名空间,系统索引刚 register 还没扫到 / 或对未见过的 reverse-DNS 有冷启动延迟。**不影响日常使用**,user 通过 Cmd+Space / Launchpad 图标点击 / Dock 等其它途径都能启动。下次治理(可能 `lsregister -kill -r` 全量重扫 / 等 Spotlight 完整扫描周期 / 重启 Mac)

**上游 baseline**:1.14.21(沿用)

---
## [macOS] 2026.4.30.2 — 2026-04-30 15:16

**包含**(自 Win `2026.4.29.2` 后的 macOS 全部增量,首版 macOS prod):
- `加聊天-option-enter`(`00b208eed`):文件查看器右键加聊天对话框 macOS 加 Option+Enter 提交快捷键 + 底部文案平台化(Tiny)
- `macos-pack-installer`(`373195692` + `833335031` follow-up):macOS 一键打 `.app/.dmg` 脚本 + apply-icons.sh 现场生成的 `icon.icns` 入 `.gitignore` + 4 sh +x 权限 + pack-installer.sh build 后自动 mv `.dmg` 加 installer 版本号(对齐 Win `DeskFox-YYYY.M.D.N-setup.exe` 命名)
- `office-installer-macos`(`fc69b462c`):LibreOffice 自动安装 macOS 适配 — DMG 下载 + hdiutil 挂载 + cp -R 到 `~/Applications` + soffice 检测路径(R4 override 第 4 笔本季,延续 `66c8fa523` 初版,wrapper 不可行论证见 changelog)
- `prod-bundle-id-fix`(`7618346fe`):prod / beta 各加独立 Bundle ID override,prod 用 `ai.opencode.desktop`(无 `.dev`)修 macOS 26 应用程序网格搜不到的问题;三档 Bundle ID 独立可共存

**配套要求**:首装 user 必须加 **"完全磁盘访问权限"**(系统设置 → 隐私与安全性)。原因:Bundle ID 改了 = macOS TCC 视为新应用,所有"文件夹访问"权限重置;Info.plist 又缺 `NSDownloadsFolderUsageDescription` 等声明,首次访问 `~/Downloads` 时不弹授权对话框,直接静默拒绝(EPERM)。**长期治理**:下笔加 Info.plist usage description 让对话框正常弹,届时装机零额外步骤。

**installer**:`packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox-2026.4.30.2_aarch64.dmg`(49,263,424 bytes)

**user 验收**:✅ 装到 `/Applications/DeskFox.app`(Bundle ID 验证 `ai.opencode.desktop` 干净)+ 加完全磁盘访问权限后,项目重新加载,文件 / 会话正常;应用程序网格搜 "desk" 可见 DeskFox

**上游 baseline**:1.14.21(沿用,`package.json` 不动避开上游冲突;dmg 文件名走 fork 自己的 installer 版本号 `2026.4.30.2`,.app 内部 `CFBundleShortVersionString` 仍是 1.14.21)

---

## [macOS] 2026.4.30.1 — 2026-04-30 13:01(已废弃,未 ship)

**废弃原因**:Bundle ID 沿用 base `tauri.conf.json` 的 `ai.opencode.desktop.dev`(prod.json 当时未 override identifier),macOS 26 应用程序网格搜索把 `.dev` 后缀 Bundle ID 当开发版隐藏 — 网格里图标可见但搜索栏过滤掉,不可接受。当天 push `7618346fe` 修复后重打 `2026.4.30.2`,本版 dmg 已被 `2026.4.30.2` 覆盖 / 不分发。

详见 `docs/features/prod-bundle-id-fix/3-changelog.md`。

---
## [Windows] 2026.4.29.2 — 2026-04-29 21:56

**包含**:
- md-viewer-typography:文件查看器看 .md 时排版升级 — 标题加粗阶梯 + 行内代码芯片 + 引用块/表头底色 + HR 显形(commit `f66b26be0`,Tiny,走 wrapper 0 上游侵入,0 override 消耗)
- 上一版 (.1) 包含的全部内容沿用(claude-code-loop-fix / plugin-cwd-channel / build-pipeline-sidecar-fix / icon-pipeline / installer-versioning)

**配套要求**:无 plugin 仓改动,纯前端 CSS scope 增量

**installer**:`packages/branding/installer/Output/DeskFox-2026.4.29.2-setup.exe`(49,095,582 bytes)

**user 验收**:✅ 装好正常启动,文件查看器 .md 排版生效(标题阶梯清晰),聊天侧排版无变化

**上游 baseline**:1.14.21(沿用)

---

## [Windows] 2026.4.29.1 — 2026-04-29 14:49

**包含**:
- claude-code plugin step loop 卡死修复(case-1,commit `e2a9d7167` R4)
- spawn-based plugin cwd channel(`_opencode.cwd` 协议增量,commit `41817499d` R4 第 3 笔特批)
- build pipeline sidecar 自动 build(commit `b9581b76e`)
- icon-pipeline-deep-fix follow-up:png-to-ico ≥256 修复(commit `303fbc583`)
- apply-icons.ps1 ASCII 化(已并入 `e2a9d7167`)
- installer 版本号规则规范化(本笔)

**配套要求**:
- plugin 仓 `D:\project\deskfox-plugins\claude-code\` commit `faf552c`(读 `_opencode.cwd`)+ dist build 完
- user 装新 installer 后,选项目 X → 发"在哪个项目里" → Claude 看到 X 路径 ✅

**installer**:`packages/branding/installer/Output/DeskFox-2026.4.29.1-setup.exe`(49,101,493 bytes)

**上游 baseline**:1.14.21(本仓 fork 起点;upstream/dev 现 1.14.28,可下季度 rebase)

---

## 历史(2026-04-28 ~ 2026-04-29 早些时候,旧 1.14.21 命名规则,Windows-only)

旧规则下 installer 都叫 `DeskFox-1.14.21-setup.exe`,接收方区分不开。从 2026.4.29.1 起统一新规则。

| 时间 | 旧文件名 | 含义 |
|---|---|---|
| 2026-04-28 21:17 | DeskFox-1.14.21-setup.exe(已弃)| installer-打包 + icon-pipeline-deep-fix 第 1 版 |
| 2026-04-29 11:48 | DeskFox-1.14.21-setup.exe(已被覆盖)| 含 case-1 fix(claude-code-loop-fix)|
| 2026-04-29 14:29 | DeskFox-1.14.21-setup.exe(已删,内容等于 .1)| 含 case-1 + cwd channel(完整),命名规则切换前最后一个 |
