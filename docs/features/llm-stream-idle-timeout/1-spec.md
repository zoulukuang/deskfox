feat-id: llm-stream-idle-timeout
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# llm-stream-idle-timeout — spec

## 一句话

直连 provider 的 LLM 流式请求**没有任何默认超时**:SSE 流挂死(对端/中间盒静默丢连接)时请求永久悬挂,会话永久"思考中",留下 `tokens.output=0` 残骸消息。修法:给上游已有但默认关闭的 `chunkTimeout`(SSE 相邻 chunk 间隔超时)**补默认值 120s**,可配置、可显式 `false` 关闭。

## 现象(user 报告,2026-06-11)

1. 多个会话卡死"思考中",运行极慢;重启 DeskFox 前 sidecar 吊着 3 条到小米 `111.31.21.135:443` 的死 ESTABLISHED 连接。
2. 库里 13 条残骸 assistant 消息(4 个会话),全部 `tokens.output=0`,横跨 xiaomi/alibaba-cn/getbot 三家 provider。
3. my-life 会话实测时序:前 8 轮工具调用正常(每轮 5-8s),第 9 轮挂死——**中途挂**,不是一开始不响应。

## 根因(诊断已确认)

- `packages/opencode/src/provider/provider.ts` resolveSDK 的 fetch wrapper:
  - `chunkTimeout`(上游 commit `69ddc91c35` #16366 引入的 SSE chunk 间隔超时 + `wrapSSE`)**默认 undefined = 关闭**,无人配置 = 没有;
  - `options["timeout"]` 仅在显式配置时挂 `AbortSignal.timeout`;
  - `packages/opencode/src/config/provider.ts` schema 文档声称 timeout "Default is 300000 (5 minutes)",**但全代码库无任何地方应用该默认值** —— 文档与代码不一致。
- 结果:默认安装 = 死流无限挂。死连接物理上无法 100% 预防(NAT/LB/中间盒静默驱逐),正解 = 快速发现(idle 超时)+ 上层重试,不是无限等。
- 上游 2026-06-11 核实**未修**(upstream/dev `provider.ts` 该段一字未动),具备提上游 PR 价值。

## 设计决策

1. **只给 `chunkTimeout` 补默认(120s),不给总 `timeout` 补默认**:总超时 5min 会误杀健康的长回复(大模型一轮流式输出可超 5min);chunk 间隔超时语义正确——只要流在动就不杀,停 120s 才算死。
2. **默认值放 fork-only 新文件** `packages/opencode/src/provider/stream-timeout.ts`(P1 隔离),provider.ts 仅 ≤3 行接线(R1 三级跳第 2 级)。
3. **schema 扩展**:`chunkTimeout` 允许 `false` 显式关闭(对齐 `timeout` 的形态);修正 `timeout` 描述谎言("no default" 对齐现实)。
4. 超时触发后走现有错误路径:消息正常盖 `time.completed` + 报错,前端可见可重试 —— 不再永久转圈。

## 验收标准

- 默认(用户零配置)下,SSE 流停滞 120s 自动 abort,会话报错收尾,不永久"思考中"。
- 用户可 per-provider 配 `options.chunkTimeout: <ms>` 覆盖、`false` 关闭。
- 正常流式(chunk 间隔 < 120s)行为零变化。
- 全量 typecheck + opencode 包既有测试 0 regression。

## R8 测试用例清单(动工前列出)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| 1 | `effectiveChunkTimeout(undefined)` | unit | 返回默认 120000 |
| 2 | `effectiveChunkTimeout(false)` | unit | 返回 undefined(关闭) |
| 3 | `effectiveChunkTimeout(45000)` | unit | 返回 45000(用户值优先) |
| 4 | `effectiveChunkTimeout(0)` / 负数 / 非法类型 | unit | 返回 undefined(防御,沿用上游 `>0` 语义) |
| 5 | **bug-repro**:SSE 流发 1 个 chunk 后永久停滞,`wrapSSE` 以 50ms 超时包裹 | unit(真 ReadableStream) | 读到第 1 个 chunk;后续 read 在超时窗口内 reject `SSE read timed out`,AbortController 已 abort |
| 6 | wrapSSE 对非 SSE content-type 响应 | unit | 原样透传不包裹 |
| 7 | wrapSSE 正常流(chunk 间隔 < 超时) | unit | 全部 chunk 完整读出,无误杀 |
| 8 | 运行时·native 风险点:Bun `ReadableStream`/`AbortSignal.any` 行为与 Node 差异 | 既有测试回归 + typecheck | opencode 包测试全绿 |

运行时·native 风险说明(对照"CDP 自测 ≠ 真桌面 QA"):本改动纯 sidecar 后端逻辑,不碰 native dialog / Tauri 跨进程,Phase 2 真桌面 e2e 非必跑;以 unit + 包回归为闸,真机以一次 dev build 实际对话冒烟为辅。
