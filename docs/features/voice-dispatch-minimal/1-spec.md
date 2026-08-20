feat-id: voice-dispatch-minimal
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 语音派活最简自用版(REQ-102)— 1-spec

> **来源**:OPENCODE-PLAN `需求计划/2026-08-14.md`(2026-08-20 重写版)。本文档是它的 fork 侧实施化。
> **规模分级:Large**(触动 ~5 个上游文件 + 新增 >500 行)→ 按规范 v2,**动工前本 spec 需 user 审签**。
> **本批不发版**。交付物 = user 本机可日常使用的语音派活链路。
> **零上游内核改动、零 R4 override**(见 §6)—— D-E 选了 wrapper 路线后,原计划里唯一要动
> `packages/opencode/` 的部分被消解。

---

## 1. 一句话

不牺牲飞书 / media-gen 的前提下,点顶部栏一个图标进入语音派活状态:说话 → 后台 agent 在**当前项目**里干活 → 语音播报结果,任务在 DeskFox 会话列表里看得见。

---

## 2. 已拍板的决策(2026-08-20,user)

| # | 决策 | 落地形态 |
|---|---|---|
| **D-A** | 隔离边界 = **共用** DeskFox 数据/配置命名空间 | Gateway 由 Electron 主进程拉起,自然继承 `applyDeskfoxDataNamespace()` 设进 `process.env` 的 XDG(`data-namespace.ts:191`) |
| **D-B** | 插件隔离 = **fork 包自门控** | 两个 fork 插件入口读 `OPENCODE_CLIENT`,acp 且不在白名单 → 早返回空 hooks |
| **D-C** | 派活目标 = **跟随当前项目 + full 权限** | `OPENCODE_WORKSPACE` = DeskFox 当前窗口项目目录;护栏见 §5·R3 |
| **D-D** | 后端模型 = **`anthropic/claude-opus-5`,可换** | 写进 `OPENCODE_CONFIG_CONTENT.model`,取值来自 env,换模型不动代码 |
| **D-E** | stdout 净化 = **外挂 wrapper**,不改 `acp.ts` | `OPENCODE_BIN` 指 fork 自有 wrapper,管道级逐行过滤 |
| **D-F** | 模型三选(2026-08-21 user 授权「你来选,目标效果最好」) | 见下 §2.2 |
| **D-G** | ACP 宿主 = **本仓 1.x 源码入口 via bun**,不是内置二进制(2026-08-21 user 拍板) | `OPENCODE_BIN` → wrapper → `bun <repo>/packages/opencode/src/index.ts acp`;见下 §2.1 |

### 2.1 ACP 宿主(D-G)—— 推翻原方案的三条实测

原 S0·钉死① 写的是「`OPENCODE_BIN` = DeskFox 内置 sidecar 绝对路径」。2026-08-21 实测**这个前提不成立**:

| 跑什么 | 结果 |
|---|---|
| `packages/desktop/resources/opencode-cli acp` | 是 **opencode2 / v2 世代**(`--help` 自称 "OpenCode 2.0 preview",带 `migrate` v1→v2、`serve` v2 API);隔离 XDG 实测落 **`opencode-next.db`** —— 另一套库 |
| `bun packages/opencode/src/index.ts acp` | ✅ 正常握手 `protocolVersion:1` / `agentInfo: OpenCode local`;与 app 同为 v1 世代,共用同一个 `opencode.db` |
| 装好的 `/Applications/DeskFox.app` | Resources 里**没有任何 opencode CLI** —— 生产跑的是 `utilityProcess.fork(sidecar.js)`(`server.ts:77`),不是二进制 |

⇒ 用内置二进制则 D-A 换来的「语音派的活在 DeskFox 会话列表里看得见」直接归零(活落进 `opencode-next.db`,app 读 `opencode.db`)。本批(自用)因此走源码入口;**产品化要另出一个 1.x CLI 二进制随包带**(+构建步骤 +100~150MB 包体),已记进需求计划的定位表。

**连带修正:版本号不能当身份判据。** 三种合法形态各不相同 —— 源码态 `agentInfo.version = "local"`、内置 v2 二进制 `0.0.0-next-16350`、homebrew `1.17.4`。所以身份靠 `resolveAcpHost` 的**路径构造**保证(命令行是我们自己拼的绝对路径,永不退化成 PATH 上的 `opencode`),版本只做告警,唯一硬拦的情形是「干净 semver 且 < 1.18.0」= 真跑到了老 opencode。

### 2.2 模型选型(D-F,依据落在 qwen-audio-agent 1.11.0 的 catalog 与 fork 代码)

| 位置 | 选定 | 依据 | 换法 |
|---|---|---|---|
| **后端主模型**(真正干活的 agent) | **`anthropic/claude-opus-5`** | 订阅(auth.json `anthropic` = `type: oauth`)可达的最强 agentic 档,已在目录内(`~/.cache/opencode/models.json`)。Fable 5 能力更高但需 API key + 30 天数据留存,**oauth 订阅是否放行未验证,不据此行动** —— 真要上,同一个 env 改一个值即可 | `DESKFOX_VOICE_BACKEND_MODEL` → `OPENCODE_CONFIG_CONTENT.model` |
| **后端 small_model**(标题生成等杂活) | **`alibaba-cn/qwen-flash`** | `config.ts:77` 明确 small_model 只用于 title generation 这类杂活。让它烧 Opus 订阅额度是纯浪费:qwen-flash $0.022/M 输入(qwen3-max 的 1/39)、1M 上下文、走已有 API key 独立计费。**主模型保持最强、杂活不抢额度** | `DESKFOX_VOICE_SMALL_MODEL` → `OPENCODE_CONFIG_CONTENT.small_model` |
| **前端 realtime**(听和说) | **`qwen-audio-3.0-realtime-plus`**(默认锁定,S0 内做一次 A/B 定终选,对手 `qwen3.5-omni-plus-realtime`) | 四条:① 1.11.0 官方默认就是它(`realtime-model-catalog.mjs:1`);② 它所在的 audio 族默认转向检测是 **`smart_turn`**,omni 族是 `semantic_vad` —— spike 里「…然后告诉我一共有。」尾巴被切正是转向检测过激,smart_turn 就是冲这个去的;③ omni 族多出来的优势是图片输入,但**本版客户端传输层明确关闭了 JPEG 观察帧与原生视频**(`configuration.zh.md:638-642`),优势本批拿不到;④ 两族都支持 Function Calling(派活前提) | `DESKFOX_VOICE_REALTIME_MODEL` → `QWEN_AUDIO_REALTIME_MODEL` |

**顺带作废一条旧风险**:REQ-102 §4 记的「`qwen3-omni-flash-realtime` 疑似 8 轮对话上限(待核实)」—— 该模型在 1.11.0 catalog 里**已不存在**(被 qwen3.5 系取代),这条不再是本批的变量。

**其余小决策**:qwen-audio-agent 锁 **1.11.0**(user 2026-08-21 无异议)。

**顺带记一个知识点**:1.11.0 有 `QWEN_AUDIO_AGENT_OPENCODE_XDG_CONFIG_HOME`,是「给语音单独指一套 opencode 配置目录」的正规入口 —— **D-A 选了共用,所以我们刻意不设它**;将来若因 R1/R2 要退到隔离,这就是那个开关。

---

## 3. 链路(落地后的实际形态)

```
DeskFox(Electron 主进程,已设好 XDG → deskfox 命名空间)
  │  点顶部栏麦克风图标 → IPC → 主进程 spawn
  ▼
qwenaudio gateway run --backend opencode   (127.0.0.1:3101)
  │  env: OPENCODE_BIN=<wrapper> / OPENCODE_WORKSPACE=<当前项目>
  │       OPENCODE_CONFIG_CONTENT={model, permission} / DASHSCOPE_API_KEY / OPENCODE_PORT=4396
  ▼
deskfox-acp-wrap.mjs        ← D-E:fork 自有,新文件
  │  ├─ resolveAcpHost():路径由我们构造 → 永不退化成 PATH 上的 opencode(那儿是 1.17.4)
  │  ├─ spawn(bun <repoRoot>/packages/opencode/src/index.ts acp)   ← D-G
  │  ├─ child.stdout 逐行:JSON.parse OK && jsonrpc==="2.0" → 本进程 stdout;其余 → stderr
  │  └─ stdin 原样透传
  ▼
opencode 1.x acp  (本仓源码,进程内)
  ├─ 插件加载:feishu → 自门控早返回空 hooks(D-B)
  │             media-gen → 白名单内,正常加载
  └─ 会话落 ~/.local/share/deskfox/opencode/opencode.db,project = 当前项目目录
        → **DeskFox 会话列表里看得见**(D-A 的核心收益)
```

---

## 4. IN SCOPE / 施工细则

### S0 · 环境重建 + 三钉死(P1)

**背景**:原留档的 `/tmp/qwen-spike/` 六个装置已随重启全部丢失(2026-08-20 核实),需重写。

- 新增 `packages/desktop/scripts/local-test/voice/`(全部 fork-only 新文件):
  - `make-audio.sh` — `say -v Tingting` + `afconvert` → PCM16 / 16kHz / 单声道
  - `voice-e2e.mjs` — 唤醒 + 派活(按 100ms 分片以真实时速率灌 `ws://127.0.0.1:3101/api/realtime` 的 `audio.append`)
  - `voice-e2e2.mjs` — 并发 + 打断(断言 `playback.clear` 时延)
  - `ws-realtime-probe.mjs` — realtime 模型权限探测
  - `README.md` — 跑法 + 已知坑
- **不再需要 `--pure` shim**(D-B + D-E 落地后它是多余的),装置里不保留这一层
- **三钉死**(实现落在 wrapper + 启动参数构造模块):
  1. `OPENCODE_BIN` → wrapper → **`bun <repoRoot>/packages/opencode/src/index.ts acp`**(D-G)。仓根来自 `DESKFOX_VOICE_REPO_ROOT`;仓路径缺失或入口文件不存在 → **抛错并禁用语音入口**,不静默降级。身份靠路径构造保证,版本仅告警(唯一硬拦:干净 semver < 1.18.0)
  2. key 读取按 `packages/media-gen/src/auth.ts:14` 既有正确写法运行时读 `XDG_DATA_HOME` 推导 auth.json,**禁止硬编码 `~/.local/share/opencode`**(该路径 2026-07-14 起已过期)
  3. 三个模型走 env(默认值见 §2.2):`DESKFOX_VOICE_BACKEND_MODEL` / `DESKFOX_VOICE_SMALL_MODEL` / `DESKFOX_VOICE_REALTIME_MODEL`(后者映射到 qwen 侧的 `QWEN_AUDIO_REALTIME_MODEL`)
- **前端模型 A/B(定终选)**:装置就绪后跑一次 `qwen-audio-3.0-realtime-plus` vs `qwen3.5-omni-plus-realtime` 对照 —— 同一批音频、同一段派活任务,比三项:① 长句 ASR 保真(重点复现「…然后告诉我一共有。」那条尾巴被切的样本)② 打断时延(`playback.clear` 到达时间)③ 派活成功率(`task.accepted` 是否稳定触发)。结论回填本 spec §2.2 并锁死默认值

### S1 · 插件自门控 + wrapper(P2)

**门控**(2 处 fork 自有文件,各约 5 行):

| 文件 | 锚点 | 改法 |
|---|---|---|
| `packages/adapter-feishu-lark/src/plugin.ts` | `FeishuBridgePlugin` 入口(:91) | 函数体第一行判定,命中 → `return {}`,**不进 `initBackground()`**(它才是起 HTTP server + 5 条 WSS 的地方) |
| `packages/media-gen/src/index.ts` | `MediaGenPlugin` 入口(:25) | 同上,命中 → `return {}`,不进 `startMediaServer()` |

判定抽成共享纯函数(Logic 清单候选):

```ts
// 语义:ACP 子进程里默认不加载 fork 插件;白名单显式放行
// 默认白名单 = ["media-gen"](语音要能派「生成一张图」;抢 WSS 的只有飞书)
export function shouldSkipInAcp(pluginId: string, env = process.env): boolean
```

**时机成立性(已核实)**:`packages/opencode/src/cli/cmd/acp.ts:23` 在 `Server.listen`(:25)**之前**就设了 `process.env.OPENCODE_CLIENT = "acp"`,而 `Flag.OPENCODE_CLIENT`(`packages/core/src/flag/flag.ts:75`)是运行时读取 —— 插件在 `Server.listen` 内部才加载,判定必然读到 `"acp"`。

**wrapper**(新文件 `packages/desktop/scripts/deskfox-acp-wrap.mjs`):

- stdin 原样透传给子进程;子进程 stderr 原样转发
- 子进程 stdout **按行切分**(必须处理跨 chunk 的半行拼接与超大 ndJSON 行,不得截断)
- 每行判定:`JSON.parse` 成功 **且** `jsonrpc === "2.0"` → 写本进程 stdout;否则整行写 stderr(带 `[acp-wrap]` 前缀便于排查)
- 退出码/信号透传;子进程异常退出时给出可读原因
- 过滤判定抽成纯函数 `isAcpFrame(line: string): boolean` → **Logic 清单候选,行覆盖 ≥ 80%**

> 为什么管道级优于进程内:Bun 下 patch `process.stdout.write` **拦不到 `console.log`**(实测 bun 拦截计数 0 / node 1),而 sidecar 是 Bun 产物;管道级则源无关,连 native 直写 fd 1 也拦得住。且零上游改动、上游 sync 永不冲突、不改变 `opencode acp` 对 Zed 等其他消费方的行为。

### S2 · 重跑 spike + 拆绕法 + 参数固化(P2)

- 升级并锁定 `qwen-audio-agent@1.11.0`,把 1.7.0 时代的文件锚点全部复核一遍并回填 REQ-102 详情 doc
- 逐个验证并**拆掉**:① `applyPermissionMode` 那行 patch —— fork 1.18.16 的 `packages/core/src/v1/config/permission.ts:40` `normalizeInput` 把字符串归一成 `{"*": ...}`,而 `agent.ts:38` 用的是同一个 `Info` schema ⇒ agent 层现在接受字符串简写,**patch 已无必要,拆完从全局安装里撤掉**(留着会让下次排查误判);② `OPENCODE_MIN_VERSION` 逃生阀(1.11.0 的 `minimumVersion` 仍是 `'1.18.0'`,我们 1.18.16 天然满足)
- 启动参数固化成一个 fork 自有模块(不靠人记):`OPENCODE_BIN` / `OPENCODE_WORKSPACE` / `OPENCODE_CONFIG_CONTENT`(含 `model` + `permission`)/ `DASHSCOPE_API_KEY` / `OPENCODE_PORT=4396`
- **实测 `OPENCODE_CONFIG_CONTENT` 与继承来的 `opencode.jsonc` 是覆盖还是 merge** —— 若全量覆盖,语音会话的 provider 配置会跟主实例不一致,需显式合并后再注入

### S3 · 顶部栏语音入口(P2)

- 范本:`packages/app/src/components/titlebar.tsx` 495-520 的终端按钮(`TooltipKeybind` + `Button` + `command.trigger()` + `Icon`,外层 `<Show when={params.dir}>`)。语音图标**同样受 `params.dir` 约束**(D-C 要跟随当前项目,没开项目就没有派活目标)
- 进程托管走 Electron 主进程:`packages/desktop/src/main/`(新增 fork-only 模块)+ `ipc.ts` + `preload/index.ts` 各加一个通道
- 形态:**后台常驻 Gateway + 拉起 webui**(`qwenaudio gateway install|start|status|stop` 生命周期齐全,默认 `127.0.0.1:3101`)。**待实测**:webui 能否内嵌成 Electron 窗口;内嵌成本高就走外部浏览器,本期不纠结
- 未装 `qwen-audio-agent` → 图标禁用 + tooltip 给装法(判定 `qwenaudio setup --backend opencode --json`),**不能点了没反应**
- 再点关闭:进程真退干净(3101 / 4396 无残留)

---

## 5. 风险登记(必须验,不接受推断)

| # | 风险 | 处置 |
|---|---|---|
| **R1** | 两个 opencode server 同开一个 `opencode.db`(D-A 共用)。SQLite 是 WAL + `busy_timeout=5000`(`packages/core/src/database/database.ts:27-29`)技术上支持多进程,但 `CLAUDE.md` 有过「同库会写坏 session 表」的明确告诫 | T12 专项实测。真出问题 → 退「共数据隔配置」或完全隔离,并记录代价(会话不可见) |
| **R2** | **anthropic OAuth token 刷新竞态**。刷新结果经 `Auth.set`(`packages/opencode/src/auth/index.ts:73`)写回 auth.json,**全链路无文件锁**;两个进程同时刷新可能互相冲掉 refresh token → 掉登录 | T13 专项(长挂机 + 语音跑一轮)。真出问题 → 语音侧切 API-key 型 provider(`DESKFOX_VOICE_BACKEND_MODEL=alibaba-cn/qwen3-max`)绕开刷新 |
| **R3** | 语音可零确认改真代码 / 跑 bash(D-C 全开权限 + ASR 实测有截断:「…然后告诉我一共有。」尾巴丢、「第一件事」→「When事」) | 硬护栏两条进 S2:① `OPENCODE_WORKSPACE` **只允许指向 git 仓库根**,非 git 目录拒绝启动语音(留 git 作最后撤销);② 语音会话起始自动打快照点并记进启动日志 |
| **R4** | 订阅额度被语音吃掉(D-D 用 oauth,与 user 自己的 Claude Code 同池) | 不做技术处置,`DESKFOX_VOICE_BACKEND_MODEL` 一键切走 |
| **R5** | **装好的 app 依赖本机源码树**(D-G 的代价):仓被移动/删除/换盘符,语音就不可用 | `resolveAcpHost` 抛错 → 语音入口**禁用 + tooltip 说明原因**(不是点了没反应);产品化路径(编译 1.x CLI 随包带)记在 §3 定位表,不让这条悄悄变成永久形态 |

---

## 6. 规范符合性

- **R1 三级跳**:全部停在第 1 级(新文件)。wrapper / 装置 / 启动参数模块 / 语音托管模块全是 fork-only 新文件;仅 `titlebar.tsx` + `ipc.ts` + `preload/index.ts` 是上游文件的接口注入(各 ≤ 10 行)
- **R2 FORK marker**:上述三处上游文件按规范加 marker;新文件加 `[fork-only]` 头注
- **R3 三类 hardcode**:无品牌串 / 无主题色 / 无 icon 覆盖;唯一图标走现有 `Icon` 组件既有图标名
- **R4 override**:**0 笔** —— `packages/app/` 与 `packages/desktop/`(非 `src-tauri` 配置)均不在黑名单;`packages/adapter-feishu-lark/` 与 `packages/media-gen/` 是 fork 自建包
- **R5 测试**:Large ⇒ ≥ 2 e2e + 5 unit。`isAcpFrame` 与 `shouldSkipInAcp` 两个纯函数进 Logic 清单候选(行覆盖 ≥ 80%,正式入清单待 user 拍板);语音入口按钮属 View 清单
- **R6 网络监听**:wrapper 不监听端口;Gateway 是外部进程且默认 `127.0.0.1:3101`;`OPENCODE_PORT=4396` 由 opencode 自身按既有 loopback 规则绑定
- **R8 测试用例清单**:见需求计划 §7 的 T1–T18(动工前已列全)

---

## 7. 验收门槛

- [ ] 需求计划 §7 的 **T1–T18 全过**(T8/T9/T10/T11 是断言型,留截图或日志)
- [ ] typecheck 全绿 + fork 包单测全绿(app / media-gen / adapter-feishu-lark / opencode)+ Playwright 默认套件全绿
- [ ] 上游改动 ≤ 3 个白名单文件、各 ≤ 10 行、均带 FORK marker;`packages/opencode/` **零改动**
- [ ] 🔴 **user 自用 3 天以上不炸**(体感门槛,真正的验收人是 user 自己)

## 8. 回退方法

- 语音入口:revert S3 那笔 commit,图标消失,其余不受影响
- 插件门控:revert S1 那笔,或运行时设 `DESKFOX_ACP_PLUGINS=feishu,media-gen` 恢复全加载
- wrapper:把 `OPENCODE_BIN` 指回内置 sidecar 本身即可绕过(退化成有噪声但能跑)
- 全批:四笔 commit 各自独立可 revert(P4)
