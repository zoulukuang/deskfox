feat-id: mcp-toggle-persistence
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

## 2026-11-14 补充：真实 local 启动配置复现与修复待提交

后续回执：用户已批准补充修复；`f517fc04b4` 按冻结补丁提交并通过正常推送完整闸，位于 `feat/daily-use-integration`。下段待批状态是复核时记录，现已解除。

集成验收发现桌面自动 `OPENCODE_CONFIG_DIR` 覆盖项目 enabled。新增窄修已完成先红后绿复现、177 项配置/MCP 回归、完整闸、独立评审与实际打包 Electron 的完整后台重启验证；冻结补丁 `ec8a042c6d3b097b600693b655309f97eaff36fb08783e9b68494db591a0b7f1`，尚待新增 R4 提交确认，未冒用此前授权。实际改动与来源边界见 [4-native-config-review.md](./4-native-config-review.md)，原生证据见 [Mac 集成回执](../daily-use-integration/6-mac-local.md)。仅 1 个黑名单文件 config.ts；未修复完整 Global 配置迁移。以下首次提交/推送记录保留原样。

# 接手与验证

## 接手中（笑南的电脑，Codex 子 agent，2026-11-14）

系统名称已核实为「岳笑南的Mac mini」。由主会话分派 REQ-153，本 feat 仅本子会话执行。

- 分支/代码：`fix/mcp-toggle-persistence`，基线 `fc96b0b5b5`，工作目录 `mcp-toggle-persistence`。主会话已先更新 main，再创建此分支。
- 已验：只读核对 GUI 入口与配置/连接代码，尚无产品测试或实现。
- 剩余：作用域与竞态设计、先复现后修复、R4/规模评审、T13–T17 及桌面验收。
- 验收：关闭重启不再连接，显式开启恢复，隔离配置/故障/多窗口/迟到回调均通过；Windows 交 Windows 电脑，当前尚未分派执行。
- 本笔仅 Markdown 接手记录；diff 检查与提交守卫，按 docs-only 例外跳过产品 pre-push。不合 main、不发版。

## 实现与 R4 提交前复核（笑南的电脑，2026-11-14）

接手提交 `32cf984183` 已推送；本节对应同分支未提交的实现，基线本地标签 `pre-mcp-toggle-2026-11-14` → `fc96b0b5b5`。新代码只在隔离 fixture 执行，未触碰真实 MCP 配置。

| 黑名单文件 | 必须接入的位置与 wrapper 不可替代原因 | 风险及控制 |
| --- | --- | --- |
| `packages/opencode/src/config/config.ts` | 新内部 setter 写真实项目覆盖层后，失效私有 `InstanceState` 配置缓存并检查最终 enabled；单独文件 wrapper 无法刷新该闭包缓存，旧公共 update 写的 config.json 不会加载 | 仅写 enabled，遵守环境/托管优先级；原参数不复制，读取/写入失败传播 |
| `packages/opencode/src/mcp/index.ts` | connect/disconnect、OAuth 及最终 storeClient 共享私有 clients/defs；外层 handler 无法阻止迟到结果写入工具表 | 写入成功后推进序号，终检后到更新 client/defs 无 yield；过期 client 关闭，失败保存不取消已有连接 |
| `packages/opencode/test/fixture/config.ts` | 现有 Config.Service.of 测试替身必须补新增内部接口，否则包级类型检查失败 | 只加一个默认空实现，不改旧测试断言；新测试均走真实配置及 MCP 客户端 |

其余改动：`app/context/server-sync.tsx` 监听既有 tools.changed 通知刷新所有窗口，并仅对内建 v1 后台提示“已保存，仅当前项目”；新增 `config/mcp-toggle.ts` 与两个测试文件。均与预清单一致，无未知代码或顺手改动。3 个黑名单文件已核实存在于 upstream-base；新文件走 fork-only 豁免。此表满足 R4 的 wrapper 论证/风险/改动日志要求，**仍待用户对具体改动批准，未提交黑名单代码**。

### 证据

- 先运行真实 stdio fixture 复现：disconnect 后重建实例实际为 connected、预期 disabled，1 fail；修复后对应用例通过并验证手动开启再次重建保留。
- `bun test ./test/config/mcp-toggle.test.ts ./test/mcp`：**74 pass / 0 fail**，其中本次新增 13 条；JSONC 注释/参数保留、并发键、不同项目、只读/坏文件/符号链接、重建、全局定义的项目覆盖、失败连接、快速开关、强制配置、迟到 connect 与 authenticate、保存失败时在途 connect 均覆盖。
- `packages/opencode` 的 `bun typecheck` 通过；最终 `.husky/pre-push` 退出 0：29 个类型检查任务；app 1197 + 41、media-gen 140、feishu 792、branding 82、desktop 176、session-ui 125 全通过。Bun 为 1.3.14。
- 本机日志：`/tmp/mcp-persistence-tests-final.log`、`/tmp/mcp-persistence-pre-push-final.log`；`git diff --check` 通过。新增全局来源测试首轮因测试层未暴露 Config service 失败，修正测试 Layer 后通过，未跳过用例。

### 未验与交接

父会话汇总 R4 审批；代码获准提交后再交两端 local 验证真实刷新/重启、两个窗口与两个 GUI 入口的状态同步。当前未跑真桌面 QA、Windows、真实远程 v2 后台，T13–T17 的 GUI/桌面部分仍待验。无 main 合并、版本修改或发布。

回退：实现单笔 revert；已写的 `.opencode/opencode.jsonc` 是上游原生 enabled 覆盖语法，回退后仍可读取，用户可手动改 enabled。不要回滚整份配置或删除无关字段。

## R4 授权与实现提交（笑南的电脑，2026-11-14）

用户于 2026-11-14 明确授权「批准三组提交与推送」，由父会话传达。本组审批对象为 7 个实现/测试文件的完整暂存补丁，SHA256 `88f12fab5eae5e6668f62d0d5d825284e4352eeee2b178182130eb2415de14b9`；提交前再次核对一致（419 行新增、14 行删除），未修改已验实现。

此授权满足上节 R4 逐文件复核后的二次确认。实现提交仅按 R4 黑名单例外使用 `--no-verify`，提交信息保留 override-blacklist / bug-repro / feat 标记；不豁免推送前完整 `.husky/pre-push`，按父会话资源协调等待运行。无 main 合并、版本修改或发布，桌面验收仍按上节未验边界执行。

实现提交：`ddd1940720`。本节及根索引单独 docs-only 提交；实现补丁与获批对象保持逐字一致。

### 推送回执（笑南的电脑，2026-11-14）

`ddd1940720`（实现）和 `142c4179c7`（授权记录）已正常推送 `origin/fix/mcp-toggle-persistence`，完整 pre-push 未跳、退出 0；日志 `/tmp/mcp-persistence-push-approved.log`。已核对本地与远端跟踪引用同为 `142c4179c72440a50c4275376dcedcfea6b5d8d7`。本段为成功后的 docs-only 回执，无产品变更，按 docs-only 例外跳过重复 pre-push；常规 pre-commit 仍执行。功能仍为 in-progress，真实桌面/Windows 验收及合并发布仍待主会话推进。
