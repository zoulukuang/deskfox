feat-id: electron-macos-sign-notarize
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan:实施计划 + 决策轨迹

## 实施步骤

1. ✅ `electron-builder.deskfox.config.ts` mac 段:镜像上游签名范式(hardenedRuntime / gatekeeperAssess:false / entitlements + entitlementsInherit / notarize)+ identity/notarize env 驱动 + `dmg.sign`。
2. ✅ `build-deskfox-electron.sh`:加 `--sign` / `--notarize` flag,source `~/.deskfox-signing/config.env`,映射 notary 凭据 → `APPLE_API_KEY/_ID/_ISSUER`,代理分支处理。
3. ⏳ 完整签名验证构建(TC-1~6)。
4. ⏳ 公证验证(TC-5,--notarize)。

## 决策轨迹 / 踩坑

### 坑1:electron-builder 拒绝带前缀的 identity(已修)
- 现象:`⨯ Please remove prefix "Developer ID Application:" from the specified name`。
- 根因:`config.env` 的 `APPLE_SIGNING_IDENTITY` 是 **Tauri 要的全名**(`Developer ID Application: shimin yue (GZ4LT9W9H9)`);electron-builder 的 `mac.identity` 要的是**不带前缀的证书名**(自动选证书)。
- 修法:config 里喂给 electron-builder 时剥前缀 —— `(env ?? "").replace(/^Developer ID Application:\s*/i, "").trim() || null`。保留 `APPLE_SIGNING_IDENTITY` 原值不动(Tauri 仍可能用)。
- 验证:修后 electron-builder 正确解析 `identityName=Developer ID Application: shimin yue (GZ4LT9W9H9) identityHash=7EF2E15103…` 开始深签。

### 坑2:LO 深签慢 ≠ 卡死(误判后纠正)
- 现象:`--sign` 构建签名阶段跑 ~25min 仍未完,一度疑似卡死。
- 误判经过:先猜"timestamp.apple.com 直连超时",curl 实测**直连 0.7s / 经代理 0.6s 都快** → 假设推翻;再猜代理分支错 → 也不对。
- **真因(单文件 codesign 校准实测)**:codesign 带安全时间戳 **0.52s/文件**,不带 **0.08s/文件**。LibreOffice bundle 有 **3241 个文件**,逐个带时间戳深签 = 3241 × 0.52 ≈ **28 分钟**,合法耗时,非卡死。之前"1 文件/2min"是**自己反复 `find` 遍历外置盘 LO 树跟 codesign 抢 I/O** 的测量假象。
- 教训:① 诊断"慢"先单点校准耗时再下"卡死"结论 ② 别在签名进行时反复 `find` 大目录(外置盘 I/O 争用会真拖慢构建)。

### 决策:不为 dev 跳时间戳(YAGNI)
- 时间戳只有公证才必需;dev 本地 `--sign` 理论可 `--timestamp=none` 把 28min→4min。
- 但 electron-builder 的 macPackager **不透传** osx-sign 的 timestamp 开关(osx-sign 支持 `--timestamp=none` 但 electron-builder 无配置入口)。
- 为此跳时间戳要改上游内部 / afterPack 自定义签名,违背 fork「不深改上游」。**放弃**:dev 快速路径用**未签名 `--no-bundle`(~1min)**,`--sign`(~28min)仅验签/测 soffice 时用,频率低,28min 可接受。

### 代理处理(已澄清,无需改)
- 时间戳直连实测可达(0.7s),故 `--sign` 不公证时沿用全量绕代理(npmmirror 直连)没问题。
- `--notarize` 时保留代理 + npmmirror 入 NO_PROXY(公证上传 Apple 走代理,镜像走直连)。

## 待验证(R8 TC,完整签名构建后跑)
TC-1 codesign 身份 / TC-2 deep verify / TC-3 entitlements / TC-4 soffice 不再 SIGKILL(核心)/ TC-5 公证+staple / TC-6 运行时无 regression / TC-7 未签名快速路径不变。
