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

### 回退方法

一个 env 整体退回现方案,**不需要改代码或重新打包**:

```
DESKFOX_VOICE_LEGACY_BACKEND=1
```

旧链路的全部代码(wrapper / env carry / journal / coordinator-state / task-watch)本笔**一行未删**,
按 1-spec §6 留到验收通过后单独一期清理。

单笔 revert:`git revert <hash>`(P4:一笔 commit 干一件事)。
