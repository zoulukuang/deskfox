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
3. **osx-sign 逐文件签搞不定 LO 多可执行结构(致签名失败,follow-up commit 修)**:electron-builder 的 osx-sign 逐文件签,签 LO 主可执行 `soffice` 时报 `code object is not signed at all / In subcomponent: uno`(兄弟可执行 `uno` 未先签)→ 整链失败、回落 adhoc。**修法**:build 脚本 `--sign` 时先 `codesign --deep` 预签【源】LibreOffice.app(--deep 正确由内到外签多可执行)+ config `mac.signIgnore: ["Resources/libreoffice"]` 让 electron-builder 跳过 LO,extraResources 拷贝保留签名、外层 seal 覆盖。**副作用红利**:LO 不再被逐文件重签,完整签名 28min→~6min。`codesign --deep` 实证可签好 LO(soffice/uno 都上 Developer ID,verify --deep --strict 通过)。

## 验证(R8 TC,2026-06-15 完整签名构建 v2 实测)
- ✅ **TC-1** codesign 身份:外层 .app = `Developer ID Application: shimin yue (GZ4LT9W9H9)` / `Identifier=ai.deskfox.app.dev` / `TeamIdentifier=GZ4LT9W9H9`。
- ✅ **TC-2** deep verify:`codesign --verify --deep --strict` → `valid on disk` + `satisfies its Designated Requirement`。
- ✅ **TC-3** entitlements:allow-jit / allow-unsigned-executable-memory / disable-library-validation 注入。
- ✅ **TC-4(核心)** soffice 签名 + 不再 SIGKILL:`soffice --version` 实跑 → `LibreOffice 25.8.7.3` 退出 0(非 137)→ office 导出恢复。
- ✅ **TC-6** 运行时无 regression:签名包启动,后端 `127.0.0.1:55736` health 401,飞书 WSS=3/3,主进程+后端存活,无 crash。
- ◻️ **TC-7** 未签名快速路径:设计上不受影响(signIgnore 在不签名时惰性,no-sign 分支未改);未单独重跑。
- ⏳ **TC-5** 公证 + staple(`--notarize`):延后(更重 —— LO 带时间戳预签 ~28min + dmg + Apple notary 上传 5-15min)。

## Follow-up 待办(下一步)
- **TC-5 公证验证**:跑 `--sign --notarize`(出 dmg+zip),`stapler validate` + `spctl -a -t open` 确认 Notarized Developer ID。
- **LO 预签缓存(提速 follow-up)**:当前每次 `--sign` 都重签源 LO(~4min/dev);可加"已用本 identity 签过且未变更则跳过"判断,把重复 `--sign` 降到 ~1min。

## 回退
- config `identity` 恒为 `null`(不 source config.env)即回未签名;`git revert` 可逆(P4)。
- 不动上游 `electron-builder.config.ts`。
