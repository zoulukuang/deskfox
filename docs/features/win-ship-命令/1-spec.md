feat-id: win-ship-命令
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 1-spec — Windows /ship 一键发版命令(SOP 入仓)

## 需求

把 **Windows 发版 SOP 固化入仓**,对齐 Mac 侧 `macos-ship-命令` 的既定模式:**command 各端本机(gitignored,避冲突)+ SOP 知识入仓(可追溯、双端可参照)**。同时补上一个长期缺口:**ship 时填实版本台账**,杜绝空占位回流 main。

> 背景(2026-06-03 清理时发现):
> - Mac 侧早有 `macos-ship-命令` 这份 SOP 入仓文档,Win 侧却**只有 user 级 `~/.claude/commands/ship.md`、没有入仓的知识副本** —— 流程不可追溯、双端不对称。
> - `docs/installer-versions.md` 里 Win/Mac 6.2.1 长期是「(待填)」空占位,Win 6.1.1 更是连回流 main 都没做(ship.md 步骤 8 的自动回流是 2026-06-02 才加,晚于 6.1.1 的 06-01 发版)。根因:ship 流程只写 placeholder 就 commit,从不填实。

## 设计决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| command 要不要入仓 | **不入仓,各端本机** | 沿用 Mac `macos-ship-命令` 既定决策:`ship.md` 含平台专属硬编码路径(Win `D:\project\opencode-fork\` + `.ps1`),入仓会与 Mac `/ship` 撞车;且 Mac 完整 SOP 在 Mac 机器,Win 端无法获取/验证。**只入仓 SOP 知识(本 feat)**。 |
| 台账空占位怎么办 | **ship 流程加「填实台账」步骤(3.5)** | 用本次发布真实内容(code-review 摘要 + `git log` 自上个 ship tag)填实,再 commit,保证步骤 8 回流 main 的是完整台账。 |
| 台账回流 main | **沿用 ship.md 步骤 8(2026-06-02 起已自动)** | 核心回流缺口已修;本 feat 只补「填实」与「SOP 入仓」两块。 |

## Win ship 流程概述(权威实现见 user 级 `~/.claude/commands/ship.md`)

0. **前置确认**:报当前分支/工作树干净;不在 main 上则提示确认。
1. **code-review**(安全网):挑 bug/启动崩溃风险(吸取 5.11.x castError 教训),高危才停问。
2. **杀进程**(无条件):`Get-Process DeskFox,OpenCode,opencode-cli | Stop-Process -Force`。
3. **一站式打包**:`pack-installer.ps1 -Env <prod|beta|dev>`(内部 bump→build `DeskFox.exe`→ISCC),产物到 `packages/branding/installer/Output/*.exe`,报完整路径给 user。
4. **3.5 填实版本台账**(本 feat 新增):用本次发布真实内容填实 `installer-versions.md` 的 placeholder,再进步骤 5。
5. **提交版本 bump**:守铁律#1 不在 main commit,从 main 开 `chore/ship-<env>-win-<版本>` 分支 commit(`.iss`/`installer-versions.json`/已填实的版本日志)。
6. **打 tag**:`ship-<env>-<版本>`(如 `ship-prod-2026.6.1.1`),版本号从 `.iss` AppVersion 读不手编。
7. **发 GitHub Release**:推 chore 分支+tag,`gh release create`(prod=`--latest`/dev=`--prerelease`)。
8. **镜像 Gitee**:Gitee API 建 release + `mirror-asset-to-gitee.ps1` 传附件。
9. **合 chore→main + push**(触发 ship 即授权):`git merge --ff-only` chore + `push origin main` + 删 chore 分支。
10. **收尾报告**:版本号/channel/release 链接/安装包路径/main 已同步。

## 与 Mac `/ship` 的异同

| 维度 | Windows | macOS |
|---|---|---|
| 打包脚本 | `pack-installer.ps1` | `pack-installer.sh` |
| 签名/公证 | **无**(installer 不签名,见 `数字签名问题.md`) | **有**(Developer ID 签名 + 公证 + `stapler staple`)|
| 公证门禁 | 不适用 | **🔒 不公证不推送** + `/ship resume` 续发 |
| 版本号段数 | 4 段直接用(Win 支持) | 内部 3 段 semver + 文件名 4 段(`pack-installer.sh` mv 桥接,苹果限 3 段)|
| 台账填实(3.5) | ✅ 本 feat 加 | 建议后续对齐(见 2-plan「后续」)|

## 验收标准

1. user 级 `ship.md` 含步骤 3.5「填实台账」,ship 后台账非空占位。
2. 本 feat 三文档入仓,可据此重建/审计 Win ship SOP。
3. command 仍本机 gitignored,不与 Mac `/ship` 冲突(沿用既定架构)。
4. 不碰无法验证的 Mac 段(跨平台改动留双端协作)。

## R8 测试用例清单

| # | 验什么 | 层级 | 预期 | 结果 |
|---|---|---|---|---|
| T1 | 步骤 3.5 填实逻辑可执行 | 静态(review) | Edit installer-versions.md 替换 placeholder 的指令清晰、内容来源明确 | ✅ ship.md 步骤 3.5 review 通过 |
| T2 | 台账格式对齐 | 静态 | 填实条目对齐 Mac 6.1.1 的 `主题/本次内容/Release` 格式 | ✅ 见本次 Win 6.1.1 回填(commit 50f1c5ce3)实证 |
| T3 | command 仍本机不入仓 | 静态 | repo 无 `.claude/commands/ship.md`,SOP 仅 docs 入仓 | ✅ 本 feat 只入 docs |
| T4 | 不碰 Mac 段 | review | 无 Mac 专属改动,跨平台合并未单方面执行 | ✅ |

> 步骤 4-10(真推送)不在本 feat 测试中跑(会真发布),靠 ship.md 逻辑 review + 复用已实战脚本(同 Mac feat 的处理)。
