feat-id: electron-macos-updater-bridge
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog:实际改动

## Part A:Electron mac updater 部署(2026-06-15)

### 改动文件
| 文件 | 改动 | 黑名单 |
|---|---|---|
| `packages/branding/scripts/deploy-electron-updater.sh` | 加 `--platform mac|win`(缺省 uname)+ mac 多资产分支 | 否(packages/branding) |
| `docs/features/electron-macos-updater-bridge/{1-spec,2-plan,3-changelog}.md` | 新增三文档 | 否 |

### deploy 脚本改动要点
- `--platform mac|win`(缺省按 `uname`):mac → `latest-mac.yml` + `DeskFox*-<ver>-mac-arm64.{zip,dmg}`;win → `latest.yml` + `*-win-x64.exe`(**原行为不变**)。
- 资产从单个 → **数组**(mac 含 zip+dmg,各带 .blockmap);URL 改写从单 sed → 多资产 sed -e 循环(files[].url + path 各 basename → OSS 绝对 URL)。
- 自检升级:`grep ': +DeskFox.*\.(zip|dmg|exe)$'` 拦未改写的残留相对 url/path。
- Gitee 镜像挑用户面安装包(mac=.dmg / win=.exe)。
- 远端部署路径/校验 URL 用 `$YML_NAME`(latest-mac.yml / latest.yml)。

### 验证(R8 TC)
- ✅ **A-1**(dry-run,0 碰线上):完整未签名 dev bundle 出 `latest-mac.yml` + zip(337MB)+ dmg(324MB)。`--platform mac --env dev --version 2026.6.0 --dry-run` → 改好的 yml 内 **3 处 url/path 全改 OSS 绝对地址**、sha512/size 保留、version 对、自检过、资产枚举正确、Gitee 选 dmg、SSH key 命中。
- ✅ **A-2**(dev 真部署 + 回读,user 点头后执行):OSS 上传 zip 337MB + dmg 324MB + 2 blockmap 全成功;SCP latest-mac.yml → 服务器;**回读校验线上 version=2026.6.0 == 发布版本**;独立 `curl` 复验线上 manifest + zip CDN HTTP 200。**验后已回滚**(SSH 移除 dev latest-mac.yml → HTTP 404,恢复部署前态;OSS 资产留存无害)。
  - **顺手修 pre-existing bug**:`mirror-asset-to-gitee.sh` 首参是 release tag(位置参数),原 deploy 脚本(含 Win 路径)只传 `--asset` 漏 tag → Gitee 镜像必失败(非致命,主下载走 OSS)。修:传 `electron-<env>-<ver>` 做 tag。
- ⏳ **A-3**(Electron→Electron 升级):发版后真验。

## Part B:Tauri→Electron mac 桥(2026-06-15)

### 改动文件
| 文件 | 改动 | 黑名单 |
|---|---|---|
| `packages/branding/scripts/bridge-electron-updater.sh`(新) | mac 升级桥:tar+签+finalize+部署 | 否(packages/branding) |

### 签名路线 de-risk(关键)
- user 选 minisign(TD-1)。实测验证 **minisign 直签 Tauri 兼容**:Tauri 私钥(config.env `TAURI_SIGNING_PRIVATE_KEY`)解码出来是 `rsign encrypted secret key`;minisign 0.12 默认 **ED 预哈希**(与 Tauri 一致);`minisign -V` 用 Tauri 公钥(key ID `2A008F3DA4940FDE`)验签通过;**`.sig = base64(.minisig 全文)`** = Tauri updater .sig 格式。无需装 tauri CLI。
- ⚠️ 隐私:处理 `TAURI_SIGNING_PRIVATE_KEY` 全程不回显(`--help` 会泄露),输出过滤 base64。

### 桥脚本要点
- `--app <Electron.app> --version <日历版> --env <ch> [--deploy] [--dry-run]`。
- ① **`COPYFILE_DISABLE=1 tar`** 打 `.app.tar.gz`(防 AppleDouble ._ 致老 Tauri install_inner EPERM)+ python3 `tarfile.getnames()` 断言 0 个 `._` 成员。
- ② minisign 签(Tauri 私钥,密码经 stdin 不回显)→ `.sig = base64(.minisig)`。
- ③ `finalize-latest-json.ts --target darwin` → Tauri latest.json(`darwin-aarch64[-app]`,url 指 OSS tarball)。
- ④ `--deploy`:OSS 传 tarball + SCP latest.json 到老端点 `v1/latest/<channel>/darwin/latest.json`(channel: prod=desktop / dev=desktop-dev / beta=desktop-beta)+ 回读。
- 🔴 **版本号防呆**:`--version` 首段 < 2000 拦截(老 Tauri 日历号 YYYY.M.D;填 Electron semver 1.17.x 会判降级)。
- ⚠️ **真迁移须喂【签名+公证好】的 .app**;本地验证用未签名 .app 测桥机制(机制与签名状态无关)。

### 验证(R8 TC,本地全绿)
- ✅ **B-1** tarball 无 AppleDouble:4159 成员 / **0 个 `._`**(python3 断言)。
- ✅ **B-2** minisign 签 Tauri 可验:`minisign -V` 用 Tauri 公钥验通("Signature and comment signature verified");`.sig == base64(.minisig)`。
- ✅ **B-3** latest.json 格式:`darwin-aarch64` + `-app` 别名,url=OSS tarball,signature=Tauri 格式,version 2026.12.1。
- ✅ **B-4** 版本号防呆:`1.17.4` 被拦,`2026.12.1` 放行。
- ✅ **B-5 本地**:`tar -xzf` 解压干净(exit 0),产出合法 `DeskFox Dev.app`(Info.plist + 嵌套 soffice + 主可执行齐)。tarball 311MB。
- ⏳ **B-5 dev 端点**(真部署 + 回读):需 user 点头(311MB OSS 上传 + 部署线上老 darwin 端点);验后回滚。

## 回退
- 脚本改动 `git revert` 可逆;桥是新文件,删之即回退;win 路径行为不变(Part A)。

## 回退
- 脚本改动 `git revert` 可逆;win 路径行为不变(只 mac 分支新增)。
