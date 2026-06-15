feat-id: electron-macos-updater-bridge
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan:实施计划 + 决策轨迹

## user 审签决策(2026-06-15)
- **TD-2 分期**:先 A(Electron mac updater 部署)后 B(Tauri→Electron 桥),分两 commit。A dev 验证绿了再上 B。
- **TD-1 签名工具**:`brew install minisign`(B 用)。
- **TD-3 验收深度**:dev channel 部署 + 模拟拉取验签为验收门;prod 真迁移留发版时。

## Part A:Electron mac updater 部署(本 commit)
扩 `deploy-electron-updater.sh` 加 `--platform mac|win`(缺省按 `uname` 自动):
- mac:YML=`latest-mac.yml`;资产=`DeskFox*-<ver>-mac-arm64.{zip,dmg}`(+ .blockmap);远端 `/var/www/updates/electron/<channel>/latest-mac.yml`;校验 `…/electron/<channel>/latest-mac.yml`。
- URL 改写从单资产 → **多资产循环**(latest-mac.yml 的 files[].url + path 各 basename → OSS 绝对 URL)。
- OSS 上传循环所有资产;Gitee 镜像挑 `.dmg`(用户面安装包)。
- win 路径**行为不变**(只在 PLATFORM=win 时走原逻辑)。

### 验证(A)
- A-1:`--platform mac --dry-run` → /tmp 生成的 latest-mac.yml 各 url 绝对、version 对(0 碰线上)。
- A-2:dev 真部署 + `curl …/electron/dev/latest-mac.yml` 回读 version(需 user 点头,碰线上服务器)。
- A-3:Electron→Electron 升级(装低版本 dev → 检测 → 下载 .zip → 装)——发版后真验。

## Part B:Tauri→Electron mac 桥(下个 commit)
新 `bridge-electron-updater.sh`:Electron .app → `COPYFILE_DISABLE=1 tar` `.app.tar.gz` → minisign 签 → finalize Tauri latest.json → 部署老端点。详 1-spec B 段 + 5 风险点。

## 决策轨迹 / 踩坑
(实施中追加)
