feat-id: macos-codesign-notarize
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划 + 决策轨迹

## 三处改动(build-deskfox.sh,落地参考 = 本机 INTEGRATION-build-deskfox.md)

- **改动 1 / §1.8(tauri build 前)**:prod 且存在 `~/.deskfox-signing/config.env` 时 `source` 它,导出 `APPLE_SIGNING_IDENTITY` → Tauri 2.x bundler 自动签 sidecar + .app(hardened runtime + entitlements 早就绪);置 `SIGN_ENABLED=1`。否则打印「未启用」继续。
- **改动 2 / §3.6(build 后、提示前)**:`SIGN_ENABLED=1` + Darwin + 出了 .dmg 时,`notarytool submit --wait` 提交苹果 → `stapler staple`。
- **改动 3 / §4 提示**:`SIGN_ENABLED` 切换 Gatekeeper 文案(签名→「双击直接打开」/ 未签名→「右键打开 / xattr -cr」)。

## 关键决策

- **公证用直接 API Key,不用 `--keychain-profile`**:非交互 shell(build 子进程 / 后台任务)读钥匙串报 `User interaction is not allowed`(2026-05-29 实测中途失效)。`config.env` 导出 `DESKFOX_NOTARY_KEY`(.p8 路径)/ `_KEY_ID` / `_ISSUER` 三参数,`notarytool --key/--key-id/--issuer` 直读,零钥匙串依赖、零密码。
- **Tauri 自动签 vs 手动 codesign**:选 Tauri 自动(只需 `APPLE_SIGNING_IDENTITY` 环境变量),不写手动 codesign 步骤——少维护、跟上游 bundler 对齐。手动签作为应急 fallback 记在 memory。
- **优雅降级**:签名配置缺失(他人 clone / CI)不报错、产 unsigned 包。保证开源仓任何人能 build。
- **不改 tauri.conf.json**:entitlements(allow-jit / allow-unsigned-executable-memory / disable-library-validation 等,bun sidecar 在 hardened runtime 下所需)`tauri.conf.json:51-52` 早配好,Tauri 深合并 config 自动带上。R3/R4 零消耗。
- **隐私**:脚本只引用环境变量,签名身份/Team ID/Key ID/Issuer 的**值**全部来自本机 `config.env`,不进仓库。

## 风险 / 坑

- **苹果公证服务偶发故障**:提交后卡 `In Progress` 数小时(2026-05-29/30 实遇 >19h)= 苹果侧问题,非我方。`--wait --timeout 30m` 超时则降级为「已签名未公证」包,不阻断 build。
- **证书 1 年有效期**:2027-05 前重跑本机 `2-import-cert.sh` 续期。
- **联网前提**:打时间戳 + 上传公证需联网(代理环境 timestamp.apple.com 走 HTTPS_PROXY)。
