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

## 回执（笑南的电脑，2026-11-14）：批准提交与整批自动化

用户对三组实际补丁明确回复「批准三组提交与推送」。各组冻结补丁 SHA 与获批对象逐一一致；功能分支正常推送完整 pre-push 均通过：

| 分组 | 实现提交 | 已推送功能分支头 |
| --- | --- | --- |
| REQ-149 | `6271ed9d02`（含此前查询键、HEAD/元数据修复） | `54ee8fd5d8` |
| REQ-153 | `ddd1940720` | `fc3a1b5f62` |
| REQ-152/146/160/162 | `eb343b8ce1`（模型约定；此前文件解析/预览分笔保留） | `eb343b8ce1` |

集成合并 `9bd78bba57`、`46e55926ed`、`a4d3ec5691` 只解决 INDEX 同位置新增行，保留所有条目；`session.tsx` 两处独立接线自动合并，没有额外产品修改。三笔合并沿用本轮已批准 R4/大改例外提交，未重复请求同一补丁审批。后续 `caafc2ece3` 只合入 MCP 推送回执。产品树基准为 `a4d3ec5691`；整批头 `caafc2ece3` 已通过正常 push 的完整 pre-push 并推送远端，没有跳过产品推送检查。

- 完整闸：29/29 包类型检查、六包测试全绿，日志 `/tmp/daily-use-integration-push.log`。
- 后台专项：在 `packages/opencode` 分三个隔离进程首次运行，Git+HTTP 6 pass/80 断言、MCP+配置 74 pass/197 断言、文件交付 helper/真实 prepare 9 pass/32 断言，共 89 pass/309 断言，零失败、零重试。
- 后台证据：`/tmp/daily-integration-vcs-backend.log`、`/tmp/daily-integration-mcp-backend.log`、`/tmp/daily-integration-file-delivery.log`。真实 Git/FIFO 子进程终止、HTTP 鉴权/目录边界与 MCP 迟到回调均覆盖；不据此声称真实模型或桌面验收。
- 七条浏览器回归、Mac local 独立包与原生验证继续进行。Windows 端待交接；main、正式版本号和发布入口未变更。
