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

## 2026-11-14 实施决定与进度

复用 ConfigV1 已支持的 `{enabled:boolean}` 项目覆盖层，避免新增状态文件。新增原子 JSONC 单叶写入 helper，接入 Config 私有缓存与 MCP 生命周期；不修改原始连接定义。父会话复核后补齐 OAuth 直接保存路径、所有终检的 yield 顺序，以及保存失败不能使在途连接失效。

实际改动为 spec 清单内的 4 个上游文件 + 3 个新文件；没有新增依赖、修改公开协议、顺手修其他配置问题，也未批量替换。旧 `Config.update` 的路径缺陷仅记录，未扩大修复范围。现有 Config 测试替身需补新接口，范围提示放在已有 server-sync 入口，未再修改两个视图。

复现→修复、13 条新测试和既有 MCP 回归均完成；最终完整 pre-push 已通过。代码待 R4 审批提交；桌面多窗口/重启与 Windows 待验，不能标 done。
