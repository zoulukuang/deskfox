feat-id: electron-macos-updater-bridge
status: in-progress
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
- ⏳ **A-2**(dev 真部署 + 回读):需 user 点头(660MB OSS 上传 + 部署线上 dev channel);验后按 2026-06-06 先例回滚 dev manifest 占位避免污染 dev 用户。
- ⏳ **A-3**(Electron→Electron 升级):发版后真验。

## Part B:Tauri→Electron mac 桥(下个 commit)
待 Part A dev 验证绿后开工。详 1-spec B 段。

## 回退
- 脚本改动 `git revert` 可逆;win 路径行为不变(只 mac 分支新增)。
