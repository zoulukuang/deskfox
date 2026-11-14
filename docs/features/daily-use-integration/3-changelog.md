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

- 完整闸：29/29 包类型检查；app 1260+41、media 140、adapter 792、branding 82（8 条既存 skip）、desktop 185、session-ui 137，零失败，日志 `/tmp/daily-use-integration-push.log`。
- 后台专项：在 `packages/opencode` 分三个隔离进程首次运行，Git+HTTP 6 pass/80 断言、MCP+配置 74 pass/197 断言、文件交付 helper/真实 prepare 9 pass/32 断言，共 89 pass/309 断言，零失败、零重试。
- 后台证据：`/tmp/daily-integration-vcs-backend.log`、`/tmp/daily-integration-mcp-backend.log`、`/tmp/daily-integration-file-delivery.log`。真实 Git/FIFO 子进程终止、HTTP 鉴权/目录边界与 MCP 迟到回调均覆盖；不据此声称真实模型或桌面验收。
- 七条浏览器回归已通过（Chromium、单 worker、retries=0、18.5 秒），日志 `/tmp/daily-use-integration-gui-final.log`。首轮文件 6 条通过、VCS 在 SSE 夹具连接前超时，原因是手动 Vite 启动漏了原配置的 `VITE_OPENCODE_SERVER_HOST=127.0.0.1`，默认 localhost 与夹具 URL 不同；按既有配置补齐 HOST/PORT 后全 7 条通过，无产品/测试改动，无放宽断言。该结果是浏览器回归，不是 Electron IPC 结果。
- 文件组最终回执头 `6e8da39dcb` 已合入（仅新增推送记录）。Mac local 独立包与原生验证继续进行。Windows 端待交接；main、正式版本号和发布入口未变更。

## Mac local 验收发现（修复中，不可据前述自动化签完成）

隔离 local 包已成功构建并经 `verify-running-build.sh` 核对真实加载的 asar。2026-11-14 原生 MCP 点击关闭失败：桌面向 sidecar 注入 `OPENCODE_CONFIG_DIR=…/opencode-local`，但当前 Config 静态 `Global.Path.config` 仍为 `…/opencode`；仅 `Global.make()` 服务对象接受该覆盖。目录列表中的自定义 local 目录在项目配置之后加载，覆盖刚持久化的项目 `enabled:false`，随后有效配置校验按设计拒绝。这是本次真实桌面暴露的遗漏启动条件，不能以 74 项测试绿代替修复。正在补复现与最小来源区分修复，保持明确环境强制配置/托管配置的优先级。

同轮项目外特殊文件名读取、两个 DeepSeek 真模型产物经 Electron IPC 读取、错误分支及真实 DOCX→PDF（HTTP 200，12227 字节）已通过；完整桌面证据稍后补记。REQ-149 两版本普通聊天提交负载对照仍未完成，不能用 question reply 的浏览器用例替代。

补充修复已经完成包级红绿复现和独立复核：只给桌面自动注入的默认目录标记来源，仅重放当前项目 MCP enabled 布尔值；非空显式目录、CONTENT/组织/managed 强制配置保持优先。完整配置/MCP 177 项、desktop helper 7 项、两包类型及整批完整 pre-push 全通过。冻结产品补丁 `/tmp/daily-use-mcp-native-fix.patch`，SHA256 `ec8a042c6d3b097b600693b655309f97eaff36fb08783e9b68494db591a0b7f1`。重建后实际打包 Electron 的按钮经 CDP 驱动，开启/关闭、刷新和完整主进程+sidecar 退出重启均通过，手动开启才恢复；新旧 PID 和全局 true/项目 false 的证据详见 Mac 回执。修复后 CUA 工具不可用，不将本轮 CDP 驱动等同 CUA/人工鼠标复验。新增 R4 提交审批已向用户提出、尚待回复；不能冒用先前三组冻结补丁的批准。详情见[补充复核](../mcp-toggle-persistence/4-native-config-review.md)。

## 证据与交接入口

**补充提交回执（笑南的电脑，2026-11-14）**：用户明确回复「批准补充修复提交与推送」。7 文件产品/测试暂存 diff 的 SHA256 与上述冻结对象一致，连授权回执提交为 `f517fc04b4`；正常 push 再次完整闸通过并推送到 `feat/daily-use-integration`，日志 `/tmp/daily-use-mcp-native-approved-push.log`。上段“待回复”为此前状态，现已解除；未合 main、未发布。Mac T04 修前后负载对照继续进行。

- [Windows 执行交接](./4-windows-handoff.md)：六项最小夹具与通过条件，明确无人接手、不能沿用旧 REQ-149 Windows 回执。
- [真模型记录](./5-model-smoke.md)：DeepSeek API 真实读写返回有效链接，目标内容已验证；GetBot 401、OpenAI OAuth 未知服务错误分别保留，不算通过。未发现 workflow 真通道，未测试过期 Anthropic。
- [Mac local 原生回执](./6-mac-local.md)：真实 Electron IPC、CUA 点击、Office 转换、目录跳转、真实 watcher 短样本与 MCP 首次失败/复验，区分所有证据层级。local 启动曾改变默认协议 handler，已恢复 `ai.deskfox.app`；本轮后续启动均立即恢复并保留正式/既有 voice 进程，未把范围外修复并入六项。

六项仍为 in-progress。整批发版前尚需 Windows local、T04 两版本普通聊天提交负载对照、完整已启用模型通道矩阵及其他原 spec 未验项；不把代码集成、浏览器绿或单个真模型样本当作发布验收完成。
