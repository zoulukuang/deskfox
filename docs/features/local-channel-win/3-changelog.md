---
feat-id: local-channel-win
status: done
related: ./3-changelog.md
---

# local-channel-win — local 第 4 档 Win 侧落地 + 双端杀进程三档定稿

> Win 侧把 `local` 本地测试版第 4 档补齐到与 Mac 对等,并和苹果端同事协同把「build 前杀进程」规则定稿成三档矩阵;配套 Windows 适配性测试脚本固化。
> 主体 local 第 4 档规则见《版本号与发布渠道规范》§3.11/§4.3/§5.3 + CLAUDE.md 验证约定(权威源);本档只记 **Win 侧落地 + 双端协同轨迹**,事后补齐。

## 改动清单(commit,均已在 main)

| commit | 内容 |
|---|---|
| `fee56d35b` | **Win 测试脚本固化**:`verify-fileviewer.py` 入仓(纯 CDP 点侧边栏图标打开测试项目、零 native 对话框,逐个验 pdf/docx/xlsx canvas + png img);新建《Windows-适配性全自动测试-SOP.md》§2 回填全自动方案。修「`[...querySelectorAll].map` spread 写法让 CDP `Runtime.evaluate` 稳定挂起」的坑(改 for-loop)。 |
| `67d0c8f0a` | **Win wrapper `-Env local`**:`build-deskfox-electron.ps1` ValidateSet 加 local + versionKey 回落平台裸号 + 始终 `--dir`;CLAUDE.md 版本号速查 + 验证约定补第 4 档 local(三档→四档)+ 标注双端差异。config 层 local 身份(appId `ai.deskfox.app.local` / 产物名「DeskFox 本地版」/ 数据隔离 `opencode-local.db`)早已就绪,本笔补 wrapper 入口。端到端实测出包 exit 0、身份注入正确。 |
| `06ee13d49` | **双端杀进程三档定稿**:跟同事 `9da2eed50` 矩阵统一并补全 beta。`if local→杀 DeskFox 本地版;else→杀 DeskFox + 预览版 + Beta`(发布三档共享 `opencode.db` 不能共存);排除 local、不通杀 `electron`/`opencode-cli`、`-Name` 精确匹配。覆盖 CLAUDE.md 权威 + Win `.ps1` + Mac `.sh` + Windows SOP + `/ship`。 |

## 双端协同轨迹

- Win/Mac 并行做 local 第 4 档:Win(本端)先 `-Env local`(`67d0c8f0a`),Mac 同事随后对等(`17bbd6926`)。
- 杀进程规则一度各改一半:本端先改「只杀本档」,同事在 CLAUDE.md 定稿「发布档两档一起杀」→ 本端**推翻己见对齐权威源**,并补全同事遗漏的 beta(发布三档都共享 `opencode.db`)做严谨版。
- 协作纪律沉淀见记忆 `feedback_dual_end_rule_alignment`;git 层竞态整合见 `feedback_concurrent_session_git_race`。

## 影响范围

- **行为**:打包/测试前杀进程从「通杀」收窄为「按矩阵精确杀」——打 local 不再误杀正在用的正式版;打发布档杀全部发布三档避免 `opencode.db` 争用 + session 表写坏。
- **新增 channel**:Win `build-deskfox-electron.ps1 -Env local`(本地测试版,永不发布、始终 `--dir`)。
- **测试基础设施**:`verify-fileviewer.py` 全自动文件预览验证入仓。
- **无产品运行时改动**:全是 build 脚本 / 测试脚本 / 治理文档 / user 级 ship 命令。

## 验证

- Win wrapper `-Env local`:端到端出包 exit 0,产物「DeskFox 本地版.exe」、appId `ai.deskfox.app.local` 注入正确。
- 杀进程矩阵:实测发布三档名不误伤本地版(双向隔离)、local 档精确杀本档;Mac `.sh` `bash -n` 语法 OK(**beta 补全未真机实测,已在 commit 请同事 Mac 侧过目**)。
- 文件预览:`verify-fileviewer.py` 4/4 PASS。
- pre-push 闸:fork 包单测 740 pass / 0 fail。

## 回退

各 commit 独立可 `git revert`;`/ship`(user 级,不入仓)与服务器无关。
