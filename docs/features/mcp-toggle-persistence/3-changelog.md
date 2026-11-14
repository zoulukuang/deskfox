feat-id: mcp-toggle-persistence
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 接手与验证

## 接手中（笑南的电脑，Codex 子 agent，2026-11-14）

系统名称已核实为「岳笑南的Mac mini」。由主会话分派 REQ-153，本 feat 仅本子会话执行。

- 分支/代码：`fix/mcp-toggle-persistence`，基线 `fc96b0b5b5`，工作目录 `mcp-toggle-persistence`。主会话已先更新 main，再创建此分支。
- 已验：只读核对 GUI 入口与配置/连接代码，尚无产品测试或实现。
- 剩余：作用域与竞态设计、先复现后修复、R4/规模评审、T13–T17 及桌面验收。
- 验收：关闭重启不再连接，显式开启恢复，隔离配置/故障/多窗口/迟到回调均通过；Windows 交 Windows 电脑，当前尚未分派执行。
- 本笔仅 Markdown 接手记录；diff 检查与提交守卫，按 docs-only 例外跳过产品 pre-push。不合 main、不发版。
