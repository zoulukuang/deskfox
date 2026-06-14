---
feat-id: dev-independent-version-line
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# dev-independent-version-line — plan

## 改动清单(7 文件)

| 文件 | 改动 | 平台 |
|---|---|---|
| `branding/installer-versions.json` | 加 `dev-windows/dev-macos/dev-linux` 三条独立号线(seed = 当前 prod)| 共用 |
| `bump-installer-version.sh` | `$ENV != prod` 时 `JSON_KEY="$ENV-$JSON_KEY"` + 台账条目标 channel | Mac |
| `bump-installer-version.ps1` | 同上(`$jsonKey = "$Env-$jsonKey"` + `$ledgerTag`)| Win |
| `build-deskfox.sh` | env 感知读 `dev-macos`,兜底回落裸 `macos` | Mac |
| `build-deskfox.ps1` | env 感知读 `dev-windows`,兜底回落裸 `windows` | Win |
| `pack-installer.ps1` | `-SkipBump` 路径 env 感知读 `dev-windows` | Win |
| `docs/governance/版本号与发布渠道规范.md` | §3.2bis 新增独立号线 + §3.5 加 prod/dev 不共号注 + §4.2 去 `-dev` 后缀残留 | 文档 |

**无需改**:`pack-installer.sh`(已透传 `--env` 给 bump,用返回版本号;`strip -(dev|beta)$` 对纯数字号无操作;`--no-bump` 不读 JSON)。

## 决策轨迹

- **嵌套 vs 扁平复合 key**:初提嵌套 `prod.macos`/`dev.macos`,读 `bump-installer-version.sh` 后发现它用 `grep/sed` 改 JSON,嵌套会让 `"macos"` 在两行都命中 + 打破所有现有 prod 读取 → **改用扁平复合 key**(`dev-macos`),prod 路径零改动、sed/grep 不互撞。这是安全性驱动的结构选择。
- **seed = 当前 prod**(非"立刻领先"):dev 尚未预览新波次,seed 相等最诚实;首次 dev 预览新功能 `--bump minor` 时自然领先。

## 验证(Mac 端实测)

- `bump --env dev --bump minor --dry-run` → 读 `dev-macos`=2026.6.0 → **2026.7.0**(领先)✓
- `bump --env prod --dry-run` → 读裸 `macos`=2026.6.0 → 2026.6.1 ✓
- `build-deskfox` 版本读取片段:prod→2026.6.0 / dev→2026.6.0 ✓
- **sed 不误伤(双向)**:prod 改 `macos` 不动 `dev-macos`;dev 改 `dev-macos` 不动 `macos` ✓
- `grep` 读取双向各自精确命中一行 ✓
- `bash -n` 四脚本全过 + JSON 合法 ✓

## 待办 / 边界

- ~~**Win 端 .ps1 未实测**(本机无 pwsh):需 Win 同事跑 `bump/pack -Env dev` 验证。~~ → ✅ **Win 同事 2026-06-10 实测三步通过**(dev 读 dev-windows 领先 / prod 读裸 key 不受影响 / 真写只动 dev-windows 不误伤 prod),PS5.1 中文编码无报错。双端齐活。
- dev updater 产物仍未启用(`build-deskfox` 对 dev 跳过 updater),与本改动无关。
- §五 操作 SOP 里 `ship-dev-...-dev` 等旧 4 段+后缀示例未清(文档头已标"随 NSIS 切换更新中"),留给那条 feat。
