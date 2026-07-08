feat-id: updater-deploy-stale-ip
status: done
related: ./3-changelog.md

# updater 部署脚本 SSH host 硬编码旧 IP 修复(2026-07-08,Tiny)

commit:`5bb212798`(2026-07-08,Win 端 ship 2026.8.4 时回填)

## 背景

macOS prod 2026.8.4 发版后,user 报「新版已发布但本地检测不到更新 / 检查不到最新版本」。

## 根因

两条 macOS 更新源(① Electron 自更新 `electron/prod/latest-mac.yml` ② Tauri→Electron 迁移桥 `v1/latest/desktop/darwin/latest.json`)线上仍停在 Win 同事 07-03 发的 **2026.8.3**,产物(CDN 上 zip/dmg/tar.gz)却都已是 2026.8.4 且 HTTP 200。

- **直接原因**:updater 部署脚本(`deploy-electron-updater.sh` / `bridge-electron-updater.sh`)的 SSH host 硬编码旧 IP `ubuntu@52.197.46.120`。更新服务器已换 IP —— `updates.deskfox.ai` 现 DNS 指向 **`57.180.8.119`**,旧 IP 的 web(443)还能回旧内容(极具迷惑性),但 **SSH(22)已连不上**。上次 ship 时 OSS 产物上传成功、`scp` 到旧 IP **静默超时失败** → manifest 从未部署上去。
- **放大原因**:`ship.md` 步骤 7.5 设计为「任一失败非阻断,事后补跑」→ GitHub/Gitee/CDN 照常发完,升级源失败被跳过、也没人事后补跑,直到 user 发现。
- **对照**:官网仓 `deskfox-site/publish.sh` 已被更新到新 IP `57.180.8.119`(所以官网 deskfox.ai 今天成功发到 2026.8.4),但**漏改了 opencode-fork 的两个 updater 脚本** —— 这正是「官网能发、更新源不能发」的完整解释。

## 修复(代码)

3 个部署脚本的 `SERVER` 改为**域名 + env override**:`SERVER="${DESKFOX_UPDATE_SSH:-ubuntu@updates.deskfox.ai}"`

- `packages/branding/scripts/deploy-electron-updater.sh:71`
- `packages/branding/scripts/bridge-electron-updater.sh:56`
- `packages/branding/scripts/deploy-updater-manifest.sh:51`(DEPRECATED,顺手统一防遗漏)

用**域名**做 SSH host 而非新 IP:`updates.deskfox.ai` 以后再换机器/换弹性 IP,DNS 自动跟随,脚本无需再改 —— 根治「换 IP 脚本坏」。紧急可 `DESKFOX_UPDATE_SSH=...` 覆盖。

## 运维补救(本次已手动完成,线上恢复)

- Electron 链路:修正 `latest-mac.yml` 的 dmg size/sha512(公证 staple 后变化未回填,`324454288/sH6w…`→真实 `324459422/K4OV…`)→ `deploy-electron-updater.sh --no-gitee` 传 OSS + 手动 SCP 部署到 `57.180.8.119` + 回读校验。
- Tauri 桥:复用上次 ship 残留的 `/tmp/deskfox-bridge-mac-prod/latest.json`(签名对应 CDN 上同一 tar.gz)手动 SCP 部署 + 回读校验。桥 tar.gz 本地↔CDN sha256 逐字节一致(`95348d88…7498`)→ minisign 签名对线上文件有效。
- 结果:两条源线上 = **2026.8.4**;CDN zip/blockmap/dmg/tar.gz 全 200(本次补传了之前缺的 `.blockmap`,增量更新可用)。

## 验证

- `bash -n` 三脚本语法 OK。
- `--dry-run` 打印 `server=ubuntu@updates.deskfox.ai`;`DESKFOX_UPDATE_SSH=...` 覆盖生效。
- SSH 到 `updates.deskfox.ai` 连通(hostname `ip-172-26-2-24`,同一台机)。
- 线上两条源 curl 回读 = 2026.8.4。

## 影响 / 回退

纯 fork-only 运维脚本 SERVER 行 + 注释,~15 行含注释;0 改上游 / 0 R4 / 0 黑名单。回退 `git revert` 即可。

## 遗留(建议后续)

1. `deskfox-site/publish.sh` 当前用硬编码新 IP `57.180.8.119`(能工作),但同样是写死 IP,建议后续也改域名 `updates.deskfox.ai`。→ **已解决**:user 2026-07-08 在 site 项目单独处理完(现用 `ubuntu@deskfox.ai`)。
2. `ship.md` 步骤 7.5 的「非阻断/事后补跑」易让升级源失败被忽略,可考虑发版末尾加一步「curl 两条源 version == 本次版本」的硬校验收尾。→ **已落地**:ship.md 7.5(C) 硬校验(2026-07-08),2026.8.5 发版首跑 PASS。

## Follow-up(2026-07-08,2026.8.5 发版复盘固化)[feat: updater-deploy-stale-ip]

2026.8.5 发版全程复盘后的两笔脚本加固(同分支 `fix/updater-yml-recompute-and-bridge-env`):

1. **`deploy-electron-updater.sh` 新增 2.5 段:部署前按磁盘实算回写 yml 各资产 sha512/size**。根因:electron-builder 生成 `latest-mac.yml` 在「.dmg 公证 staple」**之前**,staple 改写 .dmg 字节 → yml 里 dmg 的 sha512/size 必然过期。2026.8.4 靠事后补救、2026.8.5 靠人记得手改——依赖"记得"=没固化。现在脚本部署前一律以磁盘文件为准重算(python3 sha512+size,按 url/path basename 匹配替换,含顶层 path/sha512),整类问题消灭;zip 不受 staple 影响,重算无害幂等。**验证**:dry-run 用 2026.8.5 真实产物,重算值与发版实测值逐字节一致(dmg `QfY3W5…FA==`/324464942,zip `m5vSBT…KQ==`/336417843)。
2. **`bridge-electron-updater.sh` 提前 source config.env(set -a)**。2026.8.5 发版前 code-review 发现:原本到步骤 3 minisign 才 source,晚于 SERVER 取值 → `DESKFOX_UPDATE_SSH` 写在 config.env 里对 bridge 静默无效,与 deploy 脚本行为分叉(运维紧急切换服务器时两条升级源会指向不同机器)。现在开头就 `set -a; source`(子进程 upload-asset-to-oss.sh 同受益),原步骤 3 的 source 保留(幂等无害)。**验证**:source(L60)< SERVER(L64)结构保证 + bash -n。

配套(非本仓 commit):ship.md 五处修订(步骤 0 版本已发过检查 / 步骤 1 定型 4 finder ≤5 预算 / 步骤 3 公证日志假死判读 / 步骤 3.5 staple 后重算说明 / 步骤 8·9 `--rebase=merges`),备份已刷 `~/.deskfox-signing/ship.md.bak`。
