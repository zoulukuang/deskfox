---
feat-id: dev-independent-version-line
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# dev-independent-version-line — changelog

**关联 commit**: `<本笔 commit>`
**所在分支**: `chore/pack-preview-dev-script`(与 pack-preview-dev.sh 同分支)
**规模**: Medium(~7 文件 / 脚本+JSON+治理文档;prod 路径零改动)
**触发**: 2026-06-09 审查 `pack-preview-dev.sh` 预览版打包工作流时,发现 `installer-versions.json` prod/dev 共用同一版本号 → user 拍板 dev 版本号独立(Dev 领先模式)。

## 改了什么

| 文件 | 改动 |
|---|---|
| `packages/branding/installer-versions.json` | 加 `dev-windows/dev-macos/dev-linux` 三条独立号线(seed = 当前 prod:win 2026.7.0 / mac 2026.6.0 / linux 2026.6.0)|
| `packages/branding/scripts/bump-installer-version.sh` | `--env != prod` → `JSON_KEY="$ENV-$JSON_KEY"`;台账占位条目对 dev/beta 标 channel(`[macOS dev]`)|
| `packages/branding/scripts/bump-installer-version.ps1` | 镜像:`$jsonKey = "$Env-$jsonKey"` + `$ledgerTag` |
| `packages/branding/scripts/build-deskfox.sh` | env 感知读 `dev-macos`,`?? v.macos` 兜底回落 |
| `packages/branding/scripts/build-deskfox.ps1` | 镜像:`$verKey = "$Env-windows"`,缺失回落裸 `windows` |
| `packages/branding/scripts/pack-installer.ps1` | `-SkipBump` 路径 env 感知读 `dev-windows` + 回落 |
| `docs/governance/版本号与发布渠道规范.md` | §3.2bis 新增"prod/dev 独立号线 — Dev 领先模式";§3.5 加"prod/dev 不共号"注 + 渠道表加号线行;§4.2 去 `-dev` 后缀残留改纯数字 |

**未改** `pack-installer.sh`:已透传 `--env` 给 bump、用其返回版本号,`strip -(dev|beta)$` 对纯数字无操作,`--no-bump` 不读 JSON。

## 设计要点

- **扁平复合 key**(`dev-macos`)而非嵌套:prod 读取(`.macos`)零改动;`bump` 的 `grep/sed` 与裸 key 不互撞(`"macos"` 不匹配 `"dev-macos"`)。详 1-spec / 2-plan。
- **纯数字无后缀**:Mac CFBundleShortVersionString + updater prerelease 排序双约束(规范 §3.5),渠道靠文件名/路径/identifier 区分。
- **Dev 领先**:dev 号线天然跑在 prod 前(新功能先预览),稳定后 prod 追上同波次。

## 回归测试

Mac 端实测(2-plan 详列):bump dev minor→2026.7.0 / bump prod→2026.6.1 / build 读取 prod·dev 各对 / **sed 双向不误伤** / grep 双向精确命中 / `bash -n` 4 脚本 + JSON 合法。
⚠️ **Win 端 .ps1 未实测**(本机无 pwsh),逻辑与 .sh 镜像,需 Win 同事验。

## 回退方法

`git revert <commit>` 一笔即回;或手删 `installer-versions.json` 的 `dev-*` 三行 + 脚本里的 env-prefix 块(prod 路径本就没动,回退无副作用)。
