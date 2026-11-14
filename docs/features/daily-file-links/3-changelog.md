feat-id: daily-file-links
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 文件链接与查看修复

## 接手（笑南的电脑，Codex，2026-11-14）

接手中（笑南的电脑，Codex 子 agent `file_links`，2026-11-14）。用户批准六项迭代范围并授权并行开发；本会话独占 REQ-152、REQ-146、REQ-160、REQ-162 的共同入口。

- 代码位置：`fix/daily-file-links`，从最新 `main=fc96b0b5b5` 创建；独立工作目录 `daily-file-links`。
- 已验：只读确认共享 Markdown 点击处理器；尚未修改代码或运行产品测试。
- 剩余：施工 spec/R1/R8；先修编码与锚点，再完成项目外预览和各模型通道文件链接约定。
- 验收：按本批计划 T05–T12 和本 feat spec，实际看到内容；Mac/Windows local 与真模型抽查分别留证，不以单元测试替代。
- 边界：不改 main、不发布、不改规划仓。Large/R4 具体方案交主 agent 汇总审签，不把范围许可当成 override。

本笔仅登记接手：diff 检查与 pre-commit，按 docs-only 例外跳过全量 pre-push 产品测试。
