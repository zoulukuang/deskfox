# 模型通道补验与文件链接缩写修复

当前身份：笑南的电脑。日期：2026-11-14。产品基准 `f517fc04b4`；本轮随后仅修改两个 fork 自建文件：`packages/opencode/src/session/llm/file-delivery.ts` 及对应 `test/session/file-delivery.test.ts`。未修改 `request.ts`、认证或 provider 实现，产品提交由父会话统一执行。

## 验收结论

| 已有通道 | 结果与范围 |
| --- | --- |
| DeepSeek API：`deepseek/deepseek-chat` | **通过本轮样本**。真实读取中文/空格/百分号源文件并生成报告；四个文件链接均为完整编码绝对路径，内容核对成功，源文件及报告链接实际点击打开 |
| OpenAI OAuth：`openai/gpt-5.6-luna` | **通过修后样本**。先纠正模型选择和测试代理配置，再发现真实输出使用 `.../` 的缺陷；加强文件交付约定后同任务首轮复测通过，四个文件链接和两次点击均成功 |
| GetBot：`getbot/qwen3.5-flash`（前轮）、`getbot/kimi-k2.6`（本轮） | **模型调用鉴权阻断**。现有凭据可以读取受认证保护的模型目录，但两种模型的实际调用均 401；进一步剥离 SDK 的最小请求同样 401 `invalid_api_key`。需要通道维护方核验模型调用授权或上游配置，未绕过错误、未改凭据 |
| Kimi Coding：`kimi-for-coding/kimi-for-coding` | **认证阻断**。按已有目录声明的 Anthropic 协议调用 Coding messages 端点，明确返回 401 `invalid_authentication_error`，提示 key 无效或过期；需要用户更新有效凭据后才能完成生成/链接验收 |
| Anthropic OAuth | **当前不可用，未调用**。已有条目过期；当前内建及已配置插件未发现匹配的 Anthropic OAuth 刷新接入。不把它当 API key 调用，也不自行安装认证插件 |
| Alibaba 中国区 | **未具备可用鉴权**。仅有模型目录配置，无匹配鉴权条目或所需环境凭据，未冒充已启用可调用通道 |
| GitLab 工作流 | **未配置**。无对应 provider/鉴权；仅有现存真实 prepare 层的分支测试，不计作工作流真模型通过 |

以上是可用通道的有限样本和明确阻断记录，不表示所有模型、所有格式或随机稳定性均已验完。

## 对 5 号报告的诊断更正

[5-model-smoke.md](./5-model-smoke.md) 保留当时结果；本节补充原因，不删除失败证据。

1. **OpenAI 原 UnknownError 不能归为登录失败。** 前轮选择的 `gpt-5.1-codex-mini` 不在当时沿用的本机模型目录，也不在当前内建 Codex OAuth 允许集合。本轮先选择目录与 allowlist 均有的 `gpt-5.4-mini`，诊断日志显示 WebSocket 连接超时：原隔离脚本只保留 PATH，遗漏了本机现有代理变量，而 WebSocket 实现明确依赖显式代理。补上继承现有代理后，请求到达服务端，却被账户端明确拒绝：该模型不支持此 ChatGPT account。最后使用现有 OAuth 只读查询账户模型范围，选择“实际账户列表 ∩ 本机目录 ∩ 代码允许集合”中的 `gpt-5.6-luna`，认证与生成流程成功。没有修改产品认证代码或新增模型服务。
2. **GetBot 不能笼统归因为本机 key 完全失效。** 使用相同现有配置，带认证的目录查询返回 200，无认证返回 401；所测模型在目录内，且无模型级 headers/options 覆盖。模型 CLI 和剥离 SDK 的最小 chat 请求均返回 401，说明阻断位于网关模型调用路径，不能据此断言具体是哪一层上游凭据或权限错误。保留失败，停止继续尝试，交通道维护方处理。
3. Kimi Coding 返回的错误明确指向该既有 key 无效或过期；本次没有循环重试求绿。

纠正代理前的 OpenAI 任务曾触发运行时自动连接重试，最终由测试终止；它不是通过样本。所有诊断尝试均留证，不把后续成功覆盖为“首次通道测试全部通过”。

## 真实缩写失败与窄修

在正确认证、网络和可用模型条件下，`openai/gpt-5.6-luna` 原始任务退出 0，真实生成了文件，但四个 href 均被缩写，例如：

```text
[source](.../seed%20%E4%B8%AD%E6%96%87%20%25.txt)
[result](.../generated%20%E4%B8%AD%E6%96%87%20%25.md)
```

这些 href 不是真实绝对路径，不能通过补全猜测修成“有效”。原失败证据 `/tmp/deskfox-model-channels-openai-supported.json` 保留。

仅加强 fork-only `FILE_DELIVERY` 约定：每个目标必须使用对应文件已知的完整绝对路径；禁止目录省略、ellipsis、占位符、环境变量或猜测前缀；允许缩短可见文字，不允许缩短 href；回答前逐文件核对，未知或歧义时说明。保留显式输出格式、网页和代码示例的原约定，未改变 small/compaction/json_schema 排除条件。

新增 unit 只验证消息中的原始路径证据、网站、代码示例和同名说明不被包装器改写，以及包装幂等；它**不是**模型能否遵守新规则的复现证据。缩写缺陷的证据是上述真实模型失败，以及修后同任务真实输出与文件/点击验证。

## 隔离方法与任务

沿用 `/tmp/deskfox-real-model-smoke.ts`，每次创建独立临时 project、home、managed、XDG 目录和数据库。仅选取本机已有通道的配置及鉴权副本；副本存放在独立根内，权限 0600，允许正常已有协议刷新时只落副本，绝不写回真实源。禁外部插件发现、MCP、项目配置发现、自动更新和模型目录联网获取；工具默认拒绝，仅允许临时项目 read/edit，禁止 external_directory。继承已有代理变量以匹配桌面网络条件，不更改系统代理。未发送真实项目文件。

脚本命令不包含凭据：

```sh
bun /tmp/deskfox-real-model-smoke.ts openai
bun /tmp/deskfox-real-model-smoke.ts deepseek
```

任务使用合成文件 `seed 中文 %.txt`（内容为 `Synthetic fixture only: the sample count is 7.`）、两个不同的 `a/same.md` / `b/same.md`，要求生成 `generated 中文 %.md` 并报告源文件和结果，同时保留 `https://example.com` 网站及 `example.txt` 代码示例，不猜测同名文件。用户任务没有直接要求 Markdown 链接，由产品约定注入。

缩写失败及两次修后复测使用同一任务、同一 6 步上限；实际原 OpenAI 失败回答为 4 步，修后 OpenAI 和 DeepSeek 各 5 步。先前扩展 DeepSeek 的 4 步上限试跑触发了步数总结，仅作过程证据，不混同本轮最终通过样本。

## 文件和点击验证

修后 OpenAI 原文的报告链接：

[generated 中文 %.md](/private/var/folders/j2/2dsyzs610rqgn6qr0xxz02l00000gq/T/deskfox-model-smoke-Pl07F8/project/generated%20%E4%B8%AD%E6%96%87%20%25.md)

修后 DeepSeek 原文的报告链接：

[generated 中文 %.md](/private/var/folders/j2/2dsyzs610rqgn6qr0xxz02l00000gq/T/deskfox-model-smoke-ZZzAke/project/generated%20%E4%B8%AD%E6%96%87%20%25.md)

每组四个文件 href 从模型原文提取，逐个解码一次并确认位于本次实际临时项目，再调用真实 `readDocumentPreview`。两个报告内容均为 `The sample count is 7.`，源文件与 a/b 文件也均匹配合成内容；所有路径存在、无省略目录。两组回答都明确同名歧义需要澄清；网站保持网站，`example.txt` 保持代码、无文件链接且未创建。

另以 `/tmp/deskfox-model-links-browser.ts` 启动仅 loopback 的临时 Vite 和真实 Chromium，复用既有 document-preview fixture 渲染原始回答，分别点击每组源文件及结果链接，四次实际点击均显示正确内容。截图已人工查看，临时浏览器与 Vite 已退出。此层为**真实浏览器 + fixture 注入的真实原生读取器**，不是 Electron IPC transport，也不是原生桌面新一轮验收。

## 验证和证据

- helper 与真实 prepare：10 pass / 0 fail，35 断言，`/tmp/model-channels-file-delivery-tests.log`。
- opencode 包级 `bun typecheck` 退出 0，`/tmp/model-channels-opencode-typecheck.log`。
- 原失败及诊断：`/tmp/deskfox-model-channels-openai-supported.json`、`openai.json`、`openai-proxy.json`、`getbot.json`、`kimi.json`（后三组同属 `/tmp/deskfox-model-channels-` 前缀）。
- 修后原始脱敏结果：`/tmp/deskfox-model-channels-openai-fixed.json`、`/tmp/deskfox-model-channels-deepseek-fixed.json`。
- 全部 href/内容/点击记录：`/tmp/deskfox-model-channels-verified.json`、`/tmp/deskfox-model-channels-browser.log`。
- 截图：`/tmp/deskfox-model-channels-openai-clicked.png`、`/tmp/deskfox-model-channels-deepseek-clicked.png`。
- 独立 `file_links` agent 已只读复核两处 diff 和上述失败→通过证据，未发现阻断；确认两文件均为 fork 自建，不触发 R4。父会话完整 pre-push 已退出 0，日志 `/tmp/daily-followup-gate.log`；父会话统一提交推送，提交结果由主交接记录回填。

未扩展测试任意用户格式、模型随机稳定性、其他模型或未配置通道。GetBot/Kimi 需凭据或服务端授权处理后再补通；不将其认证阻断隐藏为产品验收成功。
