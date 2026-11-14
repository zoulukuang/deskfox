feat-id: daily-use-integration
status: in-progress
related: ../deskfox-vcs-refresh-overload/1-spec.md ../daily-file-links/1-spec.md ../mcp-toggle-persistence/1-spec.md

# 六项日常使用修复集成验证

## 接手中（笑南的电脑，Codex 主会话，2026-11-14）

用户已确认六项计划、授权并行实施，并于本轮批准三组实际 R4 补丁提交推送。三个功能分支各自提交后，在 `feat/daily-use-integration` 汇合，验证交互与构建；主干基线 `fc96b0b5b5`，创建前已更新本地 main。该分支不承担版本号或发布候选冻结。

- 范围：REQ-149、REQ-152、REQ-146、REQ-160、REQ-162、REQ-153；功能设计及 R8 用例沿用三个原 feat 文档和规划仓 `需求计划/2026-11-14.md`。
- 已验：各分支完整 pre-push 和专项测试；文件组生产构建及 6 条 Chromium GUI。详见各组回执，不冒充整批验证。
- 本轮：合入三个已获提交授权的分支，处理索引/接线冲突；运行集成代码的完整闸、相关后台测试及浏览器回归；构建隔离 Mac local 包并尽可能完成本机原生场景。
- 验收边界：Windows 真桌面结果交 Windows 电脑；真实模型通道、Office 成功转换及两端负载用例须有实际证据。缺项如实留存，不能用单测或页面 mock 代替。
- 权限：仅功能分支提交/推送与集成验证；合 main、正式发布按既有治理另行执行。

本笔仅登记集成接手；diff 检查与普通提交守卫，docs-only 例外不重复产品测试。功能改动在已有三个 feat 中，不另建重复需求与设计。
