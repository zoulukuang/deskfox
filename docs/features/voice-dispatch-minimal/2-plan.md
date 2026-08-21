feat-id: voice-dispatch-minimal
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 语音派活最简自用版(REQ-102)— 2-plan

> 施工计划 + 决策轨迹。**开发中实时追加 note**(踩坑 / 方案推翻 / 与 spec 的偏差)。
> spec 未审签前不动代码。

## 施工顺序(四笔 commit,各自可 revert)

| # | commit | 内容 | 依赖 |
|---|---|---|---|
| 1 | `chore(desktop): 语音派活测试装置重建 + 三钉死` | S0 | — |
| 2 | `feat(adapter-feishu-lark,media-gen,desktop): ACP 插件自门控 + stdout wrapper` | S1 | 1(要用装置验) |
| 3 | `chore(desktop): 语音启动参数固化 + 拆除 1.17.4 时代绕法` | S2 | 2 |
| 4 | `feat(app,desktop): 顶部栏语音入口` | S3 | 3 |

## 决策轨迹(立项期)

- **2026-08-20 · D-A 共用命名空间**:候选三选一(共用 / 完全隔离 / 共数据隔配置)。选共用的决定性理由是会话可见性 —— sessions 按 `directory` 绑 project(`schema.gen.ts:13/101`),共用 + `OPENCODE_WORKSPACE` 指真实项目 ⇒ 语音派的活直接落进 DeskFox 当前项目的会话列表,这是最接近 Codex 的一点,且零成本。代价(同库并发 / token 刷新竞态)转为 R1/R2 验收项。
- **2026-08-20 · D-B fork 包自门控**:原计划要改 `packages/opencode/src/plugin/index.ts:179`(全仓唯一插件加载收口点)。核实 `acp.ts:23` 设 `OPENCODE_CLIENT` 早于 `Server.listen`(:25)后,发现在 fork 自有插件入口判定即可达到同等效果,R1 停在第 1 级。放弃的能力:第三方插件仍会在 ACP 子进程加载(自用阶段无第三方插件)。
- **2026-08-20 · D-E wrapper 而非改 acp.ts**:原复核结论是「进程内覆写 console.* + patch write」。写 spec 时对照 R1 第 1 级重新审视,发现 `OPENCODE_BIN` 本身就是注入点 ⇒ 管道级过滤可完全在新文件完成。附带三个好处:源无关(连 native 写 fd 1 也拦得住)、上游 sync 永不冲突、不改变 `opencode acp` 对其他消费方的行为。**本批因此变成 0 上游内核改动、0 R4 override。**
- **2026-08-20 · 版本锁定**:qwen-audio-agent 1.7.0 → **1.11.0**(本机现装 1.7.0,npm latest 1.11.0)。理由与回退位见 1-spec §2。
- **2026-08-21 · D-F 模型三选**(user 授权「你来选,目标效果最好」):后端 `anthropic/claude-opus-5` 保持;**新增 small_model = `alibaba-cn/qwen-flash`** —— `config.ts:77` 说明 small_model 只做标题生成这类杂活,拿 Opus 订阅额度去烧它是纯浪费,而 qwen-flash 输入价是 qwen3-max 的 1/39 且走独立 API key;前端默认锁 `qwen-audio-3.0-realtime-plus`(1.11.0 官方默认 + audio 族配 `smart_turn` 正对症 spike 的尾巴截断 + omni 族的图片输入优势被本版传输层关闭),并在 S0 内做一次真音频 A/B 对 `qwen3.5-omni-plus-realtime` 定终选。顺带作废旧风险:`qwen3-omni-flash-realtime`(疑似 8 轮上限)已不在 1.11.0 catalog 中。

- **2026-08-21 · D-G ACP 宿主改走本仓 1.x 源码入口**(user 拍板)。S0 施工中实测推翻了原方案「OPENCODE_BIN = 内置 sidecar」的前提:① 装好的 `/Applications/DeskFox.app` 的 Resources 里**没有任何 opencode CLI**(生产是 `utilityProcess.fork(sidecar.js)`,`server.ts:77`);② dev 树那个 `resources/opencode-cli` 是 **opencode2 / v2 世代**,隔离 XDG 实测 acp 落 **`opencode-next.db`** —— 用它则 D-A 的会话可见性归零;③ `bun packages/opencode/src/index.ts acp` 实测握手正常(`protocolVersion:1` / `agentInfo: OpenCode local`)且与 app 共用 `opencode.db`。代价:装好的 app 依赖本机源码树(→ 风险 R5,语音入口据此禁用而非静默失败);产品化路径 = 编译 1.x CLI 二进制随包带。
- **2026-08-21 · 版本号不再作为准入判据**。三处实测:源码态 `local` / 内置 v2 二进制 `0.0.0-next-16350` / homebrew `1.17.4`。原设计的 fail-closed 版本闸会**误杀正确的宿主**,改为身份靠 `resolveAcpHost` 路径构造保证、版本仅告警(唯一硬拦:干净 semver < 1.18.0)。

### S2(2026-08-21 交付:先减法、再固化)

**减法 —— 两个 1.17.4 时代的绕法都拆掉了(各有实测)**

| 绕法 | 结论 |
|---|---|
| qwen `applyPermissionMode` 那行手工 patch | **不再需要**。1.18.16 的 `permission.ts:40` `normalizeInput` 收字符串简写;把 qwen 原样的 `{permission:"allow", agent:{build:{permission:"allow"}}}` 注进去,零 schema 报错 |
| `OPENCODE_MIN_VERSION` 逃生阀 | **不再需要**。`qwenaudio setup --backend opencode --json` 在设了 `OPENCODE_BIN` 后 `source: "configured"` → 跳过版本闸,`ready: true` / `issues: []` |

**固化 —— `launch-config.ts` + 13 单测**;`buildGatewayEnv()` 一次性拼齐 OPENCODE_BIN / WORKSPACE / CONFIG_CONTENT / DASHSCOPE_API_KEY / 端口 / 权限模式 / PATH 补齐,并带 R3 的 git 仓库根护栏。

**施工中挖出的四条事实(全部实测,直接改了 D-F)**

1. `OPENCODE_CONFIG_CONTENT` 是 **merge 且优先级最高**(`config.ts:468-476` 的 `merge(source, next, "local")`)—— 配置文件里的 plugin / provider 段照常生效,media-gen 在语音里还在就靠这个。**spec 待实测项①结案。**
2. 注入的 `model` **确实生效**,顶层 `model` 就够;但 `acp/service.ts:785` `defaultModelFromConfig` 会先校验 `providers[p]?.models[m]`,**模型不在本机可用清单里就静默回落**(spike 那个 `opencode/big-pickle` 就是这么来的)。
3. **本机可用清单实测**:alibaba-cn 106 / opencode 7 / kimi-for-coding 4 / claude-code 4,**anthropic 零** —— auth.json 里那条 anthropic 是 oauth 且 `expires` 停在 2026-02,早过期。⇒ D-F 原定的 `anthropic/claude-opus-5` **在这台机器上拿不到**。
4. qwen 侧 `QWEN_AUDIO_AGENT_BACKEND_MODEL` **不能用来选模型**:`config.mjs:80` 把值强行拼成 `alibaba-cn/<name>`,只能选阿里系。我们走事实 1/2 的 CONFIG_CONTENT 路径。

⇒ **D-F 修订(user 2026-08-21 拍板)**:后端默认档 `anthropic/claude-opus-5` → **`claude-code/opus`**(经已配好的 ClaudeCode plugin provider,`cliPath` 指 homebrew 的 `claude`,1M 上下文)。要换回原生 anthropic 通道:先 `opencode auth login`,再改 `DESKFOX_VOICE_BACKEND_MODEL`。

**留给 S3 的一条纪律**:跑非隔离 Gateway 前必须先刷新**已安装的插件 bundle**(`~/Library/Application Support/ai.deskfox.app/plugin/…`)—— 那里现在还是没有门控的旧版;app 下次启动会自己刷,手工验证则要先刷再跑,否则等于拿旧代码验门控。

## 待实测项(施工中填结论)

- [ ] `OPENCODE_CONFIG_CONTENT` 与继承的 `opencode.jsonc` 是覆盖还是 merge
- [ ] webui 能否内嵌成 Electron 窗口(不能就走外部浏览器,本期不纠结)
- [ ] qwen-audio-agent 1.11.0 相对 1.7.0 的锚点漂移清单
- [ ] R1:主实例 + 语音同开 `opencode.db` 的实际表现
- [ ] R2:anthropic OAuth 刷新竞态是否真会掉登录
- [ ] **非隔离 stdout 噪声基线**:`acp-handshake.mjs` 在隔离 XDG 下噪声 0 行(没插件);真实基线要等 **S1 门控落地后**才敢跑 —— 现在跑非隔离会把飞书 WSS 拉起来,违背「绝不影响飞书」
- [ ] **前端模型 A/B**:`qwen-audio-3.0-realtime-plus`(smart_turn)vs `qwen3.5-omni-plus-realtime`(semantic_vad)—— ASR 保真 / 打断时延 / 派活成功率三项,结论回填 1-spec §2.1
- [ ] `small_model = alibaba-cn/qwen-flash` 是否真只吃标题生成这类调用(抽样查 Opus 侧调用量,确认杂活没走主模型)

## 开发中 note

### S0(2026-08-21 交付)

- 装置四件套 + `launch-env.ts` 三钉死落地,26 单测。施工中实测推翻两条前提 → D-G(宿主)与"版本号不作准入判据",已回填 1-spec §2.1。
- 探针第一次跑读到的是**旧命名空间**的 auth.json(裸终端没有主进程设的 XDG)—— 正是"验错环境"的具体形态。补 `applyVoiceHarnessXdg()` + 与 `data-namespace.ts` 的源码守卫。

### S1(2026-08-21 交付)

- **wrapper 内核**:`acp-frame.ts`(`isAcpFrame` / `createLineSplitter` / `partitionLines`)+ 17 单测。判据比"能 JSON.parse"更严 —— 只放行 `jsonrpc:"2.0"`,因为插件日志里真有以 `{` 开头的行(REQ-102 §3.5 原话:「任何一行插件输出恰好以 `{` 开头就会炸」)。
- **wrapper 集成测试**(真 spawn 假宿主,6 例):stdout 只出协议帧 / 噪声改道 stderr / stdin 透传 / 版本核查 / 退出码 / **子命令不重复**。
  - ⚠️ 施工中抓到的真 bug:qwen launcher 是 `spawnAndProxy(OPENCODE_BIN, ['acp'])`(`scripts/opencode.mjs:63-70`),**它会把 `acp` 当参数传进来**;wrapper 原本又拼了一次默认 `acp` → 宿主会拿到 `acp acp`。已修 + 加回归用例。
- **门控设计修正**:media-gen 不做 all-or-nothing,改成"保留 tools、不起 server"(理由见 1-spec §4·S1)。
- **真环境红→绿反证**(隔离 HOME/XDG,门控失效也够不到真飞书配置):

  | 场景 | stdout 噪声 | 飞书 |
  |---|---|---|
  | A 默认门控(直连宿主) | 1 行(某库的 legacy build Warning) | **零输出、零初始化** |
  | B 反证 `DESKFOX_ACP_PLUGINS=*` | 4 行 | 起 server、写 `feishu-plugin-server.json`、扫账号 —— 正是门控要挡的 |
  | A′ 默认门控 + **经 wrapper**(生产路径) | **0 行** | 同 A |

  真 HOME 的 `feishu-plugin-server.json` / `media-gen-server.json` mtime 均未变,飞书进程数未变。
- 回归:media-gen 148 / adapter-feishu-lark 796 / desktop 313 全绿;typecheck 3/3。desktop 唯一红是存量的 `draft-store.test.ts`(`node:sqlite`,main 上同样),非本批。
- 插件 bundle 已用 `packages/branding/scripts/build-{feishu,media-gen}-plugin.sh` 从源码重建(config 指向的是 bundle 不是源码,不重建等于验旧代码)。

### 真机第 2 轮:一个根因解释了全部「起不来」(2026-08-21)

user 真人测试报「点了没反应」后连续修了几处,一路追到**同一个根因**:

`buildGatewayEnv` 返回的是**整份替换**的 spawn env(不继承 `process.env`),却漏了 `HOME` / `XDG_*`。
于是 Gateway 及它拉起的两个 opencode 进程全部回落到系统默认命名空间 `~/.local/share/opencode/`
—— 实测语音库真的生成在了那里。此前所有表象都是它的分身:

| 表象 | 实际成因 |
|---|---|
| `INSERT INTO __new_project_directory` 迁移失败 | 读到旧命名空间里**别的核心版本**写的 `opencode-local.db`,一开就跑迁移 |
| `database is locked` | 同上;且 qwen 会起**两个** opencode 进程(4396 backend server + ACP 宿主)并发碰同一个库 |
| auth 行为诡异 | auth.json 读的是旧命名空间 |

修法 `carryNamespaceEnv()`:`HOME/USER/LOGNAME/SHELL/TMPDIR/LANG` + 四个 `XDG_*` 原样带过去。
qwen 的 env 白名单(`shared/backend-environment.mjs`)本来就放行这些,一路能穿到 ACP 子进程 —— 前提是 Gateway 自己身上有。

命名空间修好后剩下**首次建库竞态**:全新空库上,4396 的 backend server 和 ACP 宿主并发建表,
一方 `CREATE TABLE workspace` / `database is locked` 退出。三处配套改动把它变成自愈:

1. **health 判据升级**:`/api/health` 顶层 `ok` 只代表 3101 活着(qwen 源码原话:"Gateway liveness is
   independent from optional backend readiness")。改为必须 `backend.ok`(或 `code === READY`)——
   否则会出现「报了已开启、用户说话没人应」这种比报错更糟的半死状态。
2. **提前认输**:`waitForHealth` 加 `giveUp` 回调,进程输出里一出现建表/锁冲突就立刻结束这一轮,
   不必干等满 60s(重试其实秒成)。
3. **等它真退干净**:原来 SIGTERM + 固定睡 3 秒就重来,实测退出用了 3.1 秒 —— 新一轮早 100ms 起来,
   3101 端口和 gateway 实例租约还被上一轮占着,第 2 轮秒退、白烧一次机会。改为 `terminate()`
   等 exit(8s 后 SIGKILL)。

**实测(删库模拟首次使用)**:第 1 轮 `database is locked` → 等干净 → 第 2 轮 `acp.initialized`
→ `attempt=2 health=true`,全程 4 秒;`/api/health` 的 `backend.code = READY`、`directory = ~/voice-test`。

#### D-A 的处置:一度让步,当天复议后回到共用

中途因为反复 `database is locked`,`resolveVoiceDbEnv()` 曾把默认改成独立库 `opencode-voice.db`。
**这个让步后来被证明是误判**:那批锁根本不是「共用」造成的,是 spawn env 漏带 XDG 让语音掉进旧命名空间、
开到了别的核心版本写的老库、一开就跑迁移。命名空间修好后,共用的是主实例正在用的、
**迁移早已完成**的库,启动不建表,自然不争排他锁。

2026-08-21 user 拍板「安排的任务要走 DeskFox 通道,并在 session 列表保留会话记录」→ 默认回到共用,
`DESKFOX_VOICE_ISOLATE_DB=1` 保留为逃生口。

**实测(本地版主实例正在跑、有竞争)**:`attempt=1 health=true` 一次就成、零锁冲突;
ACP 宿主 env 为 `OPENCODE_CHANNEL=local`,会话确实落进 `opencode-local.db`;
建会话带 `?directory=` 时 `session.directory` 正确归到 workspace(探针会话已清理)。

#### 同一个洞的第二形态:代理(2026-08-21,user 第 2 次真人测试)

user 报「无法链接 deskfox agent 执行任务」,前端表现是模型说"我无法直接调动本地 Agent"。
取证发现**活其实派出去了**:`/api/tasks` 里 task 存在、objective 正确、`workState=completed`,
`summary` 是 `Failed to authenticate. API Error: 403 Request not allowed`——
模型只是把后端的失败包装成了自己的话。

二分定位(最小 env 起步逐项加回):

| 环境 | 结果 |
|---|---|
| ① 最小 env(白名单 ∩ 我们注入的) | `403 Request not allowed` |
| ② ① + 代理变量 | ✅ 正常回复 |
| ③ ① + 换回非 deskfox 的 XDG | `403`(与 XDG 无关) |

`claude-code/opus` 会 spawn `claude` CLI,这台机器直连 Anthropic 被拒、平时靠代理出去,
而我们整份替换 spawn env 时把代理也一并丢了 —— 与 XDG 那条是**同一个洞的两种表现**。
修法:`NETWORK_ENV_NAMES` 一起 carry(`HTTP(S)_PROXY` / `ALL_PROXY` / `NO_PROXY` 大小写两套 +
`NODE_EXTRA_CA_CERTS` / `SSL_CERT_*`)。注意 `ALL_PROXY` **不在** qwen 白名单里、穿不到 ACP 子进程,
真正管住 `claude` CLI 的是 `HTTPS_PROXY` / `https_proxy`。

另加一条软警告:后端模型要出海(`needsOverseasNetwork()` 判 provider 前缀)但一个代理变量都没有时,
在启动日志里点名"会以 403 收场"。不阻塞 —— 有人本来就直连能通。

**验证**:`ps -E` 确认代理已穿到 gateway 与 ACP 宿主;再直接对 ACP 宿主的 opencode server(4396)
建会话发 prompt,`claude-code/opus` 回了「语音链路通」。配置实测 `model=claude-code/opus`、
`small_model=alibaba-cn/qwen-flash`、`permission.*=allow`。

⚠️ **遗留风险**:DeskFox 从 Dock / Finder 启动时,GUI 进程**不继承** shell 的 `~/.zshenv`,
主进程身上可能本来就没有代理变量 —— 那 carry 也无从 carry。彻底解法是从 Electron
`session.resolveProxy()` 反推,本期不做;当前靠那条软警告暴露。

#### provider 工具透传:一个把「三层架构」整个压平的坑(2026-08-21)

user 追问「语音聊天和派的活是两种 session,现在怎么处理的」,顺着查下去挖出了本期最深的一个洞。

**先摆 qwen 的真实架构**(此前理解错了,以为是两层):

| 层 | 是什么 | 落 opencode session |
|---|---|---|
| 一 | realtime 语音模型(听/说,调 `spawn_thinking`) | 不落 |
| 二 | **coordinator session** —— 常驻,做路由判断 + 顺手干轻活 | 落 |
| 三 | **project session** —— 每个独立工作一条,可 `session_send` 续接 | 落 |

路由规则是 qwen 写死在 `coordinator.mjs:232` 的:新的独立工作 → 建第三层 Session;要继续以前的工作 →
**定位并续接对应的既有 Session**;其余留在协调 Session 执行。配套五个工具
(`session_start` / `session_send` / `session_status` / `sessions_list` / `session_cancel`)
经 MCP 下发给 coordinator。

**但实测第三层从来没起来过**,所有任务都挤在 coordinator 里。逐格打点定位:

| 环节 | 结果 |
|---|---|
| qwen 传 MCP descriptor | ✅ tee 抓到帧:`session/resume` 的 `mcpServers` 含 `qwen_audio_agent` + Bearer token |
| opencode 消费并连接 | ✅ 三次探针(new / resume / 对老 session resume)都主动握手、拉 `tools/list` |
| `MCP.add` 落地 | ✅ 返回 `qwen_audio_agent: {"status":"connected"}` |
| `SessionTools.resolve` 最终表 | ✅ 71 个,含全部 5 个第三层工具 |
| `LLMRequestPrep.prepare` 出口 | ✅ `in=71 out=71 inMcp=54 outMcp=54` —— **一个都没丢** |
| 模型实际看到 | ❌ |

**根因:`claude-code` provider 不把 opencode 的工具透传给 `claude` CLI**,CLI 用的是它自己那套内置工具。
对照实验(同一 server / 同一目录 / 同样 71 个工具,只换 provider,问「有没有 macro_ 开头的工具」):

- `alibaba-cn/qwen-flash` → 「有:macro_box_status」
- `claude-code/opus` → 「没有」

影响面**不止语音**:任何走 `claude-code` 的会话都用不了 MCP 工具(user 的 `macro` 同理)。

**教训**:中途我曾根据「问模型,它说没这个工具」判定工具没挂上 —— 错的。工具明明在表里,模型照样答
「不存在」。**模型的自述不能当判据**,后面全部改用代码打点 + 帧级抓包。

#### A:默认后端模型换成 `alibaba-cn/qwen3.8-max`

`VOICE_MODEL_DEFAULTS.backend` 从 `claude-code/opus` 换成本机可用清单里最强的一档
(106 个可用模型中确认存在)。换完立刻解锁第三层。

**连带必须处理的坑**:光改 model 是**静默失效**的 —— qwen 把 coordinator sessionId 持久化在
`$XDG_CONFIG_HOME/qwaudio/state/acp-sessions.json` 跨重启复用,复用走 `session/resume`,
而 opencode 的 `resumeSession` 是 `restoreFromMessages(messages).model ?? selectDefaultModel(...)`,
**优先从历史消息恢复模型**,配置里的 model 根本轮不到。
新增 fork-only 的 `coordinator-state.ts`:记住上次用的模型,不一致就摘掉那条 coordinator 记录
(只摘 `opencode:` 前缀,不动别的后端,也不动 `projects` 里的第三层记录)。

**真机验证(本地版 + 真实 gateway)**:

```
后端模型 (首次) → alibaba-cn/qwen3.8-max,已作废 coordinator session:opencode:user_personal:backend
```

派一个「新开一个独立的任务」→ `task.delegated` 出现,session 数 +2:

| session | 用过的工具 | 角色 |
|---|---|---|
| `ses_fdcf45e6…` | 只有 `qwen_audio_agent_qwen_audio_agent_session_start` | coordinator,纯路由 |
| `ses_fdcf44230…` | `webfetch` / `bash` / `write`,产出 `wal.md` | 第三层,真干活 |

**交叉追问四轮实测**(同一条 WS 连接,模拟连续语音对话):

```
session_start   ← A 派活(统计文件数)
session_start   ← B 派活(查 WAL 缩写)
session_send    ← A 追问(补每个文件字节数)   ← 续接,未新建
session_send    ← B 追问(补它解决什么问题)   ← 续接,未新建
```

session 数只 +2,落盘内容也证明路由方向正确:`a.md` 追加了字节数、`b.md` 追加了 WAL 解决的问题。
**C 方案(每任务一条 session + 交叉追问)端到端成立。**

附带解决:双前缀命名(`qwen_audio_agent_qwen_audio_agent_session_start`,opencode 的
`<server>_<tool>` 规则撞上 qwen 的同名前缀)**实测不碍事**,模型自己认得出,不需要改 `catalog.ts`,
省掉一笔预估中的 R4。

#### B2:动态 MCP 透传 —— 本来要一笔 R4,最后 0 笔(2026-08-21)

B1(把 opencode **配置文件里声明的** MCP 透传给 claude CLI)只解决一半:qwen 的第三层 Session 工具
是运行时经 ACP `session/new` / `session/resume` 的 `mcpServers` **动态注册**的,只存在于 opencode
进程内存里,配置文件读不到。所以切回 `claude-code` 仍然没有第三层。

原计划走 `packages/opencode/src/session/llm.ts` 的 `_opencode` providerOptions 通道 —— 黑名单,一笔 R4。
**后来发现不必**:wrapper(`deskfox-acp-wrap.mjs`,fork-only)就夹在 qwen 和宿主中间,
**所有带 `mcpServers` 的帧都从它手里过**。在那儿旁路抄一份、用 env 把路径告诉宿主进程里的 plugin,
零上游改动拿到同样的东西,还顺带解耦了两个仓。

- fork 侧:新增 `dynamic-mcp.ts`(纯函数:抽帧 / 拍平 headers-env / 快照比对),
  wrapper 里 `DESKFOX_DYNAMIC_MCP_FILE` 传路径 + 旁路写文件。
  **只观察不加工** —— stdin 方向先原样转发再解析,异常一律吞掉:抓不到顶多少几个工具,
  绝不能反过来搞坏 ACP 本身。
- plugin 侧:`readDynamicMcp()` 读该文件并**后合并**(同名时动态优先,它才带新鲜 token);
  缓存签名改用动态文件内容 —— qwen 每次 register 换新 token,缓存旧的等于给 CLI 一把过期钥匙。

时序风险已排除:`registration.release()` 只在 adapter **shutdown** 时调,不是每轮 turn 结束;
`ensureCoordinatorToolRegistration` 对同一 ownerId 复用同一 registration,token 在网关生命周期内稳定。

**真机验证(生产路径,`DESKFOX_VOICE_BACKEND_MODEL=claude-code/opus`)**:

```
后端模型 alibaba-cn/qwen3.8-max → claude-code/opus,已作废 coordinator session
task.delegated → task.completed
```

| session | 工具 | 角色 |
|---|---|---|
| `ses_fdc5ca503…` | `qwen_audio_agent_qwen_audio_agent_session_start` | coordinator,纯路由 |
| `ses_fdc5c7909…` | `bash` / `webfetch` / `write`,产出 `analyze.md` | 第三层,真干活 |

**claude-code 也有第三层了**,两者兼得。

#### 顺带撞到的:国产模型的内容审查

user 用 `alibaba-cn/qwen3.8-max` 跑的 4 个任务里 2 个失败:

```
InternalError.Algo.DataInspectionFailed: Input text data may contain inappropriate content.
```

是 DashScope 的内容审查(涉国际政治 / 军事条款类被拒),不是我们的 bug。这是换国产模型的代价 ——
B2 落地后可以按话题切模型规避:`DESKFOX_VOICE_BACKEND_MODEL` 一个 env,coordinator 会自动作废重建。

#### 会话列表两件事:派活阈值 + 跨进程刷新(2026-08-21,user 拍板)

user 反馈「刚那次的会话列表里没出现」,并确认 **coordinator 先不隐藏,统一展示**,先把全流程跑通。

**① 提高走第三层的比例**。qwen 的路由阈值偏高:实测「分析今日A股市场盘面」(9 次 macro 调用 +
完整分析)都被判成「其余任务」留在 coordinator。用户不该靠每次说「新开一个独立任务」这种咒语触发。
新增 `VOICE_ROUTING_INSTRUCTIONS`,经 `config.instructions` 拼进 system prompt
(`session/instruction.ts` 支持绝对路径),**不覆盖任何内置 prompt**,只加一段偏好说明:
拿不准就开新的,判据是这件事本身而不是用户说了什么话。
写成「你手里有这类工具时才适用」—— 第三层 session 读同一份 config,没这些工具,读到了也不误触发。

**实测**:不说任何咒语,日常口吻「帮我查一下 SQLite 的 PRAGMA journal_mode…整理成一份 journal.md」
→ `task.delegated`,自动走第三层。

**② 会话列表不刷新**。根因不是 bug 而是架构:语音的 ACP 宿主是**另一个 opencode 进程**,
跟主实例共享同一个 SQLite 但**各有各的 event bus** —— 会话写进去了,主实例收不到任何 session 事件。
跨进程共享 db 而不共享事件,这个缺口只能自己补。

新增 `task-watch.ts`:轮询 gateway 的 `/api/tasks`,任务集合指纹一变就
`webContents.send("deskfox:voice-session-changed")`;renderer 侧(`server-sync.tsx`,FORK 块)
监听后把已打开目录的 sessions query 全部 invalidate。

为什么轮询而不接 gateway 的 WS:realtime 那条连接**有状态**(voice_client 参与输入仲裁 / 播放回执),
挂一个纯观察者进去可能干扰真实语音客户端;`/api/tasks` 是无副作用只读 HTTP,几秒一次本地请求可忽略。
指纹只取「有哪些任务 + 各自状态」,progress 每秒抖动不该让界面闪;首次快照**不算变化**
(刚起网关会一次性读到历史任务,拿它触发刷新等于每次开语音都无谓抖一下)。

**实测**:CDP 注入监听器 → 派活 → renderer 收到 2 次事件(accepted / completed 各一次)。

#### 唤醒词:默认开,"对话中不用重复喊"(2026-08-21 user 需求)

user:「不唤醒的时候不妨碍日常沟通,想跟他沟通的时候才叫」+「对话进行中不需要重复唤醒,
静默一段时间后才需要」。拍板**沿用「你好千问」**(不换成「小帅」),保持提示文案一致。

qwen 侧的现状:`QWEN_AUDIO_WAKE_WORD_ENABLED` 默认 **false** —— 也就是麦克风一开就一直在听,
正是 user 想解决的。`sleepTimeoutMs`(来自 `QWEN_AUDIO_DESKTOP_AUTO_HIDE_SECONDS`)默认 **0 = 永不自动休眠**,
唤醒一次就一直活跃,对"别打扰日常对话"同样没用。两个都要给值。

`resolveWakeWordEnv()`:默认开唤醒词 + 静默 180 秒回休眠。
「对话中不用重复喊」不需要额外实现 —— qwen 的 `sleepController` 每次输入都 `recordActivity()` 重置计时,
只要还在说话就一直活跃。`DESKFOX_VOICE_SLEEP_SECONDS` 可调,`DESKFOX_VOICE_WAKE_WORD=off` 整个关掉。

**为什么默认开是安全的**:模型(sherpa-onnx KWS)创建失败会走
`realtime-gateway.mjs:1670` 的 catch —— `sleepController.disable()` + 发一条「休眠功能未启用:…」,
**不影响语音本身**。

⚠️ 唤醒词文案在 qwen 里**硬编码**为「你好千问」(`core/config.mjs:490`,无 env 覆盖),
实际检测认的是模型目录下的 `keywords.txt`。想换词得同时改 keywords.txt,但提示文案仍会说「你好千问」,
且改 `node_modules` 升级即失 —— 这是 user 选择沿用原词的直接原因。

**模型安装(一次性,已完成)**:qwen 自带的 `ensureWakeWordModel` 走 fetch 直连 GitHub,
32MB 下到 19MB 就 `The operation timed out`。改用 `curl -C -` 续传下完,
sha256 与 `WAKE_WORD_MODEL_SHA256` 完全一致。
装的时候踩了一个坑:`ensureWakeWordModel` 会在配置目录下**再加一层模型名**
(`resolve(directory, WAKE_WORD_MODEL_NAME)`),直接铺在 `wake-word/` 下它看不见。
放对位置后 `ensureWakeWordModel` **0ms 直接复用、不再联网**。
`keywords.txt` 不在归档里(qwen 自己写),内容照抄它的原文 `n ǐ h ǎo q iān w èn @你好千问`。

#### 本轮遗留

- **`voice-e2e.mjs` 灌音频无反应**:装置连上 WS 后直接灌音频,没发 configure;日志里只有
  `voice_client.connected`、没有 `configured`(WebUI 客户端两条都有)。是装置的握手缺一步,
  不是产品链路 —— T15 由真人对着真麦克风覆盖,装置待补。
