feat-id: electron-macos-sign-notarize
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog:实际改动

## 实现(2026-06-15,验证进行中)

### 改动文件
| 文件 | 改动 | 黑名单 |
|---|---|---|
| `packages/desktop/electron-builder.deskfox.config.ts` | mac 段加签名/公证(env 驱动)+ `dmg.sign` | 否(.deskfox.config EXCEPTION)|
| `packages/branding/scripts/build-deskfox-electron.sh` | `--sign` / `--notarize` flag + 签名 env 注入 + 代理分支 | 否(packages/branding)|
| `docs/features/electron-macos-sign-notarize/{1-spec,2-plan,3-changelog}.md` | 新增三文档 | 否 |

### config 改动要点
- mac:`hardenedRuntime:true` / `gatekeeperAssess:false` / `entitlements`+`entitlementsInherit:"resources/entitlements.plist"`(复用已存在的 entitlements)/ `identity` 从 `APPLE_SIGNING_IDENTITY` env **剥 "Developer ID Application:" 前缀**后注入(electron-builder 要求)/ `notarize: DESKFOX_NOTARIZE==="1"`。
- `dmg.sign: Boolean(APPLE_SIGNING_IDENTITY)`。
- 全 env 驱动:不 source config.env → `identity:null` 未签名(阶段0 行为不变)。

### build 脚本改动要点
- `--sign`:source `~/.deskfox-signing/config.env` → 注入 `APPLE_SIGNING_IDENTITY`;深签含嵌套 LibreOffice/soffice。
- `--notarize`(隐含 --sign):映射 `DESKFOX_NOTARY_KEY/_ID/_ISSUER` → `APPLE_API_KEY/_ID/_ISSUER`,置 `DESKFOX_NOTARIZE=1`;代理保留(Apple notary 可达)+ npmmirror 入 NO_PROXY。
- 不传 flag → 未签名快速本地包(行为不变)。
- 密钥全在仓库外 `~/.deskfox-signing/`,**不入开源仓**。

### 修复的真实坑
1. **electron-builder 拒绝带前缀 identity**:`config.env` 的全名(Tauri 格式)→ electron-builder 要不带前缀名。config 剥前缀解决。
2. **LO 深签慢非卡死**:3241 个文件 × 带时间戳 codesign 0.52s ≈ 28min,合法耗时(单文件校准实证)。详 2-plan 坑2。

## 验证(R8 TC)
- ⏳ 完整签名构建跑出后填:TC-1 codesign 身份 / TC-2 deep verify / TC-3 entitlements / TC-4 soffice 不再 SIGKILL / TC-6 运行时无 regression / TC-7 未签名路径不变。
- ⏳ TC-5 公证 + staple(--notarize)。

## 回退
- config `identity` 恒为 `null`(不 source config.env)即回未签名;`git revert` 单 commit 可逆(P4)。
- 不动上游 `electron-builder.config.ts`。
