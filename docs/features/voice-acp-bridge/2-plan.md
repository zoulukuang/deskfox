feat-id: voice-acp-bridge
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

> 1-spec 已于 2026-08-24 经 user 审签锁版。本文记录实施顺序与**开发中推翻/修正的决策**。
> 凡与 1-spec 有出入的地方,以本文的「决策轨迹」为准并注明理由 —— spec 只补不改。

## 一、实施顺序(实际执行)

1. ✅ **契约核对**(动工前):对着本机 `qwen-audio-agent@1.11.0` 源码逐条核实 ACP 与 env 契约,
   以及本仓 sidecar 的 HTTP API 形状。产出直接写进 `bridge/contract.ts` 并配快照测试。
2. ✅ **桥骨架**:`bridge/protocol.ts`(NDJSON JSON-RPC)+ `initialize`
3. ✅ **sidecar 客户端**:`bridge/sidecar.ts`(建 session / prompt_async / abort / SSE / mcp.add / list)
4. ✅ **session 翻译**:`bridge/sessions.ts`(目录决策 + resume 透明换新)
5. ✅ **事件转发**:`bridge/updates.ts`(累积值→增量、role 过滤、status 词表翻译)
6. ✅ **轮次判别 + 契约快照**:`bridge/turn.ts` / `bridge/contract.ts`
7. ✅ **MCP 翻译与注册策略**:`bridge/mcp.ts`
8. ✅ **组装**:`bridge/bridge.ts` + 入口 `scripts/deskfox-voice-bridge.mjs`
9. ✅ **启动链路切换**:`launch-config.ts` 加 `buildAcpGatewayEnv` / `gateway.ts` 切 `--backend acp` /
   `ipc.ts` 与 `index.ts` 各注入几行
10. ✅ **测试**:单测 TC-U1–U8 + 集成 TC-E1/E4/E5/E7/E8

## 二、决策轨迹(开发中新增或修正)

### D1. `--backend-permission-mode full` 必须去掉(修正 spec §3.6 的措辞)

spec §3.6 已判断"用 native 模式",但实施时发现措辞不够强:**这不是"可以用 native",而是"带 full 会起不来"**。
qwen 有两道拦截:`cli/src/arguments.mjs:265-276` 见 `supportsFullPermission:false` 直接报错拒绝启动;
`backends/generic-acp.mjs:31-33` 再抛一次。所以 `buildAcpGatewayEnv` **不设** `QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE`,
`buildGatewayArgs("acp")` 也不带该参数。

影响:无。ACP 的权限请求是**桥主动发起**的,桥对语音派活场景根本不发,等价于全放行且没有确认打扰。

### D2. resume 必须幂等 —— 与「每次启动重建」看似矛盾,实则同一个机制

spec §3.2 说"`session/resume` 请求旧 ID 时透明换新"。实施时读 qwen 源码发现一个 spec 没写到的事实:
**qwen 不只在启动时 resume,而是每一轮 coordinator prompt 之前都会再 resume 一次**
(`acp-backend-adapter.mjs:1036-1046`,目的只是重新注入 MCP)。

若按字面实现"resume 就换新",一轮对话就会换一条 session,什么历史都留不住。

解法:按**桥进程的生命周期**记账。某个 ACP sessionId 第一次出现时建新 sidecar session 并记住映射,
之后同一 id 一律复用。桥是网关的子进程,网关重启桥就重启、映射自然清空 ——
"每次启动重建"因此是免费拿到的,而进程内的重复 resume 完全幂等。
连带好处:不用再去改 qwen 的状态文件(旧链路的 `invalidateCoordinatorOnStart` 在新链路上无对应物)。

另核实:`session/resume` 的 result 里**没有** `sessionId` 字段(SDK `zResumeSessionResponse`),
qwen 沿用它自己传入的 id —— 这正是"透明换新"能成立的结构原因。

### D3. coordinator 的判定用 **mcpServers 结构**,不用 prompt 文本

spec §3.3 的三分法判的是 prompt 内容,但 `session/new` 发生在任何 prompt 之前,那时没有文本可判。
实施改用结构性判据:qwen **只把 Session 工具注册给 coordinator**
(`acp-backend-adapter.mjs:1018-1026` vs 第三层的 `:808`/`:863`),
所以 `mcpServers` 里有没有 `qwen_audio_agent` 就是 coordinator 与第三层的分水岭。

三分法**保留**,但职责收窄为"这一轮要不要给派活上下文 + 日志留痕",递归防护的主力改由目录隔离承担。

### D4. MCP 注册作用域是 **directory**,这比 spec 预想的更要紧

spec §3.1 已知"MCP 状态按 directory 隔离"是递归防护的地基。实施时意识到它还有另一面:
注册进某个目录 = **该目录下所有 session 都会多出这些工具,包括用户自己手敲的那些**。
所以第三层任务目录(= 用户真实项目)一律不注册,连 qwen 的 builtin(`open-computer-use`)也不注册 ——
否则用户打开自己的项目会莫名多出一堆 qwen 工具。

集成测试 TC-E5 直接查 `GET /mcp?directory=` 验证:voice 目录有 `qwen_audio_agent`,项目目录没有。

### D5. 路由引导改走 `PromptPayload.system`(比旧方案更精确)

旧链路的路由引导走 `config.instructions`,是**全局**的 —— 第三层 session 读同一份,
所以不得不写一段「先判断你是谁…绝对不要再派一层」的自我否定条款。

新链路里桥可以只给 coordinator 的 prompt 带 `system`(sidecar `PromptPayload` 原生支持追加 system)。
于是 `coordinator-prompt.ts` 里那段自我否定条款**整段删掉**:第三层结构上就拿不到派活工具,
不需要靠 prompt 说服模型别做做不到的事。少一段自相矛盾的指令,少一个模型读错的机会。

### D6. 「当前项目」靠状态文件跨进程共享,零新增 IPC

spec §3.5 要求第三层 cwd 以 DeskFox 当前项目为准。桥是独立进程读不到 Electron 状态,
需要一个共享通道。实施发现**不需要新增 IPC**:renderer 本来就每 5 秒调一次 `voice_status`
并把当前目录传进来(`voice-dispatch-button.tsx`),主进程在那个 handler 里顺手写文件即可。
切项目最多 5 秒后生效。读不到/过期(>24h)一律回落 qwen 给的 cwd。

### D7. 空轮次要补一句兜底文本

qwen 要求每轮 prompt 至少产出一条非空 `agent_message_chunk`,否则判 502「未返回任何内容」,
**丢弃 coordinator session 并整轮重跑**(`acp-backend-adapter.mjs:1051-1061`、`:1192-1200`)。
"只调了工具没说话"的轮次真实存在,那时补一句 `(本轮没有产生文本输出)` ——
用多播一句的代价换掉一次无谓的重跑(重跑意味着任务被完整执行两遍)。

### D8. sidecar 报错要「说出来」而不是回 JSON-RPC error

回 error 的话 qwen 只在日志里留一行,用户对着麦克风等到的是一片安静。
改成把失败原因发成 `agent_message_chunk` 再 `end_turn`,失败会走 announcement 播报出来。

### D9. 事件流断开时必须把在途 prompt 收干净

qwen 侧**所有超时都是空转的**:它传给 SDK 的是 `signal`,而 SDK 只认 `cancellationSignal`
(`jsonrpc.d.ts:84-92`),于是客户端从不发 `$/cancel_request`、也没有任何硬超时。
请求 Promise 只在"桥回响应"或"桥进程死了"时 settle ——
**悬而不答 = 那条 session 永久锁死**(它对同一 sessionId 只允许一个在途 prompt)。
所以断流、dispose、cancel 三条路径都必须 settle。

## 三、踩坑记录

### P1. 集成测试装置:server 用 `stdio: "pipe"` 却不读 → 服务卡死

第一版集成测试给测试 sidecar 开了 pipe 但从不消费,64KB 管道缓冲写满后
**server 进程在写日志时阻塞**。表现极具误导性:前几个用例通过,到真跑模型(日志量大)那个用例
就永远等不到 `session.idle`,看起来像"桥收不到事件",实际是 server 根本不在跑了。
改 `stdio: ["ignore","ignore","ignore"]` 后 8/8 全绿、7 秒跑完。
产品代码无此问题(`gateway.ts` spawn 的 qwenaudio 是 pipe 且真的在 `.on("data")` 消费)。

### P2. sidecar 把 directory 规范成 realpath

macOS 上 `/var` 是 `/private/var` 的软链,`POST /session` 返回的 `directory` 是规范化后的。
断言要比 realpath 而不是原样字符串。查询与事件订阅两侧都做了同样规范化,所以功能不受影响
(集成测试「prompt 一定会收到终局」那条正是对此的实证)。

## 四、验证结果

| 层级 | 结果 |
|---|---|
| 单测(TC-U1–U8 + 新增边界) | `bun test src/main/deskfox/voice/` **311 pass / 0 fail** |
| desktop 包全量 | **581 pass / 8 skip / 1 fail** — 唯一失败是 `draft-store.test.ts`「No such built-in module: node:sqlite」,**stash 掉本次改动后照样红**,属本机 bun 版本的既有环境问题 |
| 集成(TC-E1/E4/E5/E7/E8 + resume 幂等 + 事件流终局) | `VOICE_BRIDGE_ITEST=1 bun test bridge.integration` **8 pass / 0 fail** |
| typecheck | `bun turbo typecheck --filter='!./packages/console/*'` **29/29 successful** |
| 桥进程真机握手 | `initialize` 回 `protocolVersion:1`;stdout **只有 1 行**协议帧(无污染) |
| qwen 侧探测 | `qwenaudio setup --backend acp --json` → `ready: true`,`source: configured` |
| 契约快照 | 对着本机 `qwen-audio-agent@1.11.0` 安装目录校验通过(env 白名单 / 工具名 / 信封 / `timeoutMs:0` / `supportsFullPermission:false`) |

**未自动化**(1-spec §7 已划归真机 QA):TC-E2 长任务 ≥6 分钟、TC-E3 并发播报、TC-E6 崩溃恢复 ——
这三条依赖真模型与真语音端,已在 2026-08-24 的 voice-lab 实测过(1-spec §4 的 E6/E7),
生产复验随 TC-M1–M3 一起做。
