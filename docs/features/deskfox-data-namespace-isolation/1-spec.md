feat-id: deskfox-data-namespace-isolation
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# DeskFox 运行期数据命名空间隔离(与上游 opencode 分家)

> 规模:**Large**(触碰全量用户数据路径 + 一次性迁移)→ 1-spec 需 user 审签后锁版。
> **✅ 已审签(2026-07-12,user 拍板)**:D1=a 共享 deskfox 命名空间 / D2=a 非破坏 copy / D3=本期不动飞书 `~/.opencode`。核心厘清(上游收益靠 code merge、不靠共用 runtime DB)已认可。本文锁版,后续只补不改。
> 起源:2026-07-12 Intel 真机报「任意模型连不上」,真因 = DeskFox 与用户另装的**上游 OpenCode 桌面端**共用同一 `~/.local/share/opencode/opencode.db`,两个不同版本核心 schema 打架(`no such column: replacement_seq / revision`)必崩。参照 MiMo(小米 opencode fork)做法核验。

## 1. 背景与真因(已核验)

DeskFox 沿用上游 opencode 的运行期命名空间,三处**全和任何 opencode 实例共享**:

| 命名空间 | 内容 | 本机体量 | 由谁决定 |
|---|---|---|---|
| `~/.local/share/opencode/`(XDG_DATA) | `opencode.db`(+channel db)、`auth.json`、repos、log | **1.2G** | `Global.Path.data = xdgData/"opencode"`(core `global.ts`,`app="opencode"` 常量) |
| `~/.config/opencode/`(XDG_CONFIG) | `opencode.jsonc`、tui | 6.7M | `Global.Path.config = xdgConfig/"opencode"` |
| `~/.opencode/`(硬编码 homedir) | 飞书 `feishu-config.json` / `feishu-plugin-server.json` / imbot-workspace | 317M | fork 飞书插件硬编码 `join(homedir(),".opencode",...)` |

desktop 目前**只**把 `XDG_STATE_HOME` 设成 per-app(`sidecar.ts:89`),`XDG_DATA_HOME`/`XDG_CONFIG_HOME` 均不设 → data/config 落共享默认。

**冲突后果**(同机另装上游 OpenCode 时):
- **主症状**:两个不同版本核心共用一个 `opencode.db` → migration 版本错位 → `no such column` 每次调模型必崩(本次 Intel 报障根因)。
- 次症状:两 app 共读 `opencode.jsonc` → 都加载 feishu/media-gen 插件 → 端口 `EADDRINUSE`、`feishu-plugin-server.json` 互覆、飞书 WSS 双连接。

## 2. 目标 / 非目标

**核心厘清(2026-07-12 user 拍板认可)**:「跟紧上游、享受上游收益」的**唯一**来源是**源码 merge 上游**(功能/修复/**DB schema 迁移**都靠把上游代码 merge 进 fork 得到);**运行期共用数据目录对此贡献为 0**,只带来冲突负债。schema 迁移收益 = 我们(已 merge 上游的)核心在**我们自己的 DB** 上跑迁移,不需要跟上游 install 共用 DB 文件。

- **目标**:DeskFox 运行期数据/配置命名空间与上游 opencode **分家**,消除同机共存冲突;**现有用户数据零丢失**(一次性迁移)。
- **非目标(明确不动)**:
  - **CODE 层上游跟随工作流一字不改**(照常 merge upstream/dev)—— 这是上游收益来源,不受影响。
  - 不改上游 core 文件(尤其**不改** `global.ts` 的 `app="opencode"` 常量)—— 靠 fork-only 的 env 注入实现隔离,避免每次 merge 冲突(与 MiMo 直改 core 常量的高冲突路线相反)。

## 3. 方案(fork-only env 注入,不碰上游 core)

在 `sidecar.ts` 的 `prepareSidecarEnv`(已设 `XDG_STATE_HOME`)**增设 `XDG_DATA_HOME` + `XDG_CONFIG_HOME`** 指向 DeskFox 专属根。core 仍 `path.join(xdgData,"opencode")`,故实际落 `<deskfox根>/opencode/...` —— 与 `~/.local/share/opencode` 物理分家。

### 关键决策(已审签锁定 ✅)

**→ 落定:D1=a(共享 deskfox 命名空间)· D2=a(非破坏 copy)· D3=本期不动飞书。** 下表保留备选对照。

**D1 — 隔离根目录选哪个:【选定 a】**
| 选项 | XDG_DATA_HOME 设为 | 结果 | 取舍 |
|---|---|---|---|
| **D1-a(推荐)共享 deskfox 命名空间** | `~/.local/share/deskfox`(config 同理 `~/.config/deskfox`) | 全 DeskFox 渠道(prod/dev/beta/local)仍共享一份、但整体搬出 opencode 命名空间 | 行为改动最小(只"平移"),彻底隔离上游;`deskfox/opencode/` 叶子稍丑但无害 |
| **D1-b 每渠道 per-appId 隔离** | `<userDataPath>`(= `~/Library/Application Support/ai.deskfox.app` 等,与 XDG_STATE 同源) | prod/dev/beta/local **各自独立** data/db | 额外收益:发布三档**从此可共存、不必互杀**(现规范"三档共享 db 不能共存"随之作废);但行为改动更大、需同步改 CLAUDE.md 杀进程矩阵 |

**D2 — 迁移策略(现有用户 1.2G 数据):**
| 选项 | 做法 | 取舍 |
|---|---|---|
| **D2-a(推荐)非破坏性 copy** | 首启若 deskfox 根空且 opencode 根有数据 → **copy** 过来,保留原 opencode 目录不动 | 安全(不动上游/CLI 的数据);代价临时占盘翻倍(~1.2G),迁完可选清理 |
| D2-b move | 直接搬走 | 快、不占双份;但若用户也用上游 opencode/CLI,会**偷走它的数据** → 破坏,不可取 |

**D3 — 迁移范围:**
- **必迁**:XDG_DATA(`opencode.db` + 各 channel db + `auth.json`)、XDG_CONFIG(`opencode.jsonc`)。
- **待定**:`~/.opencode/`(飞书,硬编码)—— 它与**上游**不冲突(上游无飞书),只在 DeskFox 多实例间互扰;是否本期一并搬到 `~/.opencode` → deskfox 专属?**建议本期不动**(降风险,单独 follow-up),但迁移要保证飞书 `feishu-config.json` 绑定不丢。

## 4. 验收标准

1. 全新环境装 DeskFox + 另装上游 OpenCode → 两者**各自独立 DB/config**,DeskFox 调模型不再 `no such column`,飞书插件端口不冲突。
2. **现有用户升级**:升级后会话历史、API key、opencode.jsonc、飞书绑定**全部保留**(首启迁移生效),无需重配。
3. 迁移**幂等**:重复启动不重复迁移、不覆盖已改数据(迁移标记)。
4. 迁移**失败可回退**:迁移出错时保守不切换(仍用原 opencode 命名空间)+ 明确日志,不静默丢数据。
5. CODE 层上游 merge 工作流不受影响(仅 fork 文件 env 注入,0 改上游 core)。
6. 未装上游 opencode 的普通用户(绝大多数):升级平滑无感,数据照旧可用。

## 5. R8 测试用例清单(动工前锁定)

| # | 验什么 | 层级 | 预期 |
|---|---|---|---|
| TC-1 | `resolveDeskfoxDataHome`(纯函数)按 env 派生正确路径 | unit | 各分支路径正确、绝对路径校验 |
| TC-2 | 迁移决策纯函数:空目标+有源→迁;目标已有→跳;源无→跳 | unit(≥3) | 幂等 / 不覆盖 |
| TC-3 | sidecar env 注入 XDG_DATA/CONFIG_HOME | unit | 值 = 预期 deskfox 根 |
| TC-4 | 首启迁移 e2e:预置旧 opencode 目录 → 启动 → 新目录含 db/auth/jsonc,原目录保留 | e2e | 数据到位 + 非破坏 |
| TC-5 | 幂等:再启动不重复迁移 | e2e | 标记生效、秒跳 |
| TC-6 | **真机**:同机 DeskFox + 上游 OpenCode 并存,DeskFox 调模型成功、飞书插件不撞端口(Intel 报障场景复现验证) | 真机 QA | 不崩、无 EADDRINUSE |
| TC-7 | 现有真机升级:老用户数据全保留 | 真机 QA | 会话/key/绑定在 |

## 6. 风险

- **全量用户数据路径变更**:迁移必须极稳(D2-a 非破坏 + 迁移标记 + 失败保守回退),否则整批用户丢数据。→ 首启迁移是本 feat 最高风险点,需真机双轮验证(stale 升级 + 全新装)。
- **磁盘占用**:D2-a copy 临时翻倍(1.2G),低配机需评估;迁完可加"验证后清理原目录"选项(但涉上游共存判断,保守默认不删)。
- **channel 行为**(仅 D1-b):改动发布三档共存语义,须同步 CLAUDE.md 杀进程矩阵 + 规范。

## 7. 参照:MiMo(小米 opencode fork)怎么做的

`packages/shared/src/global.ts`:`const APP = "mimocode"`(直接改核心常量,命名空间 → `~/.local/share/mimocode`)+ `MIMOCODE_HOME` 整体根 override;desktop `XDG_STATE_HOME=userData`;**无迁移**(全新产品冷隔离)。

我们与 MiMo 的差异(更优):① **不改上游 core 常量**(靠 fork env 注入,merge 上游零冲突,MiMo 那样改 core 每次 merge 都要处理);② **带首启迁移**(我们有存量用户住在 opencode 命名空间,不能冷切)。
