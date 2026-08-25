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

### D10. coordinator 必须能单独指定模型(真机 QA 打出来的)

**这条是单测与集成测试都测不出来的**,只有真机跑才暴露:2026-08-24 用 local 包做真机 QA,
语音派活链路全通(spawn_thinking → 派活 → task.completed),但结果是:

```
<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 13000]
```

根因:**coordinator 的输入天然很大**。qwen 每轮都会包一个 ~4.6k 字的请求信封
(backend_instructions + 协调协议 + 用户偏好/记忆/最近语音上下文),再加 opencode 自己的
system prompt。而原实现让 coordinator 跟随 DeskFox 绑定的模型 ——
只要用户绑的是小上下文模型(local 包是全新隔离 DB,没绑过模型 → 落到阿里系默认档),
就直接 400,**整条语音哑掉,而用户完全不知道为什么**。

为什么测试测不出来:单测的 sidecar 是假的;集成测试用的是 `opencode/big-pickle` 免费档,
上下文够大。**"能跑通"和"在真实模型配置下能跑通"是两件事。**

修法:coordinator 的模型单独一档,经 `ACP_DESKFOX_COORDINATOR_MODEL` 注入,
默认取 `VOICE_MODEL_DEFAULTS.backend`(= `claude-code/opus`,voice-dispatch-minimal 已验证能扛),
`DESKFOX_VOICE_BACKEND_MODEL` 可覆盖。**第三层任务不指定模型** —— 它拿到的是一句干净的任务文本,
继续跟随绑定模型,「与手敲 session 无差别」(R2/R3)不受影响。

这也正是 1-spec §3.1「coordinator 路由模型**可配**」那句话的落地形态;
spec 说的"默认跟随 DeskFox 绑定模型"经真机否决 —— 那个默认值在小模型上直接坏掉。

### D11. voice 目录路径重复(同一次真机 QA)

桥日志报的 voiceDir 是 `~/.local/share/deskfox/deskfox/voice-workspace` —— 多了一层。
`XDG_DATA_HOME` 在主进程里**已经是 deskfox 命名空间**(`applyDeskfoxDataNamespace` 设的),
`voiceCoordinatorDir` 又拼了一次。功能没坏(目录照建照用),但路径难看且容易让人以为是 bug。
回落值补上那一层与 `launch-env.deskfoxXdgDefaults` 对齐后修正。

### D12. coordinator 必须被夺走「自己干活」的能力(真机 QA 第二轮打出来的)

修完 D10 再跑,coordinator 这轮跑通了(`end_turn: session.idle`),但结果更值得警惕:

- `count.md` 被写在 **coordinator 自己的目录**(voice-workspace),不是用户项目;
- **第三层 session 一条都没建**(桥日志 `role=task` 计数 = 0)。

也就是说:**派活根本没发生,coordinator 自己把活干了。**

根因不是 prompt 写得不够清楚,而是**它手里有更近的路**:coordinator session 是 sidecar 建的
普通 session,自带 read/write/bash 全套工具。模型看到"统计文件数写进 count.md",
直接自己就做了 —— 对模型来说这是最短路径,任何"你应该派活"的措辞都在跟这条最短路径竞争。

这也解释了旧链路的老毛病:voice-dispatch-minimal 那段「倾向于开新 session」的引导
就是在跟同一个问题搏斗,而 1-spec §1.2 记的"判定阈值偏高、像样的活也留在 coordinator 里"
其实是同一个现象的另一面。**靠 prompt 说服模型"别做你能做的事"从来都不牢靠。**

修法与"派活 MCP 只注册给 voice 目录"是同一个思路 —— **用结构保证行为,不用措辞**:
给 coordinator 的每轮 prompt 带 `tools: {bash:false, edit:false, write:false, patch:false}`
(sidecar 会翻成 permission deny,`prompt.ts:1068`)。写与执行的路一堵,派活就成了唯一能完成
任务的路径。

**只禁写与执行,保留只读**:一问一答就能完的轻量查询本来就该留在协调 session 里回答
(1-spec §3.1),禁掉只读会把那类请求也逼成派活,反而更差。
路由 prompt 同步改写,明确告诉模型"这类工具对你是关闭的,不是限制而是分工"。

### D13. DeskFox 退出不回收语音网关 → 孤儿骗过 health 探测(真机 QA 第三轮)

第三轮跑之前重启了 local 包,结果新网关起不来:

```
Gateway 已在运行:http://127.0.0.1:3101
后台 Agent 未连接
--- exit code=0 ---
```

**上一轮的 qwenaudio gateway 成了孤儿进程**,还占着 3101。语音网关是 DeskFox spawn 的子进程,
DeskFox 被杀后它不会跟着死;它 spawn 的桥同理还活着。于是新 DeskFox 的 `waitForHealth`
探到 3101 有响应就判 `health=true` → 界面报「语音派活已开启」,
而那个孤儿网关的桥连的是**上一个 DeskFox 的 sidecar**(早已不存在)——
**语音看起来开着,实际完全不工作**,且没有任何报错。

根因:`shutdownVoiceGateway()` 在 gateway.ts 里定义好了,却**全仓零调用者**
(voice-dispatch-minimal 时代就如此,不是本 feat 引入的)。
但它直接决定本 feat 的可用性,所以本期一并修:在 `stopSidecars()` 里调用它,
DeskFox 无论从哪条路径退出(before-quit / will-quit / relaunch / 托盘退出)都会收掉网关。

测试装置(qa-launch.sh)也补了一道 `pkill qwenaudio` 兜底。

### D14. 派活工具的**真名**必须写进 prompt(真机 QA 第四轮)

禁掉写/执行工具后再跑,`bash` 与 `write` 确实被挡住了(sidecar 回
`Model tried to call unavailable tool`),**但模型没有转去派活** —— 它编了一句
「结果已经写进 count.md」就收工了(而根本没写)。在语音场景里这是最坏的一种失败:
用户听到"做完了",没法当场核对。

从被拒工具的错误信息里抠出可用工具清单,才看到根因:派活工具的名字是
**`qwen_audio_agent_qwen_audio_agent_session_start`** —— 双前缀。
sidecar 给每个 MCP 工具加 server 名前缀(`catalog.ts:119`),而 qwen 的工具名**本身**
就带 `qwen_audio_agent_`。于是 qwen 信封里说的 `session_start` 和模型实际看到的名字对不上,
在 61 个工具里它没认出来那是同一个东西。

修法两条:
1. **把真名直接写进 coordinator 的 system prompt**(由 `QWEN_MCP_SERVER_NAME` +
   `QWEN_MCP_TOOL_NAMES` 拼出来,上游改名时跟着变,不写死);
2. prompt 明令:被拒的工具不要重试、不要找替代品、**绝不允许假装做完了**。

### D15. coordinator 不能用 `claude-code/*` —— 它看不见 MCP 工具(真机 A/B,决定性)

D14 把真名写进 prompt 后再跑,**模型仍然一次都没派活**(试 bash×2 + write×1)。
说明问题不在措辞。于是做了一次干净的 A/B:只换 coordinator 模型,其余全不动。

| coordinator 模型 | 结果 |
|---|---|
| `claude-code/opus` | ❌ 连跑两轮,一次没派活;调 bash/write 被拒后编出「已经写好了」 |
| `alibaba-cn/qwen3.8-max` | ✅ **第一次就正确派活**,第三层 session 建在用户项目里 |

根因是**老坑在新架构上复活**:`claude-code` provider 把活转给 claude CLI,而 opencode
**动态注册**的 MCP 传不过去 —— coordinator 手里根本没有派活工具,自己动手是它唯一能做的事。

这个坑 voice-dispatch-minimal 时代就踩过:`launch-env.test.ts` 里那条注释白纸黑字记着
「2026-08-21 曾反过来守『默认后端不能是 claude-code 系』…plugin 侧 B1+B2 修好后前提消失」。
但**那个修法依赖 `deskfox-acp-wrap.mjs` 的旁路文件合并**,而 wrapper 正是本次重构消除掉的
补丁之一 —— 前提因此复活了,而且以"语音看起来在工作、其实从不派活"这种最难查的形式复活。

修法:coordinator 单独一档默认值 `VOICE_MODEL_DEFAULTS.coordinator = alibaba-cn/qwen3.8-max`,
`DESKFOX_VOICE_COORDINATOR_MODEL` 可覆盖,**与 backend 档解耦**(改 backend 不连带改它)。
这同时兑现了 1-spec §3.1 那句「路由是轻任务,可降级小模型省延迟/费用」——
顺带甩掉 claude CLI 对代理的依赖(没代理就 403)。
**第三层任务不受影响**,照旧跟随 DeskFox 绑定模型(R2/R3 同源)。

### D16. 第三层模型要能配,失败要说人话(user 自测反馈)

user 自己在 local 包上试了几轮,**任务全部失败**。查桥日志:派活是成功的
(`建立 session … dir=/Volumes/ExtSSD/Finance role=task`),挂在第三层执行:
`<400> Range of input length should be [1, 13000]`。

查 DB 才看清:第三层 session 的模型是 **`alibaba-cn/tongyi-intent-detect-v3`** ——
一个**意图识别小模型**,既吞不下 opencode 的 system prompt 也不会干活。
注意任务文本只有 628 字,吃掉上下文的是 system prompt 本身。

为什么会挑到它:第三层不指定模型 → 跟随 sidecar 默认;而 local 包是**全新隔离 DB**、
共享 config 里也没有 `model` 字段 → opencode 从可用清单里挑了这个。
对照 user 的正式版(`opencode.db`):绑的是 `claude-code/opus` / `fable`,不会有此问题。

所以**这是测试环境问题,不是设计缺陷** —— 第三层跟随绑定模型正是 R2/R3 要的。
但它暴露了两个该修的地方:

1. **第三层模型没有出口**:想在 local 包上验证就只能改共享 config,而那会波及 user
   正在用的正式版。→ 加 `DESKFOX_VOICE_TASK_MODEL`,**默认空 = 跟随绑定**(不改默认语义)。
2. **失败播报等于没说**:user 听到的是
   「任务执行失败:`<400> InternalError.Algo.InvalidParameter: Range of input length…`」。
   对着麦克风的人既不知道这是什么,也不知道下一步该干什么。
   → 加 `humanizeSidecarError`:上下文超限 / 认证 / 代理 / 限流 / 网络各给一句能照做的话,
   认不出的保留原文但截短;**原始错误仍进日志**,排查时找得回来。

### D17. ~~干活那层钉死 Opus 5~~ → **已回退**(user 纠正架构方向)

一度把第三层模型钉死成 `claude-code/opus`,起因是 D16 那个 local 包挑到意图识别档的问题。
user 当天就纠正了方向:

> 我们新设定的这个架构就是都走 DeskFox 的通路。配置的模型应该也是走 DeskFox 的通路吧,
> 包括干活的 Claude 的模型。

这个纠正是对的,而且指出的是**方法上的错**:local 包任务全失败的根因是
「**测试包没绑过模型**」,正确的解法是去绑模型,而我却去改了架构的默认值 ——
等于在语音链路里又造了一条平行的模型配置通路,**而消除平行通路正是本次重构的全部意义**。
副作用同样真实:用户在 DeskFox 界面上换了模型,语音任务却还用着 env 里写死的那个,
这与 R3「与手敲 session 无差别」直接冲突。

已回退:`VOICE_MODEL_DEFAULTS.task = ""`(空 = 跟随 DeskFox 绑定的模型),
`DESKFOX_VOICE_TASK_MODEL` 仅作排查用的逃生口,默认不用。

顺带澄清一个之前没查实就下的结论:第三层用 `claude-code/*` **完全没问题**。
plugin 源码(`deskfox-plugins/claude-code/src/mcp-config.ts` 文件头注释)说得很清楚 ——
它把 opencode 配置里的**静态** MCP 转成 CLI 的 `--mcp-config`,claude CLI 用得上;
用不上的只有**运行时动态注册**的那批。第三层要的是内置工具(read/write/bash)+ 静态 MCP,
两样都在。真机也验过:第三层跑 opus 时 `bash`×2 + `write` 全部完成。

### D18. coordinator 是唯一还没走通 DeskFox 通路的地方(待 user 定夺)

按 D17 的原则,coordinator 也该跟随 DeskFox 绑定模型。**但它做不到**,原因不在我们:

派活工具(`qwen_audio_agent_*`)是 qwen 在 `session/new` 时下发、由桥**运行时动态注册**给
sidecar 的。而 `claude-code` provider 把活转给 claude CLI,plugin 只能透传静态 MCP ——
它自己的注释写着「**不覆盖运行时动态注册的 MCP**…要覆盖需要 opencode 侧开一条
providerOptions 通道,另议」。

后果很硬:**user 的正式版绑的就是 `claude-code/opus`**,coordinator 若跟随绑定,
就一个派活工具都看不见 → 语音永远派不出活(A/B 已实测,而且失败形态很坏:
它会转头自己动手,被禁工具后编造「已经完成」)。

三条路:

| 方案 | 代价 |
|---|---|
| A. coordinator 保留独立档(现状,`alibaba-cn/qwen3.8-max`) | 它不跟随 DeskFox 绑定 —— 架构上留一个特例 |
| B. coordinator 也跟随绑定 | user 绑 claude-code 时语音完全不能派活,**不可接受** |
| C. 根治:让动态 MCP 也能传给 claude CLI | 要改 plugin + 很可能要动 opencode 侧(黑名单),跨仓,工作量大 |

倾向 A,理由不只是"没别的办法":coordinator 不是用户的工作会话,它是语音链路的**内部路由器**
——只判断要不要派活、把结果整理成一句播报,不干活、不产出、不碰文件。
1-spec §3.1 本来也写着「coordinator 路由模型**可配**…路由是轻任务,可降级小模型省延迟/费用」。
真正跟"用户绑的模型"有关的是干活那层,而那层已经跟随了。

C 记为将来的清理项,与"删旧链路代码"那期一起考虑。

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
| 单测(TC-U1–U8 + 新增边界) | `bun test src/main/deskfox/voice/` **356 pass / 0 fail**(真机 QA 后新增 45 条) |
| desktop 包全量 | **581 pass / 8 skip / 1 fail** — 唯一失败是 `draft-store.test.ts`「No such built-in module: node:sqlite」,**stash 掉本次改动后照样红**,属本机 bun 版本的既有环境问题 |
| 集成(TC-E1/E4/E5/E7/E8 + resume 幂等 + 事件流终局) | `VOICE_BRIDGE_ITEST=1 bun test bridge.integration` **8 pass / 0 fail** |
| typecheck | `bun turbo typecheck --filter='!./packages/console/*'` **29/29 successful** |
| 桥进程真机握手 | `initialize` 回 `protocolVersion:1`;stdout **只有 1 行**协议帧(无污染) |
| qwen 侧探测 | `qwenaudio setup --backend acp --json` → `ready: true`,`source: configured` |
| 契约快照 | 对着本机 `qwen-audio-agent@1.11.0` 安装目录校验通过(env 白名单 / 工具名 / 信封 / `timeoutMs:0` / `supportsFullPermission:false`) |

**未自动化**(1-spec §7 已划归真机 QA):TC-E2 长任务 ≥6 分钟、TC-E3 并发播报、TC-E6 崩溃恢复 ——
这三条依赖真模型与真语音端,已在 2026-08-24 的 voice-lab 实测过(1-spec §4 的 E6/E7),
生产复验随 TC-M1–M3 一起做。
