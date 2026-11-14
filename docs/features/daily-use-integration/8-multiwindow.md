# REQ-153：Mac 多窗口、项目作用域与配置失败验收

执行：笑南的电脑，Codex 子 agent `vcs_ignore_design`，2026-11-14。复用已构建的 local 包，未改产品代码、未提交。补充 [6-mac-local.md](./6-mac-local.md) 的单窗口结果。

本轮 T15 对应的 Mac 多窗口和两个 GUI 开关入口通过：同一项目的两个窗口同步关闭/开启；另一项目不受影响；切会话、切项目、刷新与完整进程重启后遵守保存状态。不可写配置会报错并保持原状态，没有伪成功。本轮为 **CDP 驱动实际打包 Electron**，不是人工 OS / CUA 真鼠标验收，不代签 Windows。

## 包、夹具与隔离

- 包为 `daily-use-integration/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app`，与 [6 号回执](./6-mac-local.md) 复验产物相同，产品等价于 `f517fc04b4`；`app.asar` SHA-256 为 `378a32dd08aa46ea25410d96e5efde55b608e04089fce7d393169c6cca3890c8`。未重新构建或混入后续文档变更。
- 全新证据根：`/Volumes/ExtSSD/software/Codex/artifacts/multiwindow-native-20261114`。runtime 内独立 CFFIXED_USER_HOME、XDG 四目录、OPENCODE_TEST_HOME、OPENCODE_DB；没有操作正式配置/DB。CDP 与 sidecar 仅监听 loopback 19611 / 19612。
- 全局配置定义 `shared_qa`，`enabled: true`，启动本目录自造 stdio MCP fixture；不连接外部 MCP，不使用真实凭据或模型。A 项目 `.opencode/opencode.jsonc` 初始有同名 `enabled: true`，并有注释和独立 `username: qa-a`；B 项目无覆盖文件。
- 通过真实桌面菜单 IPC `window.new` 创建额外两个原生窗口，初始路由/会话用隔离数据准备。A1 与 A2 为同一项目的不同会话，B 为另一项目。后续切会话、切项目均点击实际侧栏；开关均点击实际组件，没有用 HTTP connect/disconnect 代替 GUI 操作。
- 原正式版 PID 1786、voice local PID 50560 在开始前确认存活，结束后仍存活。每次启动后、退出后恢复 `opencode` 默认协议处理器为 `ai.deskfox.app`。

## 实测步骤与结果

| 步骤 | A1 / A2 | B | 证据 |
|---|---|---|---|
| 初始三窗口 | connected / connected | connected | states.jsonl `initial` |
| A1 状态栏 MCP 列表点击关闭 | disabled / disabled | connected | `A1-status-disable-broadcast`；broadcast-before-reopen.json |
| A2 `/mcp` 对话框点击可视开关开启 | connected / connected | connected | `A2-dialog-enable-broadcast`；enable-broadcast-before-reopen.json |
| A1 `/mcp` 对话框点击条目整行关闭 | disabled / disabled | connected | `A1-dialog-row-disable` |
| A 配置文件 0444、目录 0555 时，从状态栏尝试开启 | 保持 disabled / disabled | connected | readonly-error.json、readonly-error.png、`readonly-failure-no-state-change` |
| 同一窗口侧栏 A1 → A2 会话 → A1 | 均保持 disabled | 未修改 | navigation.jsonl 两条 session 记录及截图 |
| A1 renderer 刷新 | 保持 disabled | 未修改 | `reload-A1-disabled` |
| 同一窗口侧栏 A → B → A | 返回 A 仍 disabled | 切到 B 时 connected | `switch-project-B-connected`、`return-project-A-disabled` |
| 完整退出所有本轮窗口与 sidecar，再启动同一 runtime，自动恢复三窗口 | disabled / disabled | connected | restart.log；`full-process-restart-remains-disabled` |
| 重启后 A2 状态栏手动开启 | connected / connected | connected | `restart-manual-enable`；restart-enable-broadcast-before-reopen.json |

开/关广播证据在动作之后、重新展开另一窗口状态弹层之前采集：A1 关闭后，A2 在 `10:51:24.123Z` 自动收到本项目 `/mcp` HTTP 200；A2 开启后，A1 在 `10:54:04.106Z` 自动收到对应刷新。随后两窗口 UI 与真实 GET `/mcp?directory=...` 一致。B 没有收到这些 A 项目的刷新，并保持 connected。这避免把“重新打开弹层后才读到状态”当作广播同步。

源码只读核对，`useMcpToggle` 的 GUI 使用者为 `status-popover-body.tsx` 和 `dialog-select-mcp.tsx`；本轮覆盖状态栏、对话框开关控件、对话框条目整行三种点击方式。对话框由 `/mcp` 命令打开；没有声称逐个验收所有 OS 快捷键组合。

## 配置失败与不变量

只读配置尝试返回 HTTP 500，GUI `Request failed` 可见，没有 `MCP switch saved for this project only` 成功提示，A 配置内容逐字节不变，两个 A 窗口仍关闭。测试后已恢复本轮配置文件/目录权限。

UI 显示的是通用错误，**没有直接解释“配置只读”**；响应引用 `err_9175712e`，真实 sidecar 日志明确记录 `MCP settings file is read-only`。没有把通用报错描述为精细的错误原因提示。日志位于证据根 `runtime/data/opencode/log/opencode.log`。

`invariant-check.json` 检查七个状态快照：全局 MCP 定义（含 command、enabled）与启动前相同；启动完成后的全局配置全文跨操作保持一致；A 注释与 username 均保留；B 从未生成 `.opencode/opencode.jsonc`。桌面启动自身会补 schema、内置 plugin 与 agent 配置，因此“全局全文不变”的比较基准是初始化完成后的首份快照，不掩盖启动迁移。

## 重启与最终退出

| 阶段 | 主进程 / sidecar | 完整退出结果 |
|---|---|---|
| 首次运行 | 61033 / 61052 | 重启前两 PID 均已消失 |
| 重启复验 | 62668 / 62675 | 最终两 PID 均已消失 |

`process-exits.jsonl` 记录旧进程消失后才启动新进程；不是只关窗口，也没有复用旧 sidecar。重启自动恢复的三个 window ID 与初始一致，见 windows.json / restart.log。

最终 cleanup.json：19611 / 19612 均关闭、fixture 无残留进程、PID 1786 / 50560 保留；protocol-final.log 回读 `ai.deskfox.app`。本轮没有引入范围外的协议 guard 修复。

## 采集问题与边界

采集准备曾因弹层失焦关闭、非聚焦窗口的 Escape/快捷键、checkbox 透明 input 被可视控件遮挡、折叠侧栏不可见而停下；路由切换/刷新初始化期间过早打开状态弹层也会使它关闭。保留脚本版本和失败日志（continue-input-locator-failure.log、continue-shortcut-failure.log、continue.log、navigation.log、projects.log）。随后改用实际 Close 按钮、可视开关控件、展开侧栏并等待路由挂载稳定。已发生的开关动作没有重跑：开启后采集失败直接从 connected 状态续验，见 continue2.cjs。本轮未为此修改产品。

证据根保留 states.jsonl 七份状态、navigation.jsonl 五次导航、三个广播 JSON、只读错误 JSON、各窗口截图、启动/退出与服务日志；evidence-manifest.json 提供关键原始文件 SHA-256。全局配置快照只含本轮自造配置和桌面自动初始化内容。

本轮完成 Mac T15 的上述范围，并补充 T13 的状态保持及 T16 的不可写配置行为。没有验证真实 OAuth/网络连接失败、迟到连接回调、并发竞争或实际 MCP 工具调用（fixture 返回空工具表）；这些仍依赖原有专项自动化，不能由本回执代签。Windows、人工 OS QA、正式签名制品验收均不在本回执范围。未合 main、未发布。
