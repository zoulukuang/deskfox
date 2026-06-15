feat-id: electron-macos-sign-notarize
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 阶段2:macOS Electron 包 Developer ID 签名 + 公证

## 背景

换基座(Tauri→Electron)后,`electron-builder.deskfox.config.ts` 的 mac 段是 `identity: null`(阶段1 只出未签名包)。未签名导致两个真问题:
1. **嵌套 soffice 被 macOS SIGKILL** → Word/office 导出在包里不可用(dev 实测已验)。
2. **Gatekeeper 拦未签名/未公证下载** + **electron-updater(Squirrel.Mac)装更新时校验签名** → 不签名则阶段3 自动升级 + 正式分发都做不了。

阶段2 = 给 .app/.dmg 接 Developer ID 签名 + Apple 公证 + staple,打通分发与升级的前置闸。

## 现状盘点(已核实)

- **签名身份就绪**:钥匙串有 `Developer ID Application: shimin yue (GZ4LT9W9H9)`;`~/.deskfox-signing/config.env` 提供 `APPLE_SIGNING_IDENTITY` / `DESKFOX_TEAM_ID` / `DESKFOX_NOTARY_KEY`(.p8 路径)/ `DESKFOX_NOTARY_KEY_ID` / `DESKFOX_NOTARY_ISSUER`。**密钥全在仓库外,绝不入仓。**
- **上游 `electron-builder.config.ts` 已有完整范式**(可直接镜像):`hardenedRuntime:true` / `gatekeeperAssess:false` / `entitlements`+`entitlementsInherit:"resources/entitlements.plist"` / `notarize:true` / `dmg.sign:true`。
- **entitlements 已存在**:`packages/desktop/resources/entitlements.plist`(含 allow-jit / allow-unsigned-executable-memory / disable-library-validation / allow-dyld-env / audio-input —— Electron + 嵌套 LO 所需)。
- 工具链:electron-builder 26.15.2 + @electron/notarize 2.5.0(`notarize:true` 走 API key,读 `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`)。

## 方案(R1 三级跳:改上游内部 0,只改 fork-only config + wrapper)

### 1. `electron-builder.deskfox.config.ts` mac 段(fork-only 文件,非黑名单)
镜像上游范式,identity/notarize 做成 **env 驱动**(不硬编码真实姓名进开源仓):
```ts
mac: {
  category, icon, target: ["dmg","zip"],
  hardenedRuntime: true,
  gatekeeperAssess: false,
  entitlements: "resources/entitlements.plist",
  entitlementsInherit: "resources/entitlements.plist",
  identity: process.env.APPLE_SIGNING_IDENTITY ?? null,   // 未 source config.env → null(dev 快速未签名路径不变)
  notarize: process.env.DESKFOX_NOTARIZE === "1",         // 显式开关,默认 off(公证慢 5-15min)
},
dmg: { sign: true },
```
- **签名触发**:`APPLE_SIGNING_IDENTITY` 在 env 里就签,否则 null。与 Tauri 时代「设了变量就自动签」语义一致。
- **公证触发**:`DESKFOX_NOTARIZE=1` 才公证,默认不公证(dev 本地签名验 soffice 够用,不必等公证)。

### 2. `build-deskfox-electron.sh` 加 `--sign` / `--notarize` flag
- `--sign`:`source ~/.deskfox-signing/config.env`(注入 `APPLE_SIGNING_IDENTITY`),并把 notary 三件套映射成 electron-builder 认的名:`APPLE_API_KEY=$DESKFOX_NOTARY_KEY` / `APPLE_API_KEY_ID=$DESKFOX_NOTARY_KEY_ID` / `APPLE_API_ISSUER=$DESKFOX_NOTARY_ISSUER`。
- `--notarize`:额外置 `DESKFOX_NOTARIZE=1`(隐含需 `--sign`)。
- 不传则现状不变(未签名快速本地包)。
- **代理处理**:打包阶段须绕 Clash 直连 npmmirror(现状 `env -u …_PROXY`);但**公证上传要够到 Apple notary**。验证时确认 Apple 公证在国内直连可达(Tauri `3-notarize.sh` 当年未动代理即成功);若公证步骤撞网络,再单独给 notarize 子步骤恢复代理(风险点,见 TC-5)。

### 渠道策略
- **dev 本地自测**:`--sign --no-bundle`(签名验 soffice,不公证,快)。
- **dev/prod 正式分发(ship)**:`--sign --notarize`(完整签名+公证+staple)。

## R8 测试用例清单(动工前锁定)

| # | 验什么 | 层级 | 命令/方法 | 预期 |
|---|---|---|---|---|
| TC-1 | .app 被 Developer ID 签名 | 构建·native | `codesign -dvv "DeskFox Dev.app"` | Authority = `Developer ID Application: shimin yue (GZ4LT9W9H9)` |
| TC-2 | 深度签名有效 | 构建·native | `codesign --verify --deep --strict --verbose=2 <app>` | `valid on disk` + `satisfies its Designated Requirement` |
| TC-3 | entitlements 注入 | 构建·native | `codesign -d --entitlements - <app>` | 含 allow-jit / disable-library-validation |
| TC-4 | **嵌套 soffice 签名 + 不再 SIGKILL** | 构建·native·**核心** | `codesign --verify <app>/Contents/Resources/libreoffice/.../soffice` + 跑一次 office 转换 | soffice 签名有效;转换出文件(不被 SIGKILL) |
| TC-5 | 公证 + staple(prod) | 构建·native·**风险** | `--sign --notarize` 后 `xcrun stapler validate <dmg>` + `spctl -a -t open -vv <dmg>` | `accepted` / `source=Notarized Developer ID`;**关注公证上传网络可达性** |
| TC-6 | 签名包运行时无 regression | 运行时 | 启动签名 .app,curl `/global/health` | 后端起、health 401、飞书 WSS 连上、无 crash(对照阶段0 基线) |
| TC-7 | 未签名快速路径不变 | 构建 | `-Env dev --no-bundle`(不带 --sign) | 仍出未签名包、不 source config.env、速度不变 |

> **native 风险点显式记**(对照「CDP 自测 ≠ 真桌面 QA」):TC-4 嵌套 LO deep-sign 体量大可能慢/偶发失败;TC-5 公证上传是真连 Apple 的外网操作,国内网络 + 代理绕过策略可能冲突,须真跑确认,不能 CDP 糊弄。

## 影响范围 / 回退
- 改文件:`electron-builder.deskfox.config.ts`(mac/dmg 段)+ `build-deskfox-electron.sh`(--sign/--notarize)+ 可能微调 `resources/entitlements.plist`。全 fork-only,非黑名单。
- 回退:config 的 identity 恢复 `null` 即回未签名;`git revert` 单 commit 可逆(P4)。
- 不动上游 `electron-builder.config.ts`(Win/通用)。

## 验收门(R9)
按 TC-1~7 全绿(尤其 TC-4 soffice 真转换 + TC-5 公证真 staple),旧测试不回归,才提 merge。
