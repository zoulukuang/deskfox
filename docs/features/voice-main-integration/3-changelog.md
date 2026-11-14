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

## 回执(笑南的电脑，2026-11-14)

本轮接手已完成，转待真机验收。代码位置：`feat/voice-main-integration`，集成 merge `277d6a9e23`，测试修正 `696ad244e6`。自动化结果见上表；推送仅此集成分支，main 与原语音分支不动。

保留检查：main 仍为 `fc96b0b5b5`，原语音分支仍为 `334ce3382d`；原 bundle 未改，另存本轮测试证据。没有删除分支、修改上游远端、开发设置 UI、构建安装包或代签真机验收。

## local 测试包接手(2026-11-14)

接手中(笑南的电脑, Codex)。用户已授权准备独立 local 包与可自动检查的运行项，明确不影响正式版、不合 main。

构建在独立 worktree 完成；使用独立 HOME/XDG 的启动器与测试 Git 项目。开工读码发现 `index.ts` 对 local 也无条件注册 opencode 默认协议处理器，先增加 local 渠道保护和回归测试，以满足不影响正式版的约束。候选代码头、包哈希、进程与数据隔离证据完成后追加。

## local 包回执(笑南的电脑，2026-11-14)

本轮准备完成，转待用户真机体验；上面的“未构建”描述属于前一轮。源码候选 `b538afd409`，接手提交 `b959b585d2`；分支仍为 `feat/voice-main-integration`。启动步骤与待验清单见 [4-local-qa.md](./4-local-qa.md)。

- 产物目录：`/Volumes/ExtSSD/software/Codex/artifacts/voice-local-20261114/`。应用 `DeskFox 本地版.app`，arm64、`ai.deskfox.app.local`、2026.12.1，后端 1.18.16，Electron 42.11.15；未写入 /Applications，自动更新实测 disabled。
- 固定源码与依赖：`/Volumes/ExtSSD/software/Codex/worktrees/voice-local-20261114`，detached 于上述候选。此目录供语音桥使用，验收完成前保留；这是本机自用组合包，不是可单独搬走的分发包。
- app.asar SHA-256：`38ffabb0b33146f210c3673cb641f1c4ae0c500ea9f65eb49dbfd917d69663b4`。
- 证据：`/Volumes/ExtSSD/software/Codex/backups/voice-local-20261114/`，含红绿测试、完整开发闸、安装/构建/打包日志、实际包桥接脚本与结果、隔离记录、LOCAL 窗口截图及文件哈希清单。

| 检查 | 结果 |
|---|---|
| 默认协议修复红绿测试 | 原行为 2 fail / 3 pass；修复后 5 pass |
| 完整 pre-push 开发闸 | 29 项类型检查；app 1211 + browser 41、media 148、feishu 796、branding 82、desktop 550、session-ui 125，通过；既有可选 skip 说明同前 |
| 独立安装、构建、arm64 打包 | 三步 exit 0；worktree 无 tracked 改动 |
| 实际包后端 + 源码桥 | health、ACP initialize、A/B 两个项目建会话、语音 metadata、列表可见均通过；B 轮仍传旧 cwd A，验证桥读取当前项目后落 B；0 模型调用 |
| 语音依赖 / LOCAL UI | qwen probe ready；测试项目A 的开启语音按钮可用；未启动麦克风 |
| 运行数据隔离 | `runtime/data/opencode/opencode-local.db`；userData 位于 `runtime/home/Library/Application Support/ai.deskfox.app.local`；local 进程树无正式版数据文件打开记录 |
| 正式版保护 | PID 1786 持续存活，app.asar 哈希前后相同；opencode URL handler 仍 ai.deskfox.app |

没有复制正式版 auth；local 的 connectedProviders 为空，需用户在本地版连接 Alibaba (China)。目录中已备好唤醒模型；真实 ASR/TTS、模型权限与网络成功尚未验证。保持麦克风关闭，未代签 TC-M1 / TC-E2 / TC-E3。main `fc96b0b5b5`、原语音头 `334ce3382d`、原 bundle 均保留；没有修改上游远端、合 main 或扩展设置 UI。

回退：只关闭本地版即可停止本轮验证；源码补丁可在集成分支 revert `b538afd409`。不卸载/替换正式版。产物和源码 worktree 保留供复验。
