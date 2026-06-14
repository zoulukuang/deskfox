feat-id: win-ship-命令
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

## 规模

Medium(SOP 三文档入仓 + user 级 ship.md 加步骤 3.5)。纯发布工具链编排 + 文档,0 改上游,0 产品代码/运行时变化,0 R4。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `~/.claude/commands/ship.md` | 改(**本机,gitignored,不入仓**) | 步骤 3 与 4 之间插入 **步骤 3.5「填实版本台账」**:用本次发布真实内容填实 `installer-versions.md` 的 placeholder,再 commit,保证步骤 8 回流 main 的是完整台账。 |
| `docs/features/win-ship-命令/{1-spec,2-plan,3-changelog}.md` | 新增(入仓) | Win ship SOP 知识固化,对齐 Mac `macos-ship-命令`。 |
| `docs/features/INDEX.md` / `改动日志.md` | 改 | 索引各一行。 |

## 验证

- 步骤 3.5 填实逻辑:静态 review 通过;台账格式对齐已由本次 Win 6.1.1 回填(commit `50f1c5ce3`)实证。
- command 仍本机 gitignored:repo 无 `.claude/commands/ship.md`,仅 docs 入仓(对齐 Mac feat 处理)。
- 不碰 Mac 段:无 Mac 专属改动,跨平台合并未单方面执行。
- 步骤 4-10 真推送:靠 ship.md 逻辑 review + 复用已实战脚本,同 Mac feat。

## 影响范围

- 无产品代码 / 运行时变化,纯发布工具链编排 + 文档。
- 与 Mac `/ship` 互不干扰(各端本地 command,沿用既定架构)。

## commit

本笔 commit:`docs(win-ship): Win ship SOP 入仓 + ship.md 加台账填实步骤 [feat: win-ship-命令]`(command 本机 gitignored,仅 docs 入仓)。

## 回退

`git revert` docs 即可;user 级 `ship.md` 的步骤 3.5 删除即恢复(无运行时状态)。
