feat-id: mcp-toggle-persistence
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

1. 盘点两个 GUI 入口共用的 `server-sync.mcp.toggle`，以及 v1/v2 连接契约。
2. 核对配置加载与更新的真实作用域，不直接把 `enabled` 写到任意全局配置。
3. 形成 R1/R4 接入点评审和改前文件清单，补复现测试，再实施最小修复。
4. 隔离 fixture 验 T13–T17，包级类型检查和回归；完整 pre-push 由主会话协调资源。
5. 真桌面与 Windows 验收单独记证据，未完成前不标 done。

## 初步发现

- `status-popover-body.tsx` 与 `dialog-select-mcp.tsx` 均调用 `useMcpToggle` → `server-sync.mcp.toggle`；当前调用 connect/disconnect 并刷新，不保存意图。
- v1 后台 `MCP.connect/disconnect` 只改变实例状态，启动读取配置 `enabled`。
- 项目 `Config.update` 写 `<directory>/config.json`，而项目加载路径使用 `ConfigPaths.files("opencode", ...)`；需要实证确认，不能直接依赖这一更新接口完成持久化。
- 文件配置来源没有向 GUI 提供 MCP 逐条来源；直接更新 global 会误影响其他项目，直接快照有效配置会固化合并后的连接参数。待评估更小而可靠的作用域方案。
