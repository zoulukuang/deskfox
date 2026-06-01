feat-id: package-verify-script
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

## 规模

Medium(单一新增脚本 ~165 行 + 三文档)。纯 fork-only,0 改上游,0 R4 override。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `packages/branding/scripts/verify-deskfox-package.sh` | 新增 | A 层包完整性 + B 层 sidecar headless 冒烟;`-Env dev/beta/prod` 三档;`SCRIPT_DIR` 自推导无硬编码。 |
| `docs/features/package-verify-script/{1-spec,2-plan,3-changelog}.md` | 新增 | 三文档。 |
| `docs/features/INDEX.md` | 改 | 索引一行。 |
| `改动日志.md` | 改 | 索引一行。 |

## 验证(实跑证据)

- **prod 包(DeskFox 1.14.33)实跑:PASS=23 / FAIL=0**,退出码 0。
- A 层覆盖:结构(6)/ 架构·可执行(6)/ 三档身份(2,Bundle ID=`ai.deskfox.app`)/ Gatekeeper(1)/ catalog 内联数据(5,含 15 model id 全内联 + 标签 + 0 外部读取)。
- B 层覆盖:sidecar `serve` 真监听 `127.0.0.1:47821` + HTTP 响应 + 日志无 fatal;plugin.js ESM 加载导出 `MediaGenPlugin, default, server`。
- **泛化去硬编码后重跑仍全过**(/tmp 原型 24 项 → 入仓版 23 项,差 1 是".app 存在"改为前置 if 检查不再单独计数)。

## 影响范围

- **无运行时 / 产品行为变化**:纯新增打包配套验证工具,不参与任何产品代码路径。
- 跟 `e2e-tauri-mac/`(C 层 GUI)互补:本脚本覆盖"无需 GUI 即可自动验证"的 A/B 两层。

## 回退方法

`git revert <commit>` 或删脚本 + 三文档 + 两索引行。纯可逆,无运行时状态。

## commit

本笔 commit:`chore(branding): 打包产物自动化验证脚本 A+B 两层 [feat: package-verify-script]`(`git log --grep package-verify-script` 反查)
