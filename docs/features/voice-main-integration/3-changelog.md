feat-id: voice-main-integration
status: in-progress
related: ./1-spec.md ./2-plan.md

# 集成回执

## 接手

接手中(笑南的电脑, Codex, 2026-11-14)。分支 `feat/voice-main-integration`；用户已授权整合与测试，未授权合 main。

- 起点 main：`fc96b0b5b5c8f4fce55875ec42b328f4731d6cc5`，已 `git pull --rebase origin main` 确认最新。
- 原语音头：`334ce3382d957694c0b2e1558cb9833cf0fe2c4a`，保留不改。
- 备份：`/Volumes/ExtSSD/software/Codex/backups/deskfox-cleanup-20261114-122100/local-branches.bundle`，含原语音分支。
- 工具链：Bun 1.3.14；执行电脑：笑南的电脑。

整合与自动化验证完成；真机体验未验，功能保持 in-progress。

## 代码整合

- 接手文档提交 `241ed48d7a`，整合提交 `277d6a9e23`(父提交包含原语音头，54 笔历史保留)。两处文档冲突采用保留双方条目，不覆盖较新 main。
- 新增修正仅测试装置与 pre-push 跑法；原语音运行逻辑、旧链路、图片与设置界面均未扩展。
- 本机 qwen-audio-agent 版本 1.11.0，8 项源码契约快照实际执行通过(不是跳过)。

## 自动化证据(笑南的电脑)

持久证据目录：`/Volumes/ExtSSD/software/Codex/backups/voice-main-integration-20261114/`(六份日志与 sha256.json)；临时工作日志在 `/tmp/deskfox-voice-integration-20261114/`；Bun 1.3.14。

| 检查 | 命令/证据 | 结果 |
|---|---|---|
| 原备份 | `git bundle verify /Volumes/ExtSSD/software/Codex/backups/deskfox-cleanup-20261114-122100/local-branches.bundle` | 完整历史、原语音 ref 正确 |
| 语音单测(含旧 wrapper 真握手、qwen 安装快照) | desktop 包内 `bun test ./src/main/deskfox/voice`；voice-explicit.log | 369 pass / 0 fail；8 项需显式启用的旧集成项另跑 |
| 真实 sidecar × 真实桥 × 本地测试模型 | desktop 包内 `VOICE_BRIDGE_ITEST=1 bun test ./src/main/deskfox/voice/bridge/bridge.integration.test.ts`；integration-model.log | 9 pass / 0 fail，32 断言；新增加模型跟随契约 |
| 完整开发闸 | 仓根 `sh .husky/pre-push`；gate-final.log | 通过：typecheck 29/29；app 1211 + browser 41、media 148、feishu 796、branding 82、desktop 545、session-ui 125；全部 0 fail。branding 8 项沿用既有平台/环境 skip；desktop 9 项可选集成已单独跑过，未遗漏 |

失败证据也保留：voice-initial.log / gate-initial.log 为原裸路径跑法失败；integration-initial.log 为无模型任务提前结束导致取消断言失败。修正原因见 2-plan，不以重跑、跳过或放宽断言掩盖。

## 后续真机验收(交李哲配合，Mac 执行由笑南的电脑负责)

本轮未构建/安装 local 包、未启动麦克风或真实付费模型；自动化通过不代表真机验收完成。后续用本分支明确提交构建独立 local 包，使用测试 Git 项目，不使用正式版数据库。

1. TC-M1：实际麦克风唤醒后口述生成一个文件；确认项目路径、会话列表、文件内容、最终播报一致。
2. TC-E2：派一个真实执行至少 6 分钟的任务；确认不断开、不因 300 秒超时丢结果。
3. TC-E3：两个任务尽量同时完成；确认两条结果都完整播报，区分用户开口打断与播报相互截断。
4. 项目/模型边界：切项目后立即派活与轮询稳定后派活分别检查目录；更换模型并实际发一条会话后再派活，确认干活模型跟随。新项目无历史的回落行为单独记录。
5. 生命周期：主动关闭语音按已有约定取消任务；异常结束语音进程时后端任务应继续。确认与正式版共存不串数据。

需要用户配合的是说话、听播报和体验确认；上述本机运行项全部仍待验收。未到合 main 或发布阶段。
