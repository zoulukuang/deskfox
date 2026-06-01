feat-id: macos-ship-命令
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

## 规模

Medium(skill SOP ~120 行 + 三文档)。纯编排层,0 改上游,0 R4。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `.claude/commands/ship.md` | 新增(**本机,gitignored,不入仓**) | macOS `/ship` skill SOP:完整模式 0-8 + resume 模式 + 公证门禁 + 隐私约束。 |
| `docs/features/macos-ship-命令/{1-spec,2-plan,3-changelog}.md` | 新增(入仓) | 设计 + 步骤映射 + 决策,可据此重建 skill。 |
| `docs/features/INDEX.md` / `改动日志.md` | 改 | 索引各一行。 |

## 关键设计(详见 1-spec)

- **不公证不推送**(3.5 硬门禁)+ **公证失败 `/ship resume` 续发**(应对苹果服务不稳)。
- **双轮验证前置**(不进 ship)+ **触发即授权一口气跑** + **code-review 高危才停**。
- skill 本机不入仓(避免与 Win `/ship` 冲突),SOP 知识入仓本 feat。

## 验证

- 步骤 3/3.5(打包+签名+公证+门禁)本 session 实测过:Tauri 自动签成功、公证撞苹果超时、`spctl=Unnotarized Developer ID`、命名 `DeskFox-2026.6.1.1_aarch64.dmg`。
- 步骤 4-8(真推送)靠 skill 逻辑 review + 复用 user 历史实战过的脚本;真推送待下次实际发版验证。
- skill grep 零硬编码隐私(身份/token 走 config.env + 环境变量)。

## 影响范围

- 无产品代码 / 运行时变化,纯发布工具链编排。
- 与 Win `/ship` 互不干扰(各端本地 skill)。

## commit

本笔 commit:`feat: macOS /ship 一键发版命令 [feat: macos-ship-命令]`(skill 本机 gitignored,仅 docs 入仓)

## 回退

删 `.claude/commands/ship.md`(本机)+ `git revert` docs。无运行时状态。
