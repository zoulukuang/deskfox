feat-id: macos-ship-命令
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 1-spec — macOS /ship 一键发版命令

## 需求

把 macOS 发版 SOP 串成一条 `/ship` 命令,**全自动 fire-and-forget**。区别于 Win `/ship` 的核心:**签名 + 公证内置,且「不公证不推送」是硬门禁**。

## 设计决策(2026-06-01 user 拍板)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 公证撞超时/失败怎么办 | **停下保留状态 + `/ship resume` 续发** | 苹果公证可能卡数小时(实测 30min 超时 / 05-30 提交卡 2 天),不能干等;包已签名,补公证不用重 build |
| 推送前是否再确认 | **触发即授权,一口气跑** | 用户要 fire-and-forget;ship 前已自测 |
| 双轮启动验证是否纳入 | **不纳入,作为 ship 前置门槛** | 双轮需人工目测,与全自动冲突;用户 ship 前自己验过才启动 |
| code-review | **高危崩溃级才停问,普通小问题记报告** | 平衡质量闸与全自动 |

## 核心约束

- **🔒 不公证不推送**:公证门禁(`stapler validate` + `spctl -a` accepted)未过 → 停,产物留本地,绝不推 GitHub/Gitee。
- **绝不 push main / 不合 feat→main**:bump commit 走 `chore/ship-mac-<env>-<版本>` 分支,只 push chore 分支 + tag。
- **绝不直接 `tauri build`**:走 `pack-installer.sh` 品牌 wrapper。
- 触发 `/ship` 即授权 release 动作一口气跑。

## 为什么 .dmg 要「重命名」而非直接打目标名(常见疑问)

苹果 `CFBundleShortVersionString` 限 **3 段**(X.Y.Z),我们的 installer 版本号 `YYYY.M.D.N` 是 **4 段**。tauri 的 version 同时进文件名和 plist,直接用 4 段号会违反苹果规范(公证/Gatekeeper 拒)。所以设计是:**内部版本沿用上游合法 3 段 semver(不动 package.json 避冲突)+ 文件名用 4 段 installer 号(pack-installer.sh Step 2.5 mv 桥接)**。Win 能直接打目标名是因 Windows 版本号支持 4 段;macOS 受苹果限制必须 mv。

## 验收标准

1. `/ship` happy path 全自动跑完 0→8,只在 3 类异常停。
2. 公证门禁未过时停在「已签名未公证未推送」,不碰远端。
3. `/ship resume` 能在公证补好后续发,不重 build。
4. 零硬编码隐私(签名身份/token 走 config.env + 环境变量)。
5. skill 本机生效(`.claude/commands/ship.md`),不与 Win `/ship` 冲突(各端本地)。

## R8 测试用例清单

| # | 验什么 | 层级 | 预期 | 结果 |
|---|---|---|---|---|
| T1 | 步骤 3 打包+签名+公证链路(运行时·native) | 运行时 | pack-installer 出签名 .dmg | ✅ 本 session 实测(签名成功,公证苹果超时) |
| T2 | 步骤 3.5 公证门禁判定 | 运行时 | spctl/stapler 正确识别已签名未公证 | ✅ 实测 spctl=Unnotarized Developer ID |
| T3 | 命名对齐稳定版规则 | 静态 | DeskFox-YYYY.M.D.N_aarch64.dmg | ✅ 实测 DeskFox-2026.6.1.1 |
| T4 | skill 零硬编码隐私 | 静态(review) | grep 无身份/token | ✅ 全走环境变量 |
| T5 | 步骤 4-8 推送逻辑 | review | 命令正确、走 chore 分支不碰 main | review 通过(真推送待实际发版验证) |
| T6 | resume 模式逻辑 | review | 补公证→门禁→续 4-8 | review 通过 |

> 步骤 4-8(真推送 GitHub/Gitee)不能在测试中真跑(会真发布),靠 skill 逻辑 review + 复用已实战验证的脚本(mirror-asset-to-gitee.sh / gh / Gitee API 均 user 历史实战过)。

## DMG 安装窗口布局规范(固化值,2026-06-05 user 拍板)

`build-deskfox.sh` step 5 recreate-dmg 的 osascript 布局,**这些是规范值,改动前必须先出预览 dmg 给 user 看**:

| 项 | 值 |
|---|---|
| 窗口 bounds | `{400, 100, 1040, 500}`(= 640×400) |
| 图标尺寸 icon size | **128px**(曾用 96px,user 反馈太小,2026-06-05 改 128 定稿) |
| DeskFox.app 位置 | 左 `{180, 200}` |
| Applications 位置 | 右 `{460, 200}` |
| 排列 | not arranged + icon view + 无工具栏/状态栏 |

调布局的快速预览法(不签名不公证,~30s):用现成 `bundle/macos/DeskFox.app` 重建 dmg 到 `/tmp` `open` 给 user 看,定稿后再改 osascript 值做最终签名+公证版。

### DMG 重建两条铁律(2026-06-04 两个 bug 教训)
1. **mktemp 占位文件**:`mktemp /tmp/...XXXXXX.dmg` 因 `.dmg` 后缀被 BSD mktemp 当字面名建 0 字节文件 → `hdiutil create` 拒绝覆盖死在 step 5。create 前必 `rm -f "$DMG_TMPIMG"`。详 [dmg-recreate-mktemp-clobber-fix]。
2. **重建 dmg 必须补签**:`hdiutil convert` 产物未签名 → 公证后 `spctl -t open` 判 "no usable signature",下载挂载被 Gatekeeper 拦。顺序铁律:**签 dmg → 公证 → staple**(公证后再签会废 ticket)。详 [dmg-recreate-sign-fix]。
