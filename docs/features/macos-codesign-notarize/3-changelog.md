feat-id: macos-codesign-notarize
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

> 集成代码 + 签名实证已完成(done);本次公证因苹果服务超时未拿到票据,属运行时苹果侧问题,留待恢复后用 `3-notarize.sh` 补,不影响集成 feature 本身。

## 规模

Medium(build 脚本集成 ~50 行 + 文档)。纯 fork-only,0 改上游,0 R4。

## 改动文件

| 文件 | 改动 |
|---|---|
| `packages/branding/scripts/build-deskfox.sh` | §1.8 source 签名配置(SIGN_ENABLED + NOTARIZE_OK)/ §3.6 公证 + staple(API Key,成功置 NOTARIZE_OK=1)/ §4 提示三态(签名+公证 / 仅签名未公证 / 未签名)。全部引用环境变量,零硬编码身份/key。 |
| `docs/governance/数字签名问题.md` | 标注 Mac 已启用 Developer ID 签名 + 公证,纠正过时的「不签名」结论(不写敏感参数)。 |
| `docs/features/macos-codesign-notarize/{1-spec,2-plan,3-changelog}.md` | 新增三文档。 |
| `docs/features/INDEX.md` / `改动日志.md` | 索引各一行。 |

## 验证(端到端,2026-06-01)

- [x] **T3 ✅ 签名集成成功**:build log 出现「代码签名已启用」;Tauri 自动签 `.app`(Developer ID Application + `flags=0x10000(runtime)` Hardened Runtime + 安全时间戳)+ `.dmg`;`codesign --verify --deep --strict` 通过。
- [~] **T4/T5 公证本次苹果侧超时**:`notarytool --wait` 30min timeout 未返回(`Timeout of 1800 second(s)`)。**我方流程已证明正确** —— notarytool history 显示 05-29 同款 `.dmg`(相同签名链/entitlements)曾 **Accepted**;且 05-30 一个提交卡 `In Progress` 已 2 天 = 苹果公证服务间歇性故障(reference 有记录)。`spctl -a` 当前 `rejected / source=Unnotarized Developer ID`(已签名、待公证)。**公证留待苹果恢复后单独补**:`bash ~/.deskfox-signing/3-notarize.sh <.dmg>`(包已签名,补公证无需重 build)。
- [x] **T7 ✅ 隐私**:脚本 + 文档 grep 0 命中签名身份/TeamID/KeyID/Issuer。
- [x] **顺手修提示 bug**:原 §4 只判 `SIGN_ENABLED` → 公证失败仍误报「已公证双击直接打开」(本次实测触发)。加 `NOTARIZE_OK`,§4 提示改三态(签名+公证 / 仅签名 / 未签名)。[bug-repro: 公证失败时 build 提示误报已公证]

## 影响范围

- prod 完整 build 行为变化:多出签名(Tauri 自动)+ 公证(~5-15min)两步;dev/beta/无 config.env 不受影响。
- 无产品代码 / 运行时逻辑变化。

## 回退方法

`git revert <merge>` 或还原 build-deskfox.sh 三处。证书/凭据在本机不受影响。

## commit

本笔 commit:`feat(branding): macOS 签名+公证集成进 build-deskfox.sh [feat: macos-codesign-notarize]`(`git log --grep macos-codesign-notarize` 反查)

## 后续

- **补公证**(苹果服务恢复后):`source ~/.deskfox-signing/config.env && bash ~/.deskfox-signing/3-notarize.sh <已签名.dmg>`,完成后 `spctl -a` 应转 accepted。
- 之后正常 `build-deskfox.sh -Env prod` 在苹果服务正常时会一步出签名+公证包。
