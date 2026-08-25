feat-id: voice-acp-bridge
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志

## 第 1 笔:桥本体 + 启动链路切换(2026-08-24)

**规模**:Large。新增 3669 行(fork-only 新文件),改上游 31 行 —— 新增:改上游 ≈ **118:1**
(R1 健康基线要求 ≥3:1)。**0 笔 R4 override**(`packages/desktop/` 不在黑名单)。

### 改了什么

一句话:**把 qwen-audio-agent 从「自带一套 opencode 后端的独立系统」降级为「纯语音前端」**,
DeskFox 提供一个 ACP 桥充当它的后台 Agent,于是语音派出的每条 session 都是
**DeskFox 自己的 sidecar 亲自创建的**,与手敲的完全同源。

#### 新增(全部 fork-only)

| 文件 | 行数 | 职责 |
|---|---|---|
| `packages/desktop/scripts/deskfox-voice-bridge.mjs` | 86 | 桥进程入口(`ACP_COMMAND` 指向它);只做 wiring |
| `src/main/deskfox/voice/bridge/bridge.ts` | 323 | 六个 ACP 方法 ⇄ sidecar 的组装层 |
| `src/main/deskfox/voice/bridge/protocol.ts` | 199 | NDJSON JSON-RPC 收发与分发 |
| `src/main/deskfox/voice/bridge/sidecar.ts` | 193 | sidecar HTTP 客户端(建 session / prompt_async / abort / SSE / mcp.add / list) |
| `src/main/deskfox/voice/bridge/updates.ts` | 179 | 事件流 → `session/update`(累积值转增量、role 过滤、status 词表) |
| `src/main/deskfox/voice/bridge/sessions.ts` | 135 | ACP ↔ sidecar session 映射、目录决策、resume 透明换新 |
| `src/main/deskfox/voice/bridge/mcp.ts` | 148 | MCP 描述符翻译 + 注册策略(只给 coordinator 目录) |
| `src/main/deskfox/voice/bridge/contract.ts` | 136 | qwen 侧契约常量 + 自检 |
| `src/main/deskfox/voice/bridge/turn.ts` | 95 | 三分法轮次判别 |
| `src/main/deskfox/voice/bridge/coordinator-prompt.ts` | 51 | coordinator 路由引导(走 `system`,只发给它) |
| `src/main/deskfox/voice/bridge/env.ts` | 59 | `ACP_DESKFOX_*` 启动配置契约 |
| `src/main/deskfox/voice/active-project.ts` | 73 | 「DeskFox 当前打开的项目」跨进程共享 |
| `src/main/deskfox/voice/sidecar-info.ts` | 28 | sidecar 连接信息的进程内共享点 |
| 9 个 `*.test.ts`(含 1 个集成) | 1964 | 见下「回归测试」 |

#### 改上游(全部带 FORK marker)

| 文件 | 行数 | 改动 |
|---|---|---|
| `src/main/index.ts` | +7 | sidecar 就绪时 `publishSidecarInfo(...)`(v1/v2 两条分支各 1 处)+ import |
| `src/main/deskfox/ipc.ts` | +22/-9 | `voice_status`/`voice_start` 顺手记当前项目;probe/start 传 `bridgePath` |

#### 改 fork 自有文件

| 文件 | 改动 |
|---|---|
| `voice/launch-config.ts` | 新增 `buildAcpGatewayEnv` / `voiceCoordinatorDir` / `useAcpBridge` / `voiceBridgeLogPath`;旧的 `buildGatewayEnv` 原样保留 |
| `voice/gateway.ts` | `buildGatewayArgs(backend)` 参数化;`parseSetupJson(stdout, backendId)` 参数化;`startVoiceGateway` 按链路分流;新链路不起 journal/列表轮询 |
| `voice/paths.ts` | 新增 `resolveBridgePath` / `voiceBridgePath` |

### 为什么这么改

现方案(voice-dispatch-minimal)的病根是**两套 opencode 进程只共享 SQLite、不共享事件总线与 env**。
1-spec §1.1 列的六类补丁全部是这一个结构问题的表象。本笔改动让 session 回到唯一的 sidecar,
于是这些补丁在新链路上**均无对应物**:

| 现方案的补丁 | 新链路的状况 |
|---|---|
| `NAMESPACE_ENV_NAMES`/`NETWORK_ENV_NAMES` env carry | 桥不是 opencode,不需要那套命名空间;`ACP_DESKFOX_*` 五个变量即全部配置 |
| `deskfox-acp-wrap.mjs` stdout 净化 wrapper | 桥是我们自己的进程,从源头不往 stdout 写日志(已实测 stdout 只有协议帧) |
| `resolveVoiceDbEnv` 渠道分流 | 只有一个进程开库,没有"两套要落同一个文件"的问题 |
| `server-sync.tsx` 三道闸强刷 | session 由本 sidecar 创建,`session.created` 走同一条事件总线,界面自动更新 |
| voice-journal / coordinator-state 归档 | coordinator session 本身就是语音沟通记录;第三层就是真任务 session,没有"中转站" |
| 代理 403 | 第三层用 DeskFox 当前绑定的模型,与手敲会话同一条出网路径 |

### 关键设计

- **coordinator 落 `~/.local/share/deskfox/voice-workspace/` 独立目录**,派活 MCP 只注册到那里。
  MCP 状态按 directory 隔离 ⇒ 第三层(用户项目目录)**结构上拿不到** `session_start`,递归不可能。
  这同时挡掉一个副作用:注册进用户项目 = 用户手敲的会话也会多出 qwen 工具。
- **coordinator 判定用 `mcpServers` 结构**而非文本(`session/new` 时还没有文本可判)。
- **resume 幂等 + 透明换新**:按桥进程生命周期记账,同一 ACP id 复用,新 id 建新 session 绑旧 id。
  "每次网关启动重建 coordinator"因此免费成立(桥与网关同生共死)。
- **第三层 cwd 跟随 DeskFox 当前项目**(不用 qwen 给的启动期 `ACP_WORKSPACE`),
  经 renderer 已有的 5 秒轮询写状态文件传递,零新增 IPC。
- **不设 full 权限模式**:通用 acp backend `supportsFullPermission:false`,带了会被 CLI 硬拒不启动。
  桥不主动发 `session/request_permission` ⇒ 等价全放行且无确认打扰。

### 回归测试

| 层级 | 结果 |
|---|---|
| voice 单测 | **311 pass / 0 fail**(TC-U1–U8 全覆盖) |
| desktop 全量 | **581 pass / 8 skip / 1 fail** — 唯一失败 `draft-store.test.ts`(`node:sqlite` 缺失)**是既有环境问题**,stash 掉本次改动后照样红 |
| 集成 | `VOICE_BRIDGE_ITEST=1 bun test bridge.integration` **8 pass / 0 fail**(TC-E1/E4/E5/E7/E8 + resume 幂等 + 事件流终局) |
| typecheck | **29/29 successful** |
| 真机握手 | 桥 `initialize` 回 `protocolVersion:1`;stdout 只有协议帧;`qwenaudio setup --backend acp --json` → `ready:true` |

新增用例映射 1-spec §7:TC-U1 `protocol.test.ts` / TC-U2·U3 `sessions.test.ts` / TC-U4 `updates.test.ts` /
TC-U5 `turn.test.ts` / TC-U6 `contract.test.ts`(对着本机 qwen 安装做快照,漂移即红)/
TC-U7 `env.test.ts` / TC-U8 `mcp.test.ts`。

**待真机 QA**:TC-E2(长任务 ≥6 分钟)/ TC-E3(并发播报)/ TC-E6(崩溃恢复)/ TC-M1–M3 ——
依赖真麦克风与真模型,lab 已实测(1-spec §4 的 E6/E7),生产复验待 user 参与。

### 影响范围

- 语音链路整体切到新后端;**其余功能零影响**(飞书桥接 / media-gen / 会话列表 / 打包均未触及)。
- 用户可见变化:语音沟通记录现在是一条名为「语音沟通」的正常 session(落在独立项目里),
  任务 session 与手敲的在列表/详情/状态流转上无差别。

### 已知差异

1. **会话标题不再强制中文**:旧链路经 `OPENCODE_CONFIG_CONTENT` 覆盖 title agent prompt;
   新链路的 session 用 sidecar 自身配置(改它会波及用户手敲的会话,不能改)。
   实际影响小 —— 任务文本由中文语音转写而来,标题大概率仍是中文。
2. **qwen 侧 delegation 记录里的 directory 显示值**可能与实际不一致(1-spec §3.5 已登记):
   桥以 DeskFox 当前项目为准建 session,而 qwen 记的是它自己给的 cwd。仅影响 qwen 侧日志显示。
3. **切项目最多 5 秒后生效**(跟随靠 renderer 的 5 秒轮询)。

## 第 2 笔:真机 QA 修复 —— coordinator 模型 / 工具边界 / 目录路径(2026-08-24~25)

用 local 包做真机 QA(见下「真机验证」)时打出来的三个问题,**都是单测与集成测试测不出来的**。
其中第 ③ 条最要紧:它让「派活」这件事根本没有发生。

### 改了什么

| 文件 | 改动 |
|---|---|
| `bridge/contract.ts` | 新增 `ENV_COORDINATOR_MODEL`(`ACP_DESKFOX_COORDINATOR_MODEL`),纳入自检 |
| `bridge/env.ts` | 新增 `parseModelRef`;`BridgeConfig.coordinatorModel` |
| `bridge/sidecar.ts` | `promptAsync` 的第 4 参改成 `{system?, model?, tools?}` |
| `bridge/bridge.ts` | `BridgeDeps.coordinatorModel`;`COORDINATOR_DENIED_TOOLS`;只对 coordinator 传 model 与 tools |
| `bridge/coordinator-prompt.ts` | 新增「你是派活的人,不是干活的人」一节 |
| `voice/launch-env.ts` | 新增 `VOICE_MODEL_DEFAULTS.coordinator` 第 4 档 + `DESKFOX_VOICE_COORDINATOR_MODEL` |
| `voice/launch-config.ts` | 注入 `ACP_DESKFOX_COORDINATOR_MODEL`(取 coordinator 档);修 `voiceCoordinatorDir` 路径重复 |
| `scripts/deskfox-voice-bridge.mjs` | 传 coordinatorModel,启动日志打出来 |
| `main/index.ts` | `stopSidecars()` 里调 `shutdownVoiceGateway()`(+2 行,带 FORK marker) |
| `voice/launch-config-acp.test.ts`(新) | 16 条用例 |
| `bridge/coordinator-prompt.test.ts`(新) | 7 条用例 |
| `bridge/{env,bridge}.test.ts` / `voice/launch-env.test.ts` | 补 10 条 |

### 为什么

**① coordinator 的输入天然很大。** qwen 每轮包一个 ~4.6k 字的请求信封,加上 opencode 自己的
system prompt。原实现让 coordinator 跟随 DeskFox 绑定的模型,于是只要用户绑的是小上下文模型
就直接 400(`Range of input length should be [1, 13000]`),**整条语音哑掉且用户无从知道原因**。
现在 coordinator 单独一档,默认 `claude-code/opus`(voice-dispatch-minimal 已验证能扛),
`DESKFOX_VOICE_BACKEND_MODEL` 可覆盖;**第三层任务仍不指定模型**,继续跟随绑定模型,
「与手敲 session 无差别」不受影响。

**② voice 目录多了一层。** `XDG_DATA_HOME` 在主进程里已经是 deskfox 命名空间,
`voiceCoordinatorDir` 又拼了一次 → `deskfox/deskfox/voice-workspace`。功能没坏,路径难看。

**③ coordinator 自己把活干了,派活根本没发生。** 修完 ① 再跑,这轮技术上"成功"了
(`end_turn: session.idle`),但 `count.md` 写在 coordinator 自己的目录、**第三层 session 一条都没建**。
根因不是 prompt 不够清楚,而是**它手里有更近的路**:coordinator session 是 sidecar 建的普通
session,自带 read/write/bash。任何"你应该派活"的措辞都在跟这条最短路径竞争,而措辞会输。
修法与"派活 MCP 只注册给 voice 目录"同思路 —— **用结构保证行为**:给 coordinator 的每轮 prompt
带 `tools: {bash:false, edit:false, write:false, patch:false}`(sidecar 翻成 permission deny)。
写与执行的路一堵,派活就成了唯一能完成任务的路径。**只禁写与执行、保留只读** ——
一问一答的轻量查询本来就该留在协调 session 里回答(1-spec §3.1)。

**④ coordinator 用 `claude-code/*` 时看不见 MCP 工具,一次都不会派活。**
禁掉写工具、把派活工具真名写进 prompt 之后,模型**仍然**只试 bash/write。
A/B 实测(只换 coordinator 模型,其余不动):`claude-code/opus` 连跑两轮零派活;
`alibaba-cn/qwen3.8-max` **第一次就正确派活**,第三层 session 建在用户项目里。
根因是老坑在新架构上复活 —— `claude-code` provider 把活转给 claude CLI,
opencode **动态注册**的 MCP 传不过去。voice-dispatch-minimal 时代靠
`deskfox-acp-wrap.mjs` 的旁路文件合并绕开,而 wrapper 正是本次重构消除掉的补丁之一。
修法:coordinator 单独一档默认值(`VOICE_MODEL_DEFAULTS.coordinator`),与 backend 解耦,
`DESKFOX_VOICE_COORDINATOR_MODEL` 可覆盖;第三层照旧跟随绑定模型。

**⑤ 第三层模型没有出口 + 失败播报等于没说**(user 自测反馈)。
user 在 local 包上试,任务全失败;派活是成功的,挂在第三层执行的
`<400> Range of input length should be [1, 13000]`。查 DB:第三层模型是
`alibaba-cn/tongyi-intent-detect-v3` —— 一个**意图识别小模型**(任务文本才 628 字,
吃掉上下文的是 system prompt 本身)。原因是 local 包全新隔离 DB、共享 config 也没有
`model` 字段,opencode 默认档挑中了它;user 的正式版绑的是 `claude-code/opus`,不受影响。
**这是测试环境问题而非设计缺陷**(第三层跟随绑定模型正是 R2/R3 要的),但暴露两处该修的:
加 `DESKFOX_VOICE_TASK_MODEL`(**默认空 = 跟随绑定**,不改默认语义,只是给出一个
不必改共享 config 的出口);加 `humanizeSidecarError` 把上下文超限/认证/代理/限流/网络
翻成能照做的一句话,**原始错误仍进日志**。

**⑥ DeskFox 退出不回收语音网关 → 孤儿骗过 health 探测。** 重启 local 包后新网关起不来
(`Gateway 已在运行` + `后台 Agent 未连接` + `exit 0`):上一轮的 qwenaudio gateway 成了孤儿,
还占着 3101。新 DeskFox 的 health 探到它就报「语音已开启」,而它连的 sidecar 早已随上一个
DeskFox 死了 —— **语音看起来开着,实际完全不工作,且不报错**。
根因是 `shutdownVoiceGateway()` 定义了却**全仓零调用者**(voice-dispatch-minimal 时代的既有缺陷,
非本 feat 引入),但它直接决定本 feat 可用性,本期一并修:接进 `stopSidecars()`,
DeskFox 从任何路径退出都会收掉网关。

### 回归

voice 单测 **342 pass / 0 fail**(新增 31 条);集成 **8 pass**;desktop typecheck 通过。

---

## 真机验证(local 包,2026-08-24)

打 local 档 `.app`(`OPENCODE_CHANNEL=local` + `electron-builder --mac --dir`),
与用户在用的正式版共存(appId `ai.deskfox.app.local`,全程未碰 `/Applications/DeskFox.app`)。

| 验收点 | 结果 |
|---|---|
| 桥路径解析(packaged 态) | ✅ `voice_probe` → `ready: true` |
| `qwenaudio setup --backend acp` | ✅ `ready:true`,`source: configured` |
| 网关启动 | ✅ `voice_start` → `state: "on"`(health 含 backend.ok) |
| 桥被 spawn + 握手 | ✅ 网关日志 `acp.process_started` → `acp.initialized`(protocolVersion 1,agentName `deskfox-voice-bridge`) |
| ACP_LABEL 生效 | ✅ 界面显示「DeskFox 已连接」 |
| 桥拿到随机端口 sidecar | ✅ `sidecar=http://127.0.0.1:55585` |
| **TC-E7 语音沟通留痕** | ✅ coordinator session 落 voice-workspace,title「语音沟通」(查 local DB 确认) |
| **§2.1 六步数据流(修完 ①③④ 后)** | ✅ 全通,默认配置下一次成功 —— 见下方时间线 |
| **TC-E1 第三层落用户项目** | ✅ `建立 session … dir=/Users/openclaw/deskfox-voice-qa role=task` |
| **三分法:第三层轮** | ✅ 收到 143 字**干净任务文本**(无信封)→ 判 task,`允许派活=否` |
| **三分法:结果回流轮** | ✅ 判 `delegation-result`,`允许派活=否`(E4 递归坑的防护,真机确认) |
| **TC-U3 resume 透明换新** | ✅ `acp=<qwen 记的旧 id>` → `sidecar=<新建 id>`,qwen 无感知;同轮内重复 resume 复用不重建 |
| **MCP 注册去重** | ✅ 一轮多次 resume,`已注册 MCP` 只出现一次 |
| **断流兜底** | ✅ 杀网关时在途轮次被收干净(补兜底文本 + `end_turn`),不留悬空请求 |
| MCP 注册策略 | ✅ 日志:`已注册 MCP qwen_audio_agent → voice-workspace`;`跳过 open-computer-use` |
| **三分法轮次判别** | ✅ 日志:`4594 字 → coordinator(带完整 backend_instructions 信封且无回流结果);允许派活=是` |
| 意图分流(R1/R2) | ✅ realtime 判定复杂 → `spawn_thinking`,objective 被扩写 |
| 任务编排(R4/R7) | ✅ `task.accepted → running → progress → completed` |
| 跟随当前项目(§3.5) | ✅ renderer 的 5 秒轮询实时写状态文件,切项目即跟随 |
| 关窗口不杀语音 | ✅ 关 DeskFox 窗口后主进程与网关照常 |
| 失败被「说出来」 | ✅ 400 错误经 `agent_message_chunk` 播报,而不是静默 |
| DashScope 180s 断连 | ✅ 真机复现 `user_idle_timeout`(E6 已知常态,gateway 自动重连) |

最终一轮(全默认配置、无任何 env 覆盖)的时间线:

```
01:21:02  coordinator session → voice-workspace(4584 字信封 → 路由轮,允许派活=是)
01:21:11  第三层 session → /Users/openclaw/deskfox-voice-qa(role=task)
01:21:11  第三层收到 143 字干净任务文本(无信封 → 判 task,允许派活=否)
01:21:12  第三层执行 → 400(见下方说明)
01:21:15  结果回流 coordinator(2778 字 → delegation-result,允许派活=否)
```

**关于第三层那个 400**:local 包用的是全新隔离 DB,从没绑过模型,于是落到阿里系小档,
撞了同一个 13000 输入上限。这**不是缺陷,恰恰是设计生效的证据** ——
第三层跟随 DeskFox 绑定模型(R2/R3 同源),它撞的限制与用户手敲 session 撞的是同一个。
正式版用户绑了模型即正常。

## 第 3 笔:第三层模型回归 DeskFox 通路(2026-08-25,user 纠正)

一度把第三层钉死成 `claude-code/opus`,当天被 user 纠正并回退。
详见 2-plan 的 D17 —— 要点:local 包任务全失败的根因是**测试包没绑过模型**,
拿"改架构默认值"去解,等于在语音链路里又造了一条平行的模型配置通路,
而消除平行通路正是本次重构的全部意义;副作用也真实:用户在界面上换了模型,
语音却还用 env 里写死的那个,与 R3 直接冲突。

现状:`VOICE_MODEL_DEFAULTS.task = ""`(空 = 跟随 DeskFox 绑定的模型),
`DESKFOX_VOICE_TASK_MODEL` 仅作排查用的逃生口。

顺带澄清:第三层用 `claude-code/*` **没有问题**。plugin 只是不能透传**动态注册**的 MCP,
而第三层要的是内置工具 + 静态 MCP,两样都在(真机验过:opus 跑任务时 bash×2 + write 全完成)。

**仍待定夺**:coordinator 是唯一还没走通 DeskFox 通路的地方 —— 它需要动态注册的派活工具,
claude-code 档结构上拿不到。三个方案见 2-plan 的 D18。

## 第 4 笔:模型走 DeskFox 通路 + coordinator 认得用户项目(2026-08-25)

user 定案两条分工(2-plan D18):**干活那层跟随 DeskFox 里选的模型;分派那层独立配置**。
落地时又打出两个缺陷,都在 2-plan 的 D19 / D20:

**① 「跟随 DeskFox」不能靠"不传 model"。** sidecar 在没有显式模型时走 `defaultModelIDs`
(`provider.ts:1098`)—— **每个 provider 按模型名排序取第一个**,纯任意
(`tongyi-intent-detect-v3` 就是这么被选中的)。也就是说之前所谓的"跟随绑定"名义上跟随、
实际没跟。新增 `sidecar.recentModel(directory)` 读**该目录最近一条 session 的模型**
—— 用户在界面上选的模型记在他建的每条 session 上,这是对当前选择最忠实的代理。
优先级:显式配置 > 最近实际用过的 > 不指定(兜底)。

**② coordinator 把自己的目录当成了"当前项目"。** 它的 cwd 是 voice 独立目录(递归防护的代价),
于是派活时把 `~/.local/share/deskfox/voice-workspace` 写进了任务文本,
第三层虽然建在用户项目里却照着绝对路径写 —— **每一层单独看都对,错的是层间传递的那段文字**。
路由 prompt 改成每轮现算并注入当前项目路径 + 明令不写绝对路径。

真机复验(默认配置,无任何 env):

| 验收点 | 结果 |
|---|---|
| 干活层跟随 | ✅ 日志 `第三层跟随该项目最近使用的模型:claude-code/opus`;DB 确认 session 模型为 opus |
| 分派层独立 | ✅ coordinator 用 `alibaba-cn/qwen3.8-max` |
| 派活文本无绝对路径 | ✅「统计**当前项目**里有多少个文件,写进**项目根目录**的 count.md」 |
| **产物落在用户项目** | ✅ `~/deskfox-voice-qa/count.md`;语音工作区干净 |

回归:voice 单测 **362 pass / 0 fail**、集成 8 pass、typecheck 29/29。

### 完整闭环复验(2026-08-25,第三层配 `alibaba-cn/qwen3.8-max`)

修完 ⑤ 之后,**说话到产物落地的整条链路第一次真正跑通**:

| 环节 | 证据 |
|---|---|
| 派活 | `建立 session … dir=~/deskfox-voice-qa role=task` |
| 第三层真干活 | 该 session 的工具调用:`bash`×4 完成 + `write` 完成 |
| **产物落在用户项目** | `~/deskfox-voice-qa/count.md`,内容正确(30 个文件 = .git 27 + .deskfox 1 + 根目录 2) |
| 结果回流 | `2698 字 → delegation-result;允许派活=否` |
| **播报(TC-M2 内容抽查)** | 「统计好了,项目里一共有 30 个文件,结果已经写进 count.md。其中大部分是 git 内部文件,如果排除 .git 目录,实际项目文件是 3 个。」—— 口语、准确,且主动补了有用的判断 |

**未覆盖(仍需 user 参与)**:TC-M1 真麦克风、TC-E2 长任务 ≥6 分钟、
TC-E3 并发播报、TC-E6 崩溃恢复。

### 回退方法

一个 env 整体退回现方案,**不需要改代码或重新打包**:

```
DESKFOX_VOICE_LEGACY_BACKEND=1
```

旧链路的全部代码(wrapper / env carry / journal / coordinator-state / task-watch)本笔**一行未删**,
按 1-spec §6 留到验收通过后单独一期清理。

单笔 revert:`git revert <hash>`(P4:一笔 commit 干一件事)。
