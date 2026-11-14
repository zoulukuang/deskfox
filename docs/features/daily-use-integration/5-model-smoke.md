# REQ-162 真模型最小抽查

- 日期：2026-11-14。
- 执行身份：笑南的电脑；本机名称「岳笑南的Mac mini」，macOS arm64，Bun 1.3.14。
- 产品基准：`a4d3ec5691`；执行时集成分支 HEAD 为 `caafc2ece3`，与产品基准仅差 MCP 推送回执文档。
- 范围：已有模型通道的少量实际请求；不安装插件、不新增服务，不发送真实项目文件。三个通道各执行一笔任务，失败不重试；DeepSeek 的一笔任务含读取、写入及最终回答三个模型轮次。

## 隔离与运行方法

临时脚本 `/tmp/deskfox-real-model-smoke.ts` 启动集成代码的真实 CLI。每个通道分别建立 `deskfox-model-smoke-*` 临时根，其下包含独立 project、home、managed、XDG 配置/缓存/数据/状态目录和 `smoke.db`。真实配置和鉴权来源只读，不复制或打开用户会话数据库；仅将选定通道配置与鉴权副本传入子进程内存，不在本文或命令行展开凭据。

子进程关闭项目配置发现、外部插件发现、自动更新、自动压缩和模型目录联网获取；MCP 列表为空，沿用本机既有模型目录。工具权限默认拒绝，仅允许当前临时项目的 read/edit，拒绝 external_directory。OAuth 测试仅使用未过期 access 的副本，并将副本中的 refresh 替换为不可用占位值，防止自动刷新影响用户原有登录。

每笔任务先创建唯一的合成输入 `project/seed.txt`：

```text
Synthetic fixture only: the sample count is 7.
```

核心运行形式如下；环境变量由隔离脚本准备，命令不含凭据：

```sh
bun run --conditions=browser <integration>/packages/opencode/src/index.ts run \
  --format json --model <existing-provider/model> --agent smoke \
  'Read seed.txt and create generated report.md containing one short sentence stating the sample count. Then report completion and refer to both the source and result files.'
```

工作目录为该笔任务的临时 project。`smoke` 为仅用于本次测试的 primary agent，最多 4 步，要求只操作合成项目。用户提示没有直接要求 Markdown 链接，由本次实现注入文件交付约定。每笔进程设置 120 秒终止上限，标准输出与错误先脱敏再留存。临时脚本及证据均未提交到产品代码。

## 各通道结果

| 既有通道类型 | 模型 | 唯一一次运行结果 | 验收结论 |
| --- | --- | --- | --- |
| GetBot，OpenAI-compatible API | `getbot/qwen3.5-flash` | 请求到达已有服务，HTTP 401，`invalid_api_key`；CLI 退出 1，仅 seed 存在 | 未通过；保留原始失败，未改凭据或重试 |
| OpenAI OAuth | `openai/gpt-5.1-codex-mini` | CLI 退出 1，`UnknownError` / `Unexpected server error`，无模型正文，仅 seed 存在 | 未通过；现有证据不足以判断具体根因，不归因为本次链接改动，也不算 OAuth 验收通过 |
| DeepSeek API | `deepseek/deepseek-chat` | CLI 退出 0；真实 read 读取 seed，真实 write 创建报告，最终回答包含两个 Markdown 文件链接 | 本次 API 最小样本通过 |

脱敏证据：

- `/tmp/deskfox-model-smoke-getbot-result.json`
- `/tmp/deskfox-model-smoke-openai-result.json`
- `/tmp/deskfox-model-smoke-deepseek-result.json`
- `/tmp/deskfox-model-smoke-links-verified.json`

## DeepSeek 真实输出与目标内容

本次合成项目：`/private/var/folders/j2/2dsyzs610rqgn6qr0xxz02l00000gq/T/deskfox-model-smoke-KggTZC/project`。

最终模型回答原文：

> Done. I read the sample count from [seed.txt](/private/var/folders/j2/2dsyzs610rqgn6qr0xxz02l00000gq/T/deskfox-model-smoke-KggTZC/project/seed.txt) and created [generated report.md](/private/var/folders/j2/2dsyzs610rqgn6qr0xxz02l00000gq/T/deskfox-model-smoke-KggTZC/project/generated%20report.md) containing the single sentence: "The sample count is 7."

验证脚本从真实回答提取两个 Markdown href，各解码一次，然后直接调用集成代码 `packages/desktop/src/main/deskfox/document-preview.ts` 的 `readDocumentPreview`：

| 链接文字 | 路径结果 | 读取器结果 | 文件内容 |
| --- | --- | --- | --- |
| `seed.txt` | 绝对路径指向临时项目的 `seed.txt` | `ok: true`，`kind: text` | `Synthetic fixture only: the sample count is 7.`，末尾换行 |
| `generated report.md` | href 中空格为 `%20`，一次解码后指向实际含空格文件名 | `ok: true`，`kind: markdown` | `The sample count is 7.`，末尾换行 |

两个路径均由读取器返回 canonical 路径，目标真实存在且内容正确。本项是**真实模型 → 文件链接 → 原生读取器**验证；没有通过 Electron IPC transport，也没有在真实桌面 GUI 点击这两个模型产物，不能替代对应桌面验收。

## 未覆盖与后续边界

- OpenAI OAuth 和 GetBot 本次失败尚未完成通道侧诊断，不能声明所有已启用通道通过。
- 未发现可用于本次最小抽查的工作流 provider，未进行工作流真模型验收；真实 prepare 的工作流单元验证是另一层证据。
- 已过期的 Anthropic OAuth 未调用；其他已配置 API 通道和模型未遍历。
- 本次仅覆盖一个合成源文件和一个含空格的 Markdown 产物；未覆盖中文/百分号文件名、同名歧义、网页及代码示例不应被误写等完整模型矩阵。
- 真实 Electron GUI、Windows，以及历史成品验收不在本记录的通过范围内。
- 所有生成文件和会话均位于独立临时根；真实凭据、真实配置及用户会话数据库未改动。本记录不含凭据值、请求鉴权头或真实鉴权文件位置。
