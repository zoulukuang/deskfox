---
feat-id: telemetry-usage-stats
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# telemetry-usage-stats — 1-spec

> **匿名使用统计(数据安全前提下的最小采集)**:把"使用情况 / 升级情况 / 版本与地理分布"接进**主力 Tauri 端**,opt-out + 全程匿名 + 城市级地理(IP 用完即丢)。同时清理 2026-04 遗留的 telemetry SDK 冗余升级检查。

## 需求来源

2026-06-06 user 提出"想知道软件每天使用情况、升级情况、版本分布",并明确产品**主打数据安全**,统计必须在"对用户安全 + 满足运营"之间取平衡。

调研发现(见本目录无 2-plan 前的对话链 / `chore/research-telemetry-stats` 调研结论):
- 2026-04-30 已自建一套 `@opencode-ai/telemetry` SDK(Phase C1/C3),但**只接在不出货的 Electron 备选端**,主力 Tauri 端零接入 → **实际从未生效**。
- SDK 里**附带一套老式升级检查**(`update_check.ts`:检查→弹窗→引导去下载页),与 2026-06-06 落地的 **Tauri 原生 updater**(自动下载+minisign 验签+安装重启)功能重叠,是遗留死代码。
- 统计后端 Plausible(`telemetry.deskfox.ai`)目前 **502** 未在跑。

### user 已拍板的决策(本 spec 的输入)

| # | 决策 | 取舍 |
|---|---|---|
| 1 | **自动升级**保留 Tauri 原生方案,删 SDK 里冗余的 update_check | Tauri 方案在体验(自动装)和安全(minisign 验签)上完胜 |
| 2 | **统计后端**修现有 Plausible(不自建) | 复用已部署东京机;客户端上报沿用 Plausible `/api/event` 格式 |
| 3 | **不用心跳**算使用时长 | 心跳=持续信号,与"数据安全"品牌相悖 |
| 4 | **放弃精确使用时长**,改用 DAU + 日启动次数代理活跃度 | 时长指标天然需要持续信号,与取向冲突 |
| 5 | **采集姿态 = opt-out**:默认开,设置→通用 放开关一键关 | 开源主流做法;首启明确告知 |
| 6 | **地理做到城市级 + 省份级**(底层存城市标签,看板省份汇总 / 城市下钻) | 粗粒度地理非 PII;红线是不存 IP |
| 7 | **IP 用完即丢、不持久化**(因要城市级,从加分项升为硬要求) | 数据库只存"深圳"标签,绝不存原始 IP |
| 8 | **install_id 不做轮换** | 留存指标可算;接受跨周期可关联同一匿名 ID |
| 9 | 更新隐私政策,逐项写明全部投递项 | 开源 → 代码可审计,必须诚实透明 |

## 验收标准

| ID | 场景 | 期望 |
|---|---|---|
| **A1** | 首次启动 DeskFox(opt-out 默认开) | 上报一条 `app_open`;首启有明确告知(收哪些匿名数据 + 如何关) |
| **A2** | 设置→通用 关闭"匿名使用统计"开关 | 立即停止上报;此后任何事件都不发网络;配置持久化,重启仍关 |
| **A3** | 关闭后重新打开开关 | 恢复上报 |
| **A4** | `OPENCODE_TELEMETRY=0` 环境变量 | 无论 UI 开关如何,强制禁用(env 优先级最高) |
| **A5** | 触发一次自动升级(下载完成 / 安装重启) | 上报 `update_downloaded` / `update_applied` |
| **A6** | 任意一条事件 | 携带字段仅:`version` / `os`(大类)/ `arch`(大类)/ `install_id`(匿名);**不含**任何文件路径 / prompt / 模型名 / 用户身份 |
| **A7** | 后端看板 | 能看到 DAU、日启动次数、版本分布、平台(os/arch)分布、地理(省份汇总 + 城市下钻) |
| **A8** | 后端数据库 | **不存在**任何原始 IP 字段;只有地理标签 |
| **A9** | 网络不通 / 后端 502 | 上报静默失败,**绝不阻塞或崩溃**主程序;不弹错 |
| **A10** | 清理后 | `update_check.ts` 等遗留升级检查代码移除;Tauri 原生 updater 行为不受影响 |

## 采集字段清单(可直接用于隐私政策)

### 事件(3 个动作)
| 事件 | 含义 |
|---|---|
| `app_open` | 软件启动一次(→ DAU + 日启动次数) |
| `update_downloaded` | 下载了一个更新 |
| `update_applied` | 应用更新并重启 |

### 每条事件附带字段
| 字段 | 实际值举例 | 粒度 / 为什么安全 |
|---|---|---|
| `version` | `2026.6.0` | DeskFox 版本号,非个人信息(→ 版本分布) |
| `os` | `darwin` / `win32` / `linux` | 仅操作系统大类,**不含系统版本号**(非 macOS 14.5) |
| `arch` | `arm64` / `x64` | 仅 CPU 指令集架构,**不含 CPU 型号 / 核数 / 序列号** |
| `install_id` | 随机 UUID | 本地生成、匿名、仅用于 DAU 去重;不绑邮箱/用户名/机器名 |

### 后端(Plausible)侧
| 项 | 处理方式 |
|---|---|
| 请求时间戳 | 按天聚合 |
| **IP** | 仅落地瞬间用于 GeoIP 推断地理 → **立即丢弃,不持久化**;不入库 |
| 地理标签 | 入库:省份 + 城市级(如"广东 / 深圳") |
| User-Agent | `opencode-desktop/<version> (darwin; arm64; install=<短ID>)` — 重复带 version/os/arch/短 install_id,隐私政策需一并列明 |

### 明确不采集(数据安全红线)
文件路径 / 项目名 / 目录 · prompt 内容 / AI 对话 / 代码 · 模型名 / API key / provider 配置 · 用户名 / 邮箱 / 机器名 · 存储原始 IP · 设备指纹(分辨率+CPU+MAC 组合)· 精确行为时间序列 · `project_open` / `ai_request` 行为事件。

## 架构选型(⚠️ 核心决策,需 user 审签)

### 背景约束
现有 `packages/telemetry` SDK 是 **Node/Bun 实现(`node:fs`)**。主力 **Tauri 端前端是 WebView 浏览器环境,无法加载该 SDK**。当初能用是因为只接 Electron(Node 环境),而 **fork 不 ship Electron**。所以"复用现有 SDK 客户端"在 Tauri 端不直接成立。

### 三方案对比

| 方案 | install_id 持久化 | 网络上报 | app_open 时机 | update 事件 | SDK 复用度 | 选 |
|---|---|---|---|---|---|---|
| **A 前端 WebView 发** | localStorage / Tauri store(弱) | WebView fetch | 前端 mount | 需前端感知 updater | 低(SDK 用不了,要写浏览器版) | ❌ |
| **B Rust 侧原生发(推荐)** | Rust 写 `~/.cache/opencode/install_id`(稳,复用 SDK 路径格式) | Rust `reqwest`(已有依赖) | Rust 启动钩子(最准) | **本就在 Rust updater 流程内** | 仅设计参考 | ✅ |
| **C sidecar(Bun)发** | SDK 原样 | SDK 原样 | sidecar 启动(生命周期错位) | 错位 | 高(SDK 可直接用) | ❌ |

### 推荐 B(Rust 侧原生),理由
1. Rust 端已有 `reqwest`(`feishu_adapter.rs` 在用),网络上报零新依赖。
2. `update_downloaded`/`update_applied` 本就发生在 Rust updater 流程,顺手 emit。
3. `install_id` 文件持久化在 Rust 最稳,可复用 SDK 既定路径 `~/.cache/opencode/install_id`。
4. `app_open` 在 Rust 启动钩子触发,时机最准、最不受前端路由影响。
5. opt-out:前端设置写 config → Rust 读 config(+ env `OPENCODE_TELEMETRY` 优先)。

### 对现有 SDK / Electron 的处置(随选型而定)
- 选 B 后,SDK 客户端代码在 Tauri 端用不上,**降级为设计参考**(字段、Plausible 格式、opt-out 优先级逻辑)。
- **Electron 端 telemetry 集成删除**(不出货,无影响)。
- `packages/telemetry` 包:**整包删除**(user 2026-06-06 拍板选项①)。Rust 成为唯一客户端,杜绝"两套客户端"认知混乱;删前 grep 确认仅 Electron 引用;SDK 的字段/Plausible 格式/opt-out 优先级逻辑作为 Rust 实现的**设计参考**(照搬不照抄)。

## 关键技术决策

- **D1 opt-out 默认开**:config 默认 enabled;env `OPENCODE_TELEMETRY=0` > UI 开关 > 默认。设置→通用 (`settings-general.tsx`) 加开关。
- **D2 地理城市级 + 不存 IP**:Plausible 自托管挂城市级 GeoIP 库(MaxMind GeoLite2-City 或 DB-IP City,免费);确认 Plausible 配置为 IP 用完即丢。
- **D3 放弃使用时长**:不发心跳,不发 session_end;用 `app_open` 次数 + install_id 去重得 DAU / 启动次数 / 活跃天。
- **D4 删冗余升级检查**:移除 `update_check.ts` + `notice.ts` 升级文案 + Electron update strategy;Tauri 原生 updater 是唯一升级路径。
- **D5 install_id 不轮换**:固定匿名 UUID。
- **D6 上报失败静默**:网络/后端异常一律吞掉,绝不影响主程序(同 SDK 既有"telemetry 永不 crash host"原则)。

## 改动落点(预判,细化在 2-plan)

| 文件 / 区域 | 性质 | 改动 |
|---|---|---|
| `packages/desktop/src-tauri/src/telemetry.rs`(新) | 新 | Rust 统计模块:install_id 读写 + config 读 + 事件 POST(reqwest)+ 静默失败 |
| `packages/desktop/src-tauri/src/lib.rs` | 改 | 启动钩子 emit `app_open`;updater 流程 emit `update_*`(≤5 行注入,加 FORK marker) |
| `packages/desktop/src-tauri/src/cli.rs` | 改 | `OPENCODE_TELEMETRY` env 读取(可能已部分有) |
| `packages/app/src/components/settings-general.tsx` | 改(上游) | 设置→通用 加"匿名使用统计"开关 + 写 config |
| `packages/desktop-electron/src/main/telemetry*.ts` | 删 | Electron telemetry 集成移除 |
| `packages/telemetry/`(整包) | 删 / 改 | 审签项①整包删 / ②删 update_check |
| 隐私政策 `docs/legal/隐私协议.md` | 改 | 逐项写明投递清单 + IP/UA/地理处理 |
| 后端 Plausible(运维,非仓库) | 配 | 排查 502 + 挂城市级 GeoIP + 确认不存 IP |

## 隐私政策更新要点
逐项列明:① 3 个事件 ② 字段 version/os(大类)/arch(大类)/install_id(匿名) ③ User-Agent 携带内容 ④ "从 IP 推断地理位置后立即丢弃 IP,不存储 IP" ⑤ 地理粒度到城市 ⑥ 明确不采集清单 ⑦ 如何关闭(设置开关 + env)。中英两版。

## R 合规预判
- **R1** 三级跳:统计逻辑走**新文件** `telemetry.rs`,上游文件仅 `lib.rs`/`settings-general.tsx` ≤5 行注入(符合 2 级)。
- **R2** FORK marker:`lib.rs`/`cli.rs`/`settings-general.tsx` 改动处加。
- **R3** 不涉及品牌/主题硬编码。
- **R4** 黑名单:`settings-general.tsx` 是否在 pre-commit 路径黑名单需在 2-plan 核;若是则走 override 二次确认。`packages/opencode/` 黑名单本 feat 不碰(统计走 desktop)。
- **R5/R8** 见下测试用例清单(Medium+ 必须动工前列出)。
- **R6** 网络监听:本 feat 是**出站** POST,不新增 `Bun.serve`/`listen`,不触发 R6。

## 测试用例清单(R8,动工前定)

| ID | 验什么 | 层级 | 预期 |
|---|---|---|---|
| **T1** | install_id 生成 + 持久化幂等 | unit(Rust) | 首次生成 UUID 写文件;二次读同一值 |
| **T2** | opt-out 优先级:env=0 强制禁用 | unit(Rust) | env 设 0 时 enabled()=false,无视 config |
| **T3** | opt-out:config disabled | unit(Rust) | config telemetry=false → 不上报 |
| **T4** | 事件 payload 字段白名单 | unit(Rust) | 序列化结果只含 version/os/arch/install_id,无多余字段 |
| **T5** | os/arch 是大类不是细节 | unit(Rust) | os ∈ {darwin,win32,linux};arch 不含型号串 |
| **T6** | 上报失败静默不 panic | unit(Rust) | 注入 fail 的 http → 函数正常返回,不 panic |
| **T7** | 设置开关写 config 持久化 | e2e / 组件 | 关开关 → config 文件 telemetry=false |
| **T8**·native | 真桌面:首启发 app_open + 首启告知 | Phase 2 真桌面 | 后端收到 app_open(运行时·native 风险点) |
| **T9**·native | 真桌面:升级流程 emit update_* | Phase 2 真桌面 | 触发 updater → 收到 update_downloaded/applied |
| **T10** | 后端无原始 IP 字段 | 后端验证 | Plausible 库内无 IP 列,只有地理标签 |
| **T11** | 删 update_check 后 Tauri updater 不受影响 | 回归 | updater verify 仍绿(`verify-updater-artifacts`) |

> ·native = 运行时/真桌面风险点,CDP 自测覆盖不到,需真 .app 手测或 Phase 2 e2e(对照"CDP 自测 ≠ 真桌面 QA")。

## 风险与缓解
| 风险 | 缓解 |
|---|---|
| Rust 重写统计逻辑引入 bug | 核心逻辑(install_id/opt-out/payload)纯函数化 + 单测覆盖(T1-T6) |
| `settings-general.tsx` 命中 pre-commit 黑名单 | 2-plan 先核;若命中走 R4 override 二次确认(复核报告) |
| Plausible 502 修不好 / GeoIP 配置失败 | 排查列为实施第一步;客户端先做但功能开关默认关到后端就绪;后端不通时 A9 保证不影响主程序 |
| 删 SDK 包误伤 CLI/其他引用 | 删前 grep 全仓引用(仅 Electron 引用,已确认);保留 git 历史可回退 |
| 地理城市级被质疑隐私 | 隐私政策重点写"不存 IP";开源代码可审计佐证 |

## 工程量估算
- Rust 统计模块 + lib.rs 注入(~150 行 + 单测 ~80 行)— 1-1.5 天
- 设置开关 + config 读写(~40 行)— 0.5 天
- 删 Electron 集成 + SDK 处置(~净删)— 0.5 天
- 后端 Plausible 502 排查 + GeoIP 配置(运维)— 0.5-1 天(不确定性最高)
- 隐私政策中英更新 + 三文档 + INDEX(~300 行文档)— 0.5 天

**总:~3-4 天**,Medium 规模(代码 ~230 行 + 文档 ~300 行;上游文件触动 2-3 个,未达 Large 的 ≥5)。

## 审签结论(2026-06-06 user 已签)

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 架构选型 | ✅ **B(Rust 侧原生)**。接受现有 Node SDK 在主力端不复用(仅设计参考)。升级保留 Tauri 原生,SDK 内 update_check 随整包删除自动移除。 |
| 2 | `packages/telemetry` 处置 | ✅ **整包删除**(选项①)。Rust 为唯一客户端。 |
| 3 | 发布策略 | ✅ **客户端先开发 + 后端并行修复**(东京机已配好,用现有 SSH 访问);**全部前后端完成前不合主分支**;user 稍后提供统计看板链接供验证。 |
| 4 | 隐私政策 | ✅ 中英两版都更新。 |

签字完成,进入 2-plan + 实施。
