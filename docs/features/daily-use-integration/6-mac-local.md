# Mac local 原生验收回执

执行：笑南的电脑，Codex 子 agent `vcs_ignore_design`，2026-11-14。仅构建和验收，未改产品代码、未提交。本回执保留首次失败和修复后复验；MCP 所列实际应用持久化流程通过，T04/Windows 仍未验。

## 首轮构建与隔离

- 产品集成头 `a4d3ec5691`，构建时 HEAD `caafc2ece3`（后续当时仅文档）。`OPENCODE_CHANNEL=local bun run build` 重建 Node sidecar 和界面，再用 `electron-builder.deskfox.config.ts --mac --dir --arm64 --publish never` 打包。下载校验等待后改用本机缓存 **同版本 Electron 42.11.15** 的解压副本作 `electronDist`，没有降级运行时。
- app 位于此 worktree `packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app`；appId `ai.deskfox.app.local`，显示版本 `2026.12.1`。首轮 app.asar SHA-256：`eeb1db5049e6dc5985409ba59b5b8f275b2846d8359e6054cae64b875e18b95e`。
- `verify-running-build.sh` 退出 0：asar 新于 out、LOCAL channel 正确、PID 9109/12467 确认加载对应 asar。不是旧包或 Vite mock 界面。
- 独立证据根：`/Volumes/ExtSSD/software/Codex/artifacts/daily-use-local-20261114`。`runtime` 下隔离 CFFIXED_USER_HOME、XDG 四目录、OPENCODE_TEST_HOME 和绝对 `OPENCODE_DB=runtime/data/daily-qa.db`；未重设 HOME；SHELL probe 指向 `/usr/bin/false`，避免真实 shell 配置覆盖隔离变量。CDP/sidecar 为 loopback 19427/19429。
- 仅合成 Git 项目、文件、本地 Python MCP，无真实凭据、无真实 DB 读写；LibreOffice 仅从既有 arm64 local 制品复制程序资源为新包独立副本。现有正式版 PID 1786、voice local PID 50560 保留。

## 首轮已验证

| 证据类型 | 结果 |
| --- | --- |
| CDP 调真实 native IPC | 项目外中文、空格、`%`、`#` 文件名 Markdown 正确；missing/directory/unsupported/encoding/invalid 分支正确；真 DeepSeek 已生成的两份合成文件均读到对应内容。详见证据根 `native-qa.json`。 |
| 真实 sidecar + LibreOffice | 项目外 docx 转换 HTTP 200，12227 字节 `%PDF-`；输出 `native-office.pdf`。 |
| 真桌面 CUA 点击 | 将真实 DeepSeek 返回正文复制进独立 QA 会话，点击含 `%20` 的 generated report.md 链接，弹窗显示正确项目外路径与 “The sample count is 7.”。会话为合成 fixture，未冒称该桌面会话再次调用模型生成。 |
| 真桌面文件预览 | 特殊字符文件链接显示正确名称及 NATIVE_PREVIEW_MARKER；Office 链接弹窗显示 NATIVE OFFICE QA MARKER 和共 1 页。 |
| 真桌面 Markdown 跳转 | 项目内 `guide%20space.md#target-section` 定位长文档 Target section；Back to start 回 Guide start，保留文件与会话、不跳首页。原生截图和 AX 证据在工具记录。 |
| 真实 watcher 短样本 | 40 次忽略文件写入、30ms 间隔：4 次分类全 false，0 diff；20 次 tracked 写入：3 次分类 true、3 次 diff，全部 200。合计并发峰值 2，收尾 0。详见 `watcher-check.json`。不是修前后压力对照。 |

## 首轮阻断：MCP 关闭失败

原生 UI 中 `daily_qa` 已 connected，点击关闭出现 Request failed / Unexpected server error，开关仍 on。项目配置已写 `enabled:false`，但 Electron 自动注入的 `OPENCODE_CONFIG_DIR` 指向 local 全局配置目录，晚于项目配置加载，令原全局 `enabled:true` 再覆盖它。真实 sidecar 日志抛 `A higher-priority configuration overrides this project's MCP switch`。

原证据保留在 `runtime/data/opencode/log/opencode.log` 与 `native-review.md`；已交 MCP agent 修复。此项首轮明确失败，必须修复重建后复验，不以既有单测代签。

## 协议副作用及恢复

本基线 `main/index.ts` 无条件注册 `opencode` 默认协议；本轮启动后真实 handler 为 `ai.deskfox.app.local`。本轮未提前独立快照，以既有 `voice-main-integration/3-changelog.md` 的记录 `ai.deskfox.app` 为恢复依据。已用 LaunchServices 恢复，状态 0，回读 `ai.deskfox.app`，日志 `protocol-restoration.log`。现有两个应用 PID 均存活。

按父线程决定，此批不引入范围外 voice/local guard 产品代码；每次本轮 local 启动后均恢复并回读，验收结束只停本轮 QA PID 再复核。CFFIXED_USER_HOME 不隔离系统 LaunchServices，不能据此声称启动零副作用；该未加保护包不交付裸启动体验。

## MCP 修复重建与复验

基准 HEAD `c5b9ded3b568d17add8dad9b83bf9e83cf75ca8e`（产品基准仍 `a4d3ec5691`）加 7 文件未提交冻结补丁 `/tmp/daily-use-mcp-native-fix.patch`。构建前自行重新导出产品 diff，SHA-256 与冻结对象完全一致：`ec8a042c6d3b097b600693b655309f97eaff36fb08783e9b68494db591a0b7f1`。父线程完整 pre-push 通过、专项测试和独立 review 通过后重建。仅 `config.ts` 涉新增 R4，提交审批由父线程处理；本次验收不代替批准。

仍使用 local build + DeskFox builder + 同版缓存 Electron。新 app.asar SHA-256：`378a32dd08aa46ea25410d96e5efde55b608e04089fce7d393169c6cca3890c8`。`verify-running-mcp-fix.log` 证明新 asar/LOCAL/对应进程；日志 `/tmp/deskfox-daily-local-build-mcp-fix.log`、`/tmp/deskfox-daily-local-package-mcp-fix.log`。

重连 CUA 连续三次超时（30/20/15 秒并 kernel reset），停止重试。按父线程指定改用 **CDP 驱动实际打包 Electron 的可见 Status→MCP→daily_qa 按钮**，没有 mock UI、IPC 或 HTTP；这是实际应用验证，但不冒称修复后再次做了 CUA/人工原生鼠标操作。

| 操作 | 真实结果 |
| --- | --- |
| 新包启动读取旧失败现场 | 全局 JSON 仍 true、项目 JSONC false，HTTP 状态 disabled，界面开关 off。 |
| 界面手动开→关 | connected/project true → disabled/project false；两次全局始终 true，HTTP 200，无原 500。 |
| renderer 刷新后 | 界面稳定后开关仍 off，HTTP disabled，全局 true/项目 false。初始化期间弹层重建曾使测试点击超时，等待稳定后重新观察通过，不修改产品绕过。 |
| 完整退出 | 记录旧主 PID 78225、真实监听 19429 的 sidecar PID 78232；SIGTERM 旧主后逐个验证两 PID 均消失，再启动，证据 `full-exit-proof.json`。不是只关窗口或复用后台。 |
| 完整新进程启动 | 新主 PID 79395、新 sidecar PID 79407；界面 off、HTTP disabled，全局 true/项目 false。 |
| 手动重新开启 | 实际按钮点击后界面 on、HTTP connected、项目 true，全局保持 true。 |

逐步 HTTP/配置/PID 证据：`mcp-native-retest.jsonl`；CDP 截图：`mcp-disabled-cdp.png`、`mcp-reloaded-disabled-cdp.png`、`mcp-full-restart-disabled-cdp.png`、`mcp-manual-reenabled-cdp.png`，均在证据根。

最终仅停止本轮主 PID 79395 及随其退出的 sidecar PID 79407，两者均确认消失；正式 PID 1786、voice local PID 50560 均存活（`final-process-cleanup.json`）。每次新启动后恢复协议，最终 LaunchServices 恢复返回 0，回读 `ai.deskfox.app`（`protocol-final.log`）。QA 启动器仅保留在证据目录，未作为用户体验包发布。

## 剩余边界

- MCP 修复补丁尚待父线程汇总新增实际 R4 审批；本回执不提交代码。
- REQ-149 T04 普通聊天 prompt 接受延迟的修前/修后负载对照未做；question reply、健康检查和本轮 watcher 短样本不能替代。
- Windows local 未验。此回执不是完整发布门放行。

完整构建日志：`/tmp/deskfox-daily-local-build.log`、`/tmp/deskfox-daily-local-package-cached.log`。证据根保留更详细的 `native-review.md`、`native-qa.json`、`watcher-check.json`、`seeded-message.json` 与原生 PDF。
