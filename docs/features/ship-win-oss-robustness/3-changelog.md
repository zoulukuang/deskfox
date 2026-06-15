feat-id: ship-win-oss-robustness
status: done
related: ./3-changelog.md

# 3-changelog — Electron Windows 首发 ship 健壮性 + 跨引擎升级桥踩坑

> 规模:Small(repo 脚本 +41/-19)+ 一次 prod 发版(2026.8.0)+ 一个生产 bug 修复 + ship SOP 加固。
> 单 changelog(Tiny/Small 例外,省 1-spec/2-plan)。grep `[feat: ship-win-oss-robustness]`。

## 背景

`/ship` 改造成 Electron 基座后的**首次真发版**:DeskFox **2026.8.0(Windows prod)**,换基座 Tauri → Electron 后首个 Windows 稳定版(SkipBump 发当前号,与 macOS 8.0 同波次;`ship-prod-2026.7.2` 是最后一个 Tauri Win prod)。首发过程暴露了 3 个流程坑 + 1 个生产 bug,本文档记录修复与经验,确保后续 ship 健壮。

## 实际改动

### A. 仓内脚本(commit `91be12772`,合入 `ab28eedae`)
- **`deploy-electron-updater.sh`**:启动 `set -a; source ~/.deskfox-signing/config.env`(自加载密钥)。原靠调用方手动 source,且 config.env 是 `KEY=val` plain 赋值、不 export 到子进程 → `upload-asset-to-oss.sh`(子进程)报"缺 OSS 凭据"。`set -a` 让赋值自动 export,子进程继承。
- **`upload-asset-to-oss.sh`**:ossutil 改**跨平台**(`uname` 检测 → mac=`ossutilmac64` / win=`ossutil64.exe` / linux=`ossutil64`;`OSSUTIL_BIN` 显式覆盖 > PATH > `OSSUTIL_DIR` > 平台对应下载;`OSSUTIL_DIR` 平台化:mac=ExtSSD / 其它=`~/.ossutil`)。原硬编码 mac 路径 `/Volumes/ExtSSD/.ossutil/ossutilmac64` → Windows 上 `Exec format error`。

### B. 本地密钥(仓外 `~/.deskfox-signing/config.env`)
- 追加 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`(值在 `D:\project\deskfox-site\deploy\alibaba-cdn.md`)。原 config.env 只有 Tauri 签名私钥,无 OSS。

### C. ship.md(user 级 `~/.claude/commands/ship.md`)
- 步骤 7 简化:删手动 `source`/`export`/PATH(deploy 已自加载 + ossutil 自解析)。
- **新增步骤 7c:Tauri→Electron 迁移桥(prod 必跑)** —— 见下 bug-repro。
- 修备注矛盾:`finalize-latest-json.ts` + `bridge-electron-updater.ps1` 不是"作废",是步骤 7c 桥的**活依赖,勿弃用/勿删**。
- 步骤 9 报告加"迁移桥已部署"项。

### D. 操作型(无 commit,部署到服务器)
- 跑 `bridge-electron-updater.ps1` 生成 Tauri 格式 `latest.json`(version 2026.8.0,指向 CDN 的 Electron NSIS,Tauri 私钥签名)→ scp 部署到 `updates.deskfox.ai/v1/latest/desktop/windows/latest.json`。

## bug-repro:正式版「检查更新」永远显示"已是最新",收不到 2026.8.0

- **现象**:装 Tauri 正式版 `2026.7.2` 的机器点「立即检查」→ "已是最新版本",但线上已发 2026.8.0。
- **根因**:存量正式版是**最后一个 Tauri 版**,其更新器查 **Tauri 端点** `…/v1/latest/desktop/windows/latest.json`(Tauri 格式 latest.json + minisign 签名)。而 2026.8.0 ship 时**只部署了 electron-updater 端点** `…/electron/prod/latest.yml`。两条更新链**互不相见** → Tauri 端点仍停在 7.2(=客户端自身版本)→ 判"无更新"。
- **修复**:跨引擎升级桥(步骤 7c)—— 用 Tauri minisign 私钥给 Electron NSIS 签名 + 生成 Tauri 格式 manifest 指向 Electron 包,部署到 Tauri 端点。老 Tauri 更新器查到 version 2026.8.0(> 7.2)→ 下载 + 验签(内嵌 Tauri 公钥,同源)+ 运行 → Electron NSIS 静默卸旧 Tauri、装上 8.0。
- **验证**:`curl …/v1/latest/desktop/windows/latest.json` → version=2026.8.0、url 指向 CDN Electron 包、signature 非空。

## 经验 / 教训(后续 ship 必看)

1. **🔴 双更新链,prod 每次 ship 必喂两条**:换基座后存在两套自动升级源 —— ① **electron-updater**(`/electron/<ch>/latest.yml`,新 Electron 客户端)② **Tauri 端点**(`/v1/latest/desktop/<target>/latest.json`,存量 Tauri 客户端)。**只喂 ① = 老用户永远收不到升级**。prod 必须同时部署迁移桥(②),直到 Tauri 用户基本迁完才能停。Mac 8.0 台账本就列了两条源,Windows 首发漏了 ② → 本次 bug。
2. **OSS 凭据位置**:不在 config.env(那只有签名私钥),权威值在 `deskfox-site/deploy/alibaba-cdn.md`;已收口进 config.env。**`source` plain 赋值不会 export 到子进程**,需 `set -a`(deploy 已内置)。
3. **ossutil 跨平台**:mac/win/linux 二进制名不同,脚本不能硬编码单平台路径;Windows 用 `ossutil64.exe`(v1.7.16 有 exe;1.7.18 mac 有、win 可能无)。
4. **SkipBump 对齐波次**:换基座大版本时,Windows 可用 `-SkipBump` 直接发当前号(2026.8.0)与 Mac 同波次,而非 bump 到 8.1 跳过 8.0。各端独立号线但同波次共享版本号。
5. **prod 包已代码签名**:本次 electron-builder 全程 signtool 签名(含内嵌 LibreOffice 各 exe + 主程序 + uninstaller),降 SmartScreen 警告。(与历史"installer 不签名"口径不同,signtool 由当前环境签名配置触发;如需固化口径另议。)
6. **桥的版本号防呆**:`bridge-electron-updater.ps1 -Version` 必须 > 最高已发 Tauri 日历版(用本次 `<版本>` 即可),且首段 ≥2000(脚本拦截误填 Electron semver 1.17.x —— 那会被 Tauri 判降级不推送)。

## 影响范围 / 回退

- 仓内:纯 fork-only 脚本(`packages/branding/scripts/` 2 文件)+ 本文档。**0 改上游 / 0 R4 / 0 黑名单**。无产品运行时改动。
- 回退:`git revert ab28eedae`(脚本)即可;config.env / ship.md / 服务器 manifest 为运行态资产,不随 revert。
