feat-id: updater-deploy-stale-ip
status: done
related: ./3-changelog.md

# updater 部署脚本 SSH host 硬编码旧 IP 修复(2026-07-08,Tiny)

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

1. `deskfox-site/publish.sh` 当前用硬编码新 IP `57.180.8.119`(能工作),但同样是写死 IP,建议后续也改域名 `updates.deskfox.ai`。
2. `ship.md` 步骤 7.5 的「非阻断/事后补跑」易让升级源失败被忽略,可考虑发版末尾加一步「curl 两条源 version == 本次版本」的硬校验收尾。
