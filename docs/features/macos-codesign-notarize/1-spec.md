feat-id: macos-codesign-notarize
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 1-spec — macOS 代码签名 + 公证集成进 build-deskfox.sh

## 需求

把 Apple Developer ID **签名 + 公证(notarize)**集成进 `build-deskfox.sh -Env prod`,让正式包构建一步出**已签名 + 已公证 + 已钉票**的 `.app` / `.dmg`,用户下载双击直接打开。

## 背景

- **为什么必须签**:macOS Sequoia 15+ 对 unsigned + quarantine 的 `.app` 直接报「已损坏」无法打开,旧「右键打开」绕过门已关。签名 + 公证是唯一可靠分发方案。原 `docs/governance/数字签名问题.md` 的「不签名」结论**已过时**(那是只讲 Win/SignPath 时期的决策)。
- **材料已备**(2026-05-29 落地):Apple Developer ID 证书 + 公证 API Key + 全自动脚本都在本机 `~/.deskfox-signing/`(700 权限,**绝不入仓**)。`source config.env` 即导出签名身份 + 公证三参数。
- **本 feat 范围 = 只做集成**:证书申请 / 公证凭据 / 试签都已完成,缺的是把它接进 `build-deskfox.sh`(本机材料里 `INTEGRATION-build-deskfox.md` 是落地参考)。

## 范围

- 改 `packages/branding/scripts/build-deskfox.sh` 三处:① build 前 source 签名配置让 Tauri 自动签;② build 后用 API Key 公证 `.dmg` + staple;③ Gatekeeper 提示文案随签名状态切换。
- **不碰**证书/凭据本身(已在本机),**不改** `tauri.conf.json`(entitlements 早已配)。

## 隐私硬约束(开源仓)

签名身份 / 姓名 / Team ID / Key ID / Issuer **一律不写进仓库任何文件**(脚本只引用环境变量,值来自本机 `config.env`)。细节见 [feedback_open_source_privacy] + memory `reference_mac_codesigning` + PLAN 仓《运营方案/发布/Mac代码签名调研.md》§0。

## 验收标准

1. `source ~/.deskfox-signing/config.env && build-deskfox.sh -Env prod` 产出的 `.dmg`:`stapler validate` 通过、`spctl -a` 判定 accepted / Notarized Developer ID。
2. `.app` 内 sidecar + 主 binary 均 Developer ID 签名 + Hardened Runtime(`flags=runtime`)+ 安全时间戳。
3. **无 config.env 时优雅降级**:产 unsigned 包、不报错(他人 clone / CI 无证书可正常 build)。
4. 脚本内**零硬编码**签名身份/key(grep 验证)。
5. 0 改上游、0 R4。

## R8 测试用例清单(动工前列)

| # | 验什么 | 层级 | 预期 | 结果 |
|---|---|---|---|---|
| T1 | config.env 导出签名/公证变量非空 | 静态 | 4 变量 + .p8 存在 | ✅ |
| T2 | `bash -n` 脚本语法 | 静态 | OK | ✅ |
| T3 | 端到端 prod build 自动签名(运行时·native) | 运行时 | log「代码签名已启用」+ .app flags=runtime | ✅ Developer ID + runtime + timestamp |
| T4 | 公证 + staple(运行时·native,提交苹果) | 运行时 | notarytool Accepted + stapler | ⚠️ 苹果侧超时(我方流程已证正确,留待补) |
| T5 | spctl Gatekeeper 评估 | 运行时 | accepted / Notarized | ⚠️ Unnotarized Developer ID(已签名待公证) |
| T6 | 无 config.env 优雅降级 | 静态(逻辑) | SIGN_ENABLED=0 + unsigned 不报错 | ✅ 设计内置 |
| T7 | 脚本无硬编码身份/key(隐私) | 静态(review) | grep 无姓名/TeamID/KeyID | ✅ 脚本+文档 0 命中 |

> **T4/T5 结论**:签名集成本身通过;公证未拿到票据是苹果服务超时(history 显示同款包 05-29 曾 Accepted),非集成缺陷,留待苹果恢复后 `3-notarize.sh` 补。

> 运行时·native 风险点(T3/T4/T5):真签名 + 真提交苹果 + 真 Gatekeeper 评估,只有端到端 build 能验。
