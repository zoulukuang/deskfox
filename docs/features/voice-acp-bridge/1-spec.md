feat-id: voice-acp-bridge
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# voice-acp-bridge — 语音架构重构：DeskFox 成为语音网关的 ACP 后端（路线 D）

> **规模:Large**(估 500–1000 行新代码 + 测试,涉及语音链路整体替换)→ 按规范 **1-spec 需 user 审签后才动工**。
> 本文所有「实测」均出自 2026-08-24 的 voice-lab 实验(独立配置目录 + 独立端口 3199,零仓内代码改动),
> 实验脚本与 trace 见 scratchpad `voice-lab/`(会话级目录,结论以本文为准)。

## 0. 一句话

把 qwen-audio-agent 从「自带一套 opencode 后端的独立系统」降级为「纯语音前端 + 任务编排器」,
由 DeskFox 提供一个 **ACP 桥**(`ACP_COMMAND` 指向我们的进程)充当它的后台 Agent ——
于是每一个语音派出的任务都是 **DeskFox sidecar 亲自创建的 session**,与手敲的 session 完全同源。

## 1. 背景与动机

### 1.1 现状(voice-dispatch-minimal)的结构性问题

现方案中 qwen spawn 自己的 opencode 进程(`serve :4396` + `acp`),与 DeskFox 的 sidecar(`:4096`)
**只共享 SQLite 文件,不共享进程、事件总线、env**。由此产生的整片补丁:

| 补丁 | 补的是什么 |
|---|---|
| `NAMESPACE_ENV_NAMES`/`NETWORK_ENV_NAMES` env carry | spawn 整份替换 env,漏一个变量整个命名空间/代理错位 |
| `deskfox-acp-wrap.mjs` stdout 净化 wrapper | 第二套 opencode 的管道污染 |
| `resolveVoiceDbEnv` 渠道分流 | 两套进程要落同一个库 |
| `server-sync.tsx` 三道闸强刷 | 跨进程写库、事件总线不通,列表不刷新 |
| voice-journal / coordinator-state 归档 | coordinator 是我们够不着的 session,历史污染、递归派活 |
| 代理 403(未根治) | 语音链路的 claude CLI 拿不到代理 |

**每一条都是「两套 opencode」这一个结构问题的表象。** 本 feat 是填坑,不是继续在坑边上补。

### 1.2 user 需求(2026-08-24 拍板的场景,R1–R9)

| # | 场景 | 本方案的满足方式 |
|---|---|---|
| R1 | 简单任务快速响应 | realtime 模型直接答(qwen 原生,`spawn_thinking` 不触发) |
| R2 | 复杂任务交给更强模型 | 第三层 session 用 DeskFox 绑定模型(当前 claude-code/opus) |
| R3 | 任务在 session 列表可见,执行状态与既有 session **无差别** | **结构保证**:session 就是 sidecar 建的,同一事件总线 |
| R4 | 实时监控任务进展 | qwen 任务编排层原生(`task.running/progress`),桥转发进度 |
| R5 | 完成后语音播报简洁结果 | qwen announcement 通道原生(实测 origin=announcement) |
| R6 | 列表里可查完整执行过程 | 同 R3,结构保证 |
| R7 | 同时编排多个任务 | qwen `delegatedWorkRuns` 原生多任务;并发播报见 E7 |
| R8 | 语音查看项目文件 | 第三层 session 本来就有全套工具(read/grep/…) |
| R9 | 语音查看 session 历史 | 桥实现 `session/list` → sidecar 历史;另有 MCP `sessions_list` |

另有三条已拍板的设计决策:
- **播报必须走同一个语音助手**,不另做 TTS(2026-08-24);
- **语音对话落独立 session**(2026-08-24);
- 唤醒词沿用「你好千问」+ 静默 180s 休眠(2026-08-21,继承现方案)。

### 1.3 为什么是路线 D(对比已否决的路线)

- **路线 A(qwen 连既有 sidecar)**:qwen 的 ACP 传输层只有 `AcpProcessClient`(spawn+stdio),
  无 HTTP/socket 连接方式(`acp-client-factory.mjs` 实测只认 `kind==='process'`),死路。
- **路线 B(`--backend none`,DeskFox 全自研调度)**:可行但要自己重写意图分流、任务编排、播报队列。
  实测 `text.message` 播报会以「用户输入」身份打断进行中的对话、并发两条会截断
  (E2b:「任务 A 已完成,扫描了 500 只」——"股票"被吃掉)。
- **路线 D(本方案)**:qwen 的通用 `acp` backend 允许 `ACP_COMMAND` 指向任意命令(官方扩展点,
  `backend-catalog.mjs` 的 `setup.commandEnvironment`)。mock 实测**全链路闭环**:
  意图分流(`spawn_thinking`)→ 第三层 session 回到我们进程 → 结果自动回流 → announcement 播报,
  编排与播报零自研。

## 2. 架构

```
DeskFox 主进程 (Electron)
│
├── sidecar (opencode server :4096)          ←— 唯一后端,所有 session 在这
│     ├── 语音沟通 session(coordinator,独立目录 ~/.deskfox/voice/)
│     └── 任务 session × N(用户各项目目录)   ←— 与手敲 session 完全同源 (R3/R6)
│
├── 【新】deskfox-voice-bridge(ACP 桥,qwen spawn 的子进程)
│     ACP stdio ⇄ sidecar HTTP(:4096, server 密码经 ACP_* env 传入)
│     职责:6 个 ACP 方法翻译 + 进度转发 + MCP 注册 + 三分法轮次判别
│
└── qwenaudio gateway --backend acp(DeskFox 主进程 spawn,替换现 --backend opencode)
      realtime 语音 + 唤醒词 + 悬浮球/WebUI + 任务编排(delegatedWorkRuns)+ announcement 播报
```

### 2.1 数据流(一次派活,全部实测过)

1. 用户说话 → realtime 模型判定复杂 → 调 `spawn_thinking`(qwen 原生,objective 扩写质量高)
2. gateway 把请求信封(`<qwen_audio_agent_backend_instructions>`,~4.8k 字)经 ACP `session/prompt`
   发给 **coordinator session**(桥转发给 sidecar 中 voice 目录下的 session,配的模型执行路由)
3. coordinator 调 MCP `qwen_audio_agent_session_start {prompt, title}`
4. gateway 回头对桥发 `session/new`(cwd)+ `session/prompt`(干净任务文本)——**第三层**
   → 桥翻译为 sidecar 创建 session(真正的 DeskFox session,列表立即可见)
5. 任务执行期间桥把 sidecar 事件流转成 ACP `session/update` → gateway `task.progress`
6. 任务完成(桥 reply `end_turn`)→ gateway 把结果包成 `<qwen_audio_agent_delegation_result>`
   回灌 coordinator → coordinator 只整理 → announcement 通道播报(不打断,见 E7)

### 2.2 桥的职责边界(刻意窄)

**要做**:`initialize` / `session/new` / `session/resume(load)` / `session/prompt` / `session/cancel` /
`session/close` 六方法翻译;`session/update` 进度转发;把 qwen 传入的 MCP servers 注册给对应 session
所在目录(`mcp.add`,remote 类型带 Bearer header);三分法轮次判别(§3.3)。

**不做**(qwen 全包,实测确认):意图分流、任务状态机、结果回流、播报与排队、唤醒词、多任务登记、
超时管理(第三层 `timeoutMs: 0`,见 §4.1)。

**不碰**:上游文件零修改 —— 桥是 fork-only 新文件(R1 三级跳第 1 级,零 R4 override)。

## 3. 关键设计决策

### 3.1 coordinator 由真模型执行,落在独立目录(一个设计点解决三件事)

coordinator 收到的是 4.8k 字路由指令,必须由 LLM 理解执行(mock 阶段是硬编码,生产不是)。
桥把它落成 sidecar 在 **`~/.deskfox/voice/` 独立目录**下的 session:

1. **递归防护**:MCP 状态按 directory 隔离(实测:`mcp/index.ts:492` state 挂 `InstanceState`,
   `instance-state.ts:49` 按 directory 取缓存)。派活工具只注册给 voice 目录,
   第三层(用户项目目录)**结构上拿不到** `session_start` → 递归不可能。
   这是对现方案「递归派活」「一件事 3 个 session」教训的结构性根治,不再靠 prompt 约束。
2. **语音对话留痕**(user 拍板③):coordinator session 即语音沟通记录,voice-journal 补丁整套退役。
3. **列表呈现可控**:voice 目录在项目列表中天然与用户项目分开(展示策略后续可调,不影响架构)。

coordinator 路由模型**可配**,默认跟随 DeskFox 绑定模型;路由是轻任务,可降级小模型省延迟/费用
(配置项,不在本期做 A/B)。

### 3.2 每次网关启动重建 coordinator session

继承现方案已验证的决策(few-shot 历史污染教训)。桥在 `initialize` 后不复用旧 coordinator,
`session/resume` 请求旧 ID 时透明换新(对 qwen 声明 `resume` 能力但内部新建,返回其请求的 ID 即可,
E4 已实测 gateway 接受)。

### 3.3 三分法轮次判别(递归坑的第二道闸)

E4 实测教训:只判 `<qwen_audio_agent_backend_instructions>` 会把**结果回流轮**误判成新任务
(mock 自己递归开出了 mock_3 —— 与生产上「一件事 3 个 session」同款)。判据必须是互斥三类:

| 轮次 | 判据 | 桥的行为 |
|---|---|---|
| 结果回流轮 | 含 `<qwen_audio_agent_delegation_result>` | 交 coordinator 整理,**绝不再派活** |
| 新请求路由轮 | 含 backend_instructions 且无 delegation_result | 交 coordinator 路由 |
| 第三层任务 | 无信封 | 交任务 session 执行 |

注:生产实现中该判别主要约束**桥自身逻辑**(如是否附加派活工具上下文);
coordinator 模型自身也会读信封,双保险。此三分法必须有单测钉死(TC-U5)。

### 3.4 env 契约:只有 `ACP_*` 前缀能穿进桥

实测(E6 第一轮):qwen 给 ACP 子进程的 env 走白名单,非 `ACP_*` 变量静默丢失。
桥需要的全部配置走 `ACP_*`:

| 变量 | 用途 |
|---|---|
| `ACP_COMMAND` | qwen 约定:桥的可执行路径 |
| `ACP_WORKSPACE` | qwen 约定:默认工作目录 |
| `ACP_DESKFOX_SERVER_URL` | sidecar 地址(http://127.0.0.1:4096) |
| `ACP_DESKFOX_SERVER_AUTH` | sidecar Basic 凭据(opencode:密码) |
| `ACP_DESKFOX_VOICE_DIR` | coordinator 独立目录 |

DeskFox 主进程 spawn gateway 时注入(替换现 `launch-config.ts` 的大部分内容)。
**凭据只进 env 不落盘、不进命令行**(开源仓隐私红线)。

### 3.5 第三层 cwd:桥以 DeskFox 当前项目为准

现方案痛点:网关工作目录启动时钉死,切项目不跟随。路线 D 中 gateway 给的 cwd 来自
`ACP_WORKSPACE`(同样是启动时值),但**桥可以无视它**:`session/new` 时向 sidecar 查询
DeskFox 当前活跃项目目录,以其为准建 session。
代价:qwen 的 delegation 记录里 directory 显示的是它自己的值,与实际可能不一致 ——
仅影响 qwen 侧日志显示,不影响任何功能;记为已知差异(TC-E8 验证切项目场景)。

### 3.6 权限

通用 acp backend `supportsFullPermission: false`,`--backend-permission-mode full` 会被硬拒
(E5 实测:直接不启动)。**用 native 模式**。这不构成限制:ACP 的 `session/requestPermission`
是 client 方法、由桥主动发起 —— 桥对语音派活场景直接放行(等价于现方案的 full),
不发 requestPermission 就没有语音确认打扰。敏感操作的权限策略沿用 sidecar 自身的 agent 配置。

## 4. 实测验证记录(截至撰写时)

| # | 验证点 | 结果 |
|---|---|---|
| E1 | `--backend none` 起得来、WS 双向通 | ✅ 199ms ready,零子进程 |
| E2/E2b | `text.message` 播报保真/并发 | ✅ 指令式 13/13;❌ 并发打断+截断 → 否决路线 B 播报通道 |
| E3 | 意图分流 | ✅ `spawn_thinking` 原生,objective 扩写质量高,不自建分类器 |
| E4 | 第三层 session 归属 | ✅ `session_start` 后 gateway 对桥发 `session/new`,ID 由桥生成;结果自动回流+播报 |
| E5 | full 权限模式 | ✅ 被硬拒但无影响(§3.6) |
| E9 | MCP 目录隔离(递归防护地基) | ✅ 代码证据三条(remote+headers / InstanceState 按 directory / `mcp.add` 动态注册) |
| E6 | 长任务(第三层挂 6.5 分钟,超 coordinator 300s 默认超时) | ✅ 代码证据(`acp-backend-adapter.mjs:776` `timeoutMs: 0`)+ 真机:第三层挂满 390s 未被掐,`task.progress` 全程 397 条,完成播报 t=394s 送达(origin=announcement),无 failed/cancelled。**额外发现**:t=184s DashScope 因 `user_idle_timeout`(180s 无输入)主动断开 realtime 会话 —— 长任务的**常态场景**;gateway 0.8s 自动重连,播报在重连后的连接上照常送达。R5 最脆弱场景一并验证 |
| E7 | 多任务几乎同时完成的 announcement 排队 | ✅ 两任务完成时刻相差 **155ms**,两条完成播报排队送达(间隔 ~2.8s)互不打断、文本完整;播报期间零 `playback.clear`(对照 E2b:text.message 通道并发即截断)。多任务并行跟踪(R7)一并验证 |

已知边界(非阻断,写进用例):
- coordinator session 的 prompt 串行(`activePrompts` 409):连续两条派活语音,第二条等第一条路由完(秒级);
- qwen 侧 delegation 记录的 directory 显示值可能与实际 cwd 不一致(§3.5)。

## 5. 风险与缓解

| 风险 | 评估 | 缓解 |
|---|---|---|
| qwen 升级改动 acp backend 契约(信封文案/MCP schema/env 白名单) | 中 — 走的是它的官方扩展点,但契约无版本承诺 | 桥启动时探测 MCP `tools/list` schema,不符即降级报错(不静默);TC-U6 契约快照测试 |
| coordinator 路由质量(真模型执行,现方案老问题部分回归) | 中 | 独立目录已结构性挡掉递归;误路由的影响=多答/少派一次,可语音重说;路由 prompt 进版本控制可迭代 |
| 长任务期间 gateway 崩溃/重启 | 低 | 任务在 sidecar 里照常跑完(session 不依赖 gateway 存活);播报丢失,列表仍可见 —— 与现方案同级,不恶化 |
| DashScope realtime 断连期间的播报 | 低 — **已实测消解**(E6):180s 无输入 DashScope 必断(`user_idle_timeout`,长任务常态),gateway 0.8s 自动重连,播报在新连接上送达 | 另有 `task.notification.offline` 队列兜底完全离线场景 |
| 迁移期两套语音代码并存 | 低 | 上线开关 `ACP_*` 一套 env 即可整体回退现方案(现方案代码本期不删,下期清理) |

## 6. 实施范围

**本期做**:
- `packages/desktop/scripts/deskfox-voice-bridge.mjs`(或 TS 编译产物)—— 桥本体
- `launch-config.ts` 改造:`--backend opencode` → `--backend acp` + `ACP_*` env 注入
  (改的是 fork-only 文件,非上游)
- coordinator 路由 prompt(fork-only 资源文件)
- 测试(§7)

**本期不做**(明确排除):
- 删除现方案代码(wrapper/env carry/journal 等)—— 验收通过后单独一期清理
- coordinator 路由模型 A/B、播报文案调优
- WebUI 品牌化改动(voice-webui 那套不受影响,继续生效)
- 开机自启语音(生命周期问题,与本架构正交,user 已同意后置)

## 7. R8 测试用例清单(动工前锁定)

### 单元(桥逻辑,Logic 清单,行覆盖 ≥80%)

- [ ] TC-U1 ACP 帧解析/组装:六方法请求→响应形状(含 `_meta` 透传、非 JSON 行容错)
- [ ] TC-U2 `session/new` → sidecar 创建调用的翻译(cwd 取 DeskFox 当前项目,§3.5)
- [ ] TC-U3 `session/resume` 透明换新(声明 resume 能力但内部重建,返回请求的 ID,§3.2)
- [ ] TC-U4 sidecar 事件流 → `session/update` 转发(文本增量、工具调用摘要;错误不断流)
- [ ] TC-U5 三分法轮次判别:三类互斥、结果回流轮绝不触发派活路径(§3.3,递归回归测试);
      含边角 case:任务文本**引用**了信封片段(如转述任务时带出标记子串)不得被误判 ——
      判据认完整标签结构,不认子串出现(E6 实验中 mock 传信封尾巴进第三层,暴露此点)
- [ ] TC-U6 qwen 契约快照:MCP 五工具名+schema、信封标记字符串 —— 升级漂移时测试先红
- [ ] TC-U7 env 契约:缺 `ACP_DESKFOX_SERVER_URL`/`AUTH` 时启动失败且报人话(不静默跑偏)
- [ ] TC-U8 MCP 注册翻译:qwen 的 http+Bearer server → sidecar `mcp.add` remote 配置(仅注册到 voice 目录)

### 集成(mock gateway ↔ 真桥 ↔ 真 sidecar,e2e ≥2)

- [ ] TC-E1 全链路派活:模拟 coordinator 路由 → 第三层 session 在 sidecar 真实出现,
      **DeskFox session 列表 5 秒内可见**(R3 核心验收)
- [ ] TC-E2 长任务:第三层挂 ≥6 分钟(超 300s),不被掐、进度持续、完成回流(E6 生产复验)
- [ ] TC-E3 并发:两任务几乎同时完成,两条播报都完整送达(E7 生产复验)
- [ ] TC-E4 取消:`session/cancel` → sidecar 任务真中止,状态回 cancelled
- [ ] TC-E5 递归防护:第三层 session 内主动请求「再开一个任务」→ 拿不到派活工具,不产生新 session
- [ ] TC-E6 崩溃恢复:任务执行中 kill gateway → sidecar 任务照常完成,列表可见
- [ ] TC-E7 语音沟通留痕:一轮对话后 voice 目录下 coordinator session 含对话记录(user 拍板③)
- [ ] TC-E8 切项目:DeskFox 切换项目后派活,新任务落在新项目目录(§3.5)

### 真机 QA(CDP 自测 ≠ 真桌面,发版前)

- [ ] TC-M1 真麦克风:唤醒 → 派活 → 列表可见 → 完成播报,全程语音
- [ ] TC-M2 播报内容抽查:数字/名称/结论不失真(对照 E2 的 facts 清单法)
- [ ] TC-M3 与正式版共存:local 渠道验证,不影响用户在用实例

## 8. 验收标准

1. §7 全部用例绿(TC-M 系列 user 参与);
2. 语音派活的任务 session 与手敲 session 在列表/详情/状态流转上无可辨差异(R3/R6);
3. 现方案的六类补丁(§1.1 表)在新链路上**均无对应物**(结构性消除的证明);
4. 用户实例回归:现有语音功能(唤醒词、休眠、品牌化 WebUI)不倒退。

---
*(九轮实验全部完成并回填;**user 2026-08-24 审签通过**,本文档锁版,只补不改。)*
