# Native MCP 关闭阻断修复：提交前复核

当前身份：笑南的电脑。日期：2026-11-14。工作树 `daily-use-integration`；仅实现、测试和准备评审材料，未暂存、未提交、未推送本次新增改动。

**审签回执（2026-11-14）**：上述为报告制作时状态。用户在复核完整补丁、测试及 Mac 重启结果后明确回复「批准补充修复提交与推送」，范围为 `feat/daily-use-integration`，不含 main 或发布。提交前暂存的 7 文件补丁 SHA256 再次核对为 `ec8a042c6d3b097b600693b655309f97eaff36fb08783e9b68494db591a0b7f1`，与本报告冻结对象完全一致。已获 R4 提交授权，执行普通完整 pre-push 后推送。

## 原因与最小方案

真实 local 桌面在自动启动 sidecar 时注入 `OPENCODE_CONFIG_DIR`，其中全局 MCP 定义 `enabled: true`。Config 在项目 `.opencode/opencode.jsonc` 之后再次加载该目录，保存项目 false 后读取仍为 true，触发 higher-priority 错误。当前 `Global.Path.config` 固定使用 XDG 默认路径，而不是注释所述的 Flag 覆盖；仅 `Global.make` 返回的服务对象覆盖 config。因此不是同一路径简单去重可以修复的问题。

launcher 的 fork helper 清除继承来源标记，尊重非空显式目录，只为自动 local 默认目录生成匹配标记。后台在目录合并后、环境/组织/managed 配置前，仅对匹配标记重放当前实例项目文件中的 MCP enabled 布尔叶。项目配置禁用时既不重放也不写入。其他项目不改，全局文件不改，其他配置字段不改变既有优先级。

自动桌面默认环境下，当前项目 enabled 同时高于 home `.opencode` 默认；这是实现项目作用域的明确决定。无标记显式目录/CLI 和真正环境、组织、managed 策略优先级保留。未扩展为修复整个 Global 配置加载迁移。

## R1 / R4 逐文件论证

| 文件 | 本次修改 | wrapper 可行性与风险控制 |
| --- | --- | --- |
| `packages/desktop/src/main/server.ts` | sidecar 环境构建返回 fork helper 的结果，并修正失实旧注释 | 上游白名单文件，遵循 R1/R2，不触发 R4；环境构建函数私有，外层 wrapper 无法可靠辨别 shell env 加载后的显式目录及自动注入来源。仅调用独立 helper，不改启动/网络/数据库逻辑。所有渠道清旧标记，显式同路径也不误标默认 |
| `packages/opencode/src/config/config.ts` | 在明确的私有合并位置接入 enabled 重放 | 上游黑名单文件；独立 helper 不能进入 `result`、加载上下文及私有 merge 顺序。接入限当前实例目录、来源匹配与 project-enabled 守卫，且位于环境/组织/managed 之前 |
| `packages/desktop/src/main/deskfox/config-dir.ts` | 新来源处理 helper | fork 文件；不修改继承对象，清理陈旧标记，已有显式目录优先 |
| `packages/opencode/src/config/mcp-toggle.ts` | 新 enabled-only 提取 helper | fork 文件；仅布尔值，不复制命令、URL、凭据或其他设置，不新增第二份状态库 |
| 三个相关测试文件 | launcher 环境、真实 Config/MCP、布尔叶提取回归 | 仅隔离临时目录；真实 MCP stdio 进程与真实配置加载，不以 mock 或重复业务实现冒充验证 |

7 个产品/测试文件，205 行新增、12 行删除；其中 2 个上游文件，1 个黑名单文件（`packages/opencode/src/config/config.ts`）。已核对 `.husky/pre-commit` 的 `BLACKLIST_REGEX`：包含 `desktop-electron`，不包含 `desktop/src/main/server.ts`；其余 opencode fork 文件动态豁免。上游文件身份不等于黑名单身份。Medium，不超过 500 行、不涉及 5 个上游文件。此前 R4 批准不覆盖此增量；本报告、完整补丁、native 复验供父会话集中请求新增提交确认。

## 复现与验证

- 真实桌面验收先发现关闭失败；随后独立包级复现配置目录与项目目录分离、全局 enabled=true，disconnect 实际抛 `A higher-priority configuration overrides this project's MCP switch`：0 pass / 1 fail。日志 `/tmp/mcp-desktop-config-repro.log`。
- 修复后 `bun test ./test/config/mcp-toggle.test.ts ./test/mcp ./test/config/config.test.ts`：177 pass / 0 fail，384 条断言，13 文件。新增 7 项 opencode 用例；日志 `/tmp/mcp-desktop-config-regression.log`。
- 覆盖关闭→实例重建保持关闭→其他项目仍开→手动开启；home 默认 enabled 不能恢复当前项目；project username/command 冲突仍保持原 desktop 合并结果；unmarked/mismatch/CONFIG_CONTENT/managed/project-disabled 不绕过策略。
- desktop 配置目录测试：7 pass / 0 fail，18 条断言，新增 2 项 launcher helper 用例。包含显式同默认路径、显式其他路径、旧标记、空环境值、发布默认无标记。日志 `/tmp/mcp-native-desktop-tests.log`。
- `packages/opencode` 与 `packages/desktop` 包级 `bun typecheck` 均退出 0。日志 `/tmp/mcp-native-opencode-typecheck.log`、`/tmp/mcp-native-desktop-typecheck.log`。
- `git diff --check` 通过。所有测试使用隔离配置；未操作用户真实 MCP 配置或 native QA 的正在运行实例。

独立只读 review：`file_links` agent 已审 7 文件，未发现新增阻断问题；确认来源清理/显式目录保留、仅 enabled 重放、策略后置及 project-disabled 守卫符合决定，并核对上述测试日志。其边界提醒：完整 Global 隔离迁移未解决，native 重打验证仍需完成，不能扩大结论。

## 冻结补丁与剩余事项

- 完整产品/测试补丁：`/tmp/daily-use-mcp-native-fix.patch`。
- SHA256：`ec8a042c6d3b097b600693b655309f97eaff36fb08783e9b68494db591a0b7f1`。
- 本报告和 spec 追加说明不在产品补丁中。
- 父会话已执行整批完整 pre-push，退出 0；日志 `/tmp/daily-use-mcp-native-pre-push.log`。重建 local 后，在实际打包 Electron 中通过 CDP 驱动真实开关：开启→关闭→刷新仍关闭；旧主进程 78225/sidecar 78232 均退出后，新主进程 79395/sidecar 79407 仍读到 disabled（全局 true、项目 false），手动开启才 connected。没有 mock native/HTTP；本轮 CUA 工具重连失败，故不冒充 CUA 鼠标或人工真桌面复验。完整证据见 [Mac local 回执](../daily-use-integration/6-mac-local.md)。
- 复验包 app.asar SHA256：`378a32dd08aa46ea25410d96e5efde55b608e04089fce7d393169c6cca3890c8`，代码为 `c5b9ded3b5` 加本节冻结补丁。测试主进程/后台已停止，既有正式/voice 应用存活，默认协议 handler 已恢复。
- 新增 R4 提交批准仍待父会话办理；不提交、不推送，不合 main，不发版。回退该增量即可恢复原行为，已有项目 JSONC 数据无迁移、无需删除。
