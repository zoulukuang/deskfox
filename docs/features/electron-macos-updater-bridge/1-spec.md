feat-id: electron-macos-updater-bridge
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 阶段3:macOS Electron updater 部署 + Tauri→Electron 升级桥

> **规模:Large(改生产升级基础设施 + 影响存量用户迁移)。**
> **user 审签(2026-06-15)**:TD-2 = 先 A 后 B 分两 commit;TD-1 = `brew install minisign`;TD-3 = dev 端点部署 + 模拟拉取验签为验收门(prod 留发版)。

## 背景

换基座后 macOS 自动升级有两条链要打通:
- **新链(Electron→Electron)**:electron-updater generic provider 查 `updates.deskfox.ai/electron/<channel>/latest-mac.yml`(.zip + sha512)。
- **老链(Tauri→Electron 迁移)**:存量 Tauri mac 用户的更新器查老端点 `updates.deskfox.ai/v1/latest/<channel>/darwin/latest.json`(`.app.tar.gz` + minisign)。两链互不相见 → 不搭桥老用户永远收不到 Electron 版。

Win 侧已落地(`deploy-electron-updater.sh` 部署 + `bridge-electron-updater.ps1` 桥)。**本特性补 mac 侧两块。**

## 交付物

### A. Electron mac updater 部署(较小,低风险)
扩展 `deploy-electron-updater.sh` 支持 mac:把 electron-builder 产的 **`latest-mac.yml` + mac `.zip`**(electron-updater mac 用 zip 做增量/全量)部署到 `/var/www/updates/electron/<channel>/latest-mac.yml`,资产传 OSS。
- 现状脚本硬编码 `*-win-x64.exe` + `latest.yml`,加 `--platform mac|win`(或自动按产物判)分支:mac 找 `*-mac-arm64.zip` + `latest-mac.yml`。
- 让已装 Electron 版 mac 用户能 Electron→Electron 自动升级。

### B. Tauri→Electron mac 升级桥(大,高风险)
新增 `bridge-electron-updater.sh`(mac 版,对标 .ps1),产「摆渡 manifest」让老 Tauri mac 用户迁移:
1. **取 Electron `.app`**(签名 + 最好已公证)。
2. **tar 成 `.app.tar.gz`** —— 🔴 **必须 `COPYFILE_DISABLE=1 tar -czf`**,否则 BSD tar 塞 AppleDouble `._` 成员致老 Tauri `install_inner` 解压第 0 entry 就 EPERM 静默失败(2026-06-12 线上事故根因,见 [[reference-macos-updater-appledouble-trap]])。+ python3 `tarfile.getnames()` 断言无 `._` 成员防回归。
3. **minisign 签 tarball**(Tauri updater 验签格式;Tauri 私钥在 config.env `TAURI_SIGNING_PRIVATE_KEY`)→ `.sig`。
4. **finalize-latest-json.ts --target darwin** 生成 Tauri 格式 `latest.json`(platforms.darwin-aarch64[-app]),version 指定。
5. **部署**到老端点 `…/v1/latest/<channel>/darwin/latest.json`(复用 deploy-updater-manifest.sh 的 OSS+SCP 通道,或新脚本内联)。
- 老 Tauri mac 更新器下次查更新 → 下载 `.app.tar.gz` → 验 minisign → 解压**就地替换** Tauri .app 为 Electron .app(同 bundle id `ai.deskfox.app[.dev]` → 无感)。

## 🔴 关键风险点(R8 native 风险显式记)

1. **AppleDouble 陷阱(B步2)**:tar 必须 COPYFILE_DISABLE=1 + python3 防回归断言。`tar tzf`/bsdtar 会隐藏 `._` 成员,肉眼看不到,必须 python3 `tarfile` 暴露 raw 成员验证。
2. **版本号坑(B步4)**:摆渡 manifest version **必须 > 已发最高 Tauri mac 版**(老 Tauri 用日历号 YYYY.M.D);填 Electron semver(1.17.x)会被判降级不推。需先确认线上 Tauri mac prod 最高版本号。`.ps1` 有首段 <2000 防呆断言,mac 脚本照搬。
3. **签名工具缺失**:本机无 `minisign`/`tauri` CLI。需先定签名工具:① `brew install minisign` 用 minisign(memory 记录线上重发即用 minisign);② 或装 tauri CLI。**决策点,见下「待定」。**
4. **公证 vs tarball**:`.app.tar.gz` 内的 .app 应是已签名(阶段2)+ 理想已公证的。LO 重签会令 tarball 内 .app 变化 → 必须先签/公证好 .app 再 tar(顺序:阶段2 签名 → 公证 → tar → minisign)。
5. **生产部署安全**:所有部署脚本**必须先 `--dry-run`**(0 碰线上,只生成 manifest 到 /tmp + 打印命令),dev channel 端到端验证通过再上 prod;A/B 都先走 dev 端点验证(对标 2026-06-06 updater 适配的 dev 端到端验证后回滚占位)。

## 待定(请 user 拍板)

- **TD-1 签名工具**:桥的 minisign 签名用 ① `brew install minisign`(轻,memory 验证过)还是 ② 装 tauri CLI(重,但跟 .ps1 一致)?**建议 ①**。
- **TD-2 范围/分期**:本次做 ① 只 A(Electron mac 部署,小而稳)② 只 B(桥,大而险)③ A+B 都做?**建议先 A 后 B 分两 commit**,A 验证通过再上 B。
- **TD-3 验证深度**:B 的端到端(真造一个老 Tauri 版 + 真升级)成本高;最低限度走 **dev channel 部署 + 模拟老 updater 拉取验签**,prod 留发版时。是否接受 dev 验证为本特性验收门?

## R8 测试用例清单(动工前锁定,A/B 各自)

### A(Electron mac 部署)
| # | 验什么 | 命令/方法 | 预期 |
|---|---|---|---|
| A-1 | latest-mac.yml 改写 | `--platform mac --dry-run` | /tmp 生成的 yml 内 url 为 OSS 绝对地址、version 对 |
| A-2 | dev 端点部署 + 回读 | dev 真部署 | `curl …/electron/dev/latest-mac.yml` version 命中 |
| A-3 | Electron→Electron 升级 | 装低版本 dev → 起 app | 检测到新版、下载 .zip、装上 |

### B(Tauri→Electron 桥)
| # | 验什么 | 命令/方法 | 预期 |
|---|---|---|---|
| B-1 | **tarball 无 AppleDouble** | `python3 -c "import tarfile;print([n for n in tarfile.open(p).getnames() if '/._' in n or n.startswith('._')])"` | **空列表**(0 个 `._` 成员) |
| B-2 | minisign 签名有效 | minisign -V 或 Tauri 验签逻辑 | 验签通过 |
| B-3 | latest.json 格式 | 看 platforms.darwin-aarch64 | url=OSS、signature=.sig 内容、version > Tauri 最高版 |
| B-4 | 版本防呆 | 故意填 1.17.x | 脚本拦截报错 |
| B-5 | dev 端点端到端 | dev 部署 + 模拟老 updater 拉取 | 下载 + 验签 + 解压不 EPERM(最小 Rust/tar 复刻 install_inner) |

## 影响范围 / 回退
- 改 `deploy-electron-updater.sh`(加 mac 分支)+ 新 `bridge-electron-updater.sh` + 三文档。全 fork-only(packages/branding/scripts),非黑名单。
- 部署是对**线上服务器**操作 —— dry-run 先行、dev 先验、prod 后上;dev manifest 验完回滚占位(不污染 dev 用户)。
- 回退:manifest 是覆盖式部署,旧 manifest 可重新部署回退;脚本改动 `git revert` 可逆。

## 验收门(R9)
A-1~3 + B-1~5(尤其 B-1 无 AppleDouble + B-5 dev 端到端解压不 EPERM)在 **dev channel** 全绿;prod 部署留正式发版。
