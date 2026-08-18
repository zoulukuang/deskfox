feat-id: voice-preclear-batch
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 语音派活前置清障批(REQ-084① / REQ-117 / submit.test 修复 / i18n 工程化 / REQ-068 归档)— 1-spec

> **来源**:OPENCODE-PLAN `需求计划/2026-08-18-语音派活前置清障-已完成.md`。本文档是它的 fork 侧开发文档化 ——
> **2026-08-18 已对当前 HEAD(main `2cb59f69d7`)逐条核实全部断言与代码锚点**,核实结果与勘误见 §7,
> 其中 S3 根因已在核实过程中直接定位到行级,施工不需要再调研。
> **规模分级:Large**(S1 为 Medium 主体 + S4 触动全部 ~50 个上游 i18n 文件)→ 按规范 v2,**动工前本 spec 需 user 审签**。
> **2026-08-18 收口锁版**:D1/D2 user 明示同意推荐;D3/D4 user 授权收口、按推荐采纳 —— 四项拍板齐,
> spec 按规范锁版(只补不改)。**待 user 开工令后转 in-progress 施工**(user 已要求:正式开发前先通知)。
> **本批不发版**。交付物 = 语音派活(REQ-102 S1)动 `plugin/index.ts` / `acp.ts` 两处 L0 内核前的
> 可信测试护栏(S2/S3)+ 还清已破损的硬约束(S1)+ 顺手清掉的工程化小债(S4)+ 台账对齐(S5)。

## 1. 背景(一句话版)

fork 已随 2026.10.0 把 core 升到 1.18.16,但 REQ-103 §3 写死的强绑定「升级 + REQ-084① 迁移污染检测,
缺一不可」只兑现了前半 —— 检测全仓零实现,风险窗口开着(S1);performance e2e 组 6 条稳定失败 + flaky
一族,护栏已失效且 R5「flaky 48h 内修或移除」已逾期(S2);提交链路唯一的单测文件加载即挂,零覆盖(S3);
另有 4 文件 CRLF、23 个死 i18n key、REQ-068 归档漂移三条静态债(S4/S5)。

## 2. IN SCOPE

| 子项 | 内容 | 优先级 | 规模 | 主要触点 |
|---|---|---|---|---|
| S1 | REQ-084① 迁移污染检测(超前 schema db 不迁 / 已污染隔离自愈) | P1 | Medium | `packages/desktop/src/main/deskfox/`(fork-only 新文件为主) |
| S2 | REQ-117 performance e2e 套件复活(A 族 ×3 + B 族 ×3 + flaky 收口 + 规范定位) | P1 | Medium | `packages/app/e2e/performance/` + `docs/governance/自动化测试规范.md` |
| S3 | `submit.test.ts` 加载即挂修复(根因已定位:mock 缺具名导出) | P2 | Tiny | `packages/app/src/components/prompt-input/submit.test.ts` |
| S4 | i18n 工程化:CRLF 归一化(`.gitattributes`)+ 23 个死 key 清理 | P3 | Tiny×2 | 仓根 `.gitattributes` + `packages/app/src/i18n/*.ts` |
| S5 | REQ-068 归档 + **fork 侧文档回填**(范围较原计划扩大,见 §7 勘误③) | P3 | docs | `docs/features/stale-path-hardening/` + OPENCODE-PLAN |

## 3. 分项需求与架构选型(锚点已核实,2026-08-18)

### S1 · REQ-084① 迁移污染检测

**风险场景**(REQ-084 原文):用户同机装上游 opencode 且上游先升到 > fork core(1.18.16)版本,把共享
`~/.local/share/opencode/opencode.db` 迁成超前 schema;之后装/升 DeskFox → 首启迁移
(`data-namespace.ts` `applyDeskfoxDataNamespace`)把超前 db copy 进 deskfox 命名空间 → core 打不开
(`no such column/table`)→ sidecar 起不来且无自愈(marker 已写,重启仍读污染 db,永久坏)。

**核实到的技术底盘(改变了方案权衡,见 §7 勘误①)**:

- core 1.18.16 的迁移 journal = **`migration` 表**(`id TEXT PRIMARY KEY`),id 即
  `packages/core/src/database/migration/` 下的目录名(`YYYYMMDDHHMMSS_<slug>` 形态,共 66 个,
  清单见 `migration.gen.ts`);老库兼容:`migration.ts:52-66` 会把 legacy `__drizzle_migrations.name`
  seed 进 `migration` 表(这些 legacy 名**不是** 14 位时间戳形态)。
- core 自带 `sqlite.node.ts`,用的是 **Node 内置 `node:sqlite`(`DatabaseSync`)** —— Electron 42 的
  Node 运行时可用。**REQ-084 原文「方案 A 需新增 better-sqlite3 native 依赖」的顾虑已过时**,
  desktop 主进程零新依赖即可只读打开 db。

**选型:方案 A′ = migration 基线比对,同一判定跑两处**(比 REQ-084 原 A/B 二选一多覆盖「历史遗留」):

1. **迁移期(防未来)**:`applyDeskfoxDataNamespace` copy 前只读打开旧共享 db,读 journal,
   与烤进 desktop 的基线清单比对;判超前 → **该 db(及 wal)不迁**,auth/config/其余照迁,
   marker 照写(reason 记 `db-quarantined`),启动后 toast 告知。超前 db 本来 fork core 也读不了,不算丢。
2. **启动期(识别历史遗留 + 自愈)**:每次启动、sidecar 拉起前,对 deskfox 命名空间内的 db 跑同一判定;
   判超前 → 挪走 `opencode.db.incompatible-<ts>`(保留不删)→ 空库起 + toast。
   覆盖两类存量:风险窗口开着期间已被迁入的污染 db;以及吸收原方案 B 的自愈价值,免其字符串匹配复杂度。

**判超前的判定规则**(处理 legacy 名,避免误报):journal id 中只看匹配 `^\d{14}_` 的时间戳形态 id;
存在**基线清单之外**的时间戳形态 id 即判超前。legacy(`__drizzle_migrations` seed 来的非时间戳名)一律忽略
—— 老库天然带这些,不是超前信号。空库 / 无 journal 表 / db 打不开 → 判「未知但不拦」(fail-open,
与现状等价,绝不能因检测本身把好库拦了)。

**实现骨架(P1 隔离:fork-only 新文件为主)**:

| 文件 | 性质 | 内容 |
|---|---|---|
| `deskfox/migration-baseline.generated.ts` | 新增(生成物,提交入仓) | `MIGRATION_BASELINE: string[]`(66 个 id) |
| `scripts/gen-migration-baseline.mjs` | 新增 | 从 `packages/core/src/database/migration/` 目录名生成上面文件;**另带 `--check-upstream` 模式**(2026-08-18 user 提议,细化为信号制拍板):对比上游仓 migration 目录清单 vs fork 基线,输出「上游领先 N 条」,接入发版 SOP 作为「是否该排上游同步」的信号 —— **不是**发现变化就当场兼容/阻断发版(兼容只有升内核一条路,不与发版挤同一窗口;检查失败不阻塞,标注即可) |
| `deskfox/db-schema-guard.ts` | 新增(Logic 清单) | 纯函数:`assessJournal(ids, baseline)` → `compatible / ahead / unknown` |
| `deskfox/db-schema-guard-io.ts` | 新增 | IO 壳:`node:sqlite` 只读读 journal(driver 可注入,单测用 `bun:sqlite`)+ 隔离挪档 |
| `deskfox/data-namespace.ts` | 修改(fork-only 文件) | copy filter 接入迁移期判定 |
| `main/index.ts`(或现调用点) | 修改(上游文件,FORK marker) | 启动期检查接线 + toast 通知(≤5 行注入,走 R1 第 2 级) |

**R8 测试用例清单**(动工前锁定):

| # | 验什么 | 层级 | 预期 |
|---|---|---|---|
| T1 | `assessJournal`:基线子集 / 空 / 仅 legacy 名 / 超前 id / 混合 五类输入 | unit(行覆盖 ≥80%,Logic 清单) | 仅含超前时间戳 id 时判 ahead |
| T2 | baseline 生成物与 `packages/core/src/database/migration/` 目录实时清单一致(drift 闸,防上游 sync 后忘更新) | unit | 不一致即红 |
| T3 | IO 壳:真 sqlite 文件(`migration` 表 / 仅 `__drizzle_migrations` / 无表 / 损坏文件)读取 | unit(注入 `bun:sqlite`) | 四态正确,损坏→unknown 不 throw |
| T4 | 迁移期:旧 ns 造超前 db(插 `99991231235959_pollution_probe`)→ 迁移 | unit(planNamespaceMigration 层)+ 真机脚本 | db 不迁、auth/config 在、原共享 db 无损、app 正常起 |
| T5 | 启动期历史遗留:deskfox ns 内超前 db + marker 已写 → 启动 | 真机脚本 | db 挪成 `.incompatible-<ts>`、空库起、toast 出现 |
| T6 | 回归:正常兼容 db(真实存量库)迁移/启动行为与现在完全一致 | 真机脚本 | 零差异 |
| T7 | 运行时 spike:Electron 42 主进程 `node:sqlite` 可用性(施工第一步,失败则回退评估 better-sqlite3) | 手工 spike | `require("node:sqlite")` 可用 |

**真机验收按 REQ-084 原文要求「造超前 db 实测」,不接受只写单测**;测试载体用 local 渠道包
(独立 `ai.deskfox.app.local` 身份 + 数据隔离,绝不碰 user 正在用的正式版,XDG 指向临时目录做全隔离)。

### S2 · REQ-117 performance e2e 套件复活

证据链已闭环(合并后 main 全套 ×2 + 合并前基线全套 ×1,失败集逐条一致,全为存量;详
`docs/features/session-presentation-input-batch/3-changelog.md`「已知问题」),不重查定性,直接修。

**核实到的机制线索(见 §7 勘误②)**:performance 组自有 config
(`e2e/performance/playwright.config.ts`)本来就是 `workers: 1, fullyParallel: false`;而「全套」跑法
`OPENCODE_PERFORMANCE=1` 走的是**主 config**(本地 workers 默认非 1)。「单文件 3/3 过、全套稳定败」
的直接嫌疑就是**并行度差异**:benchmark 与 60 条常规 spec 抢 CPU,冷启动就绪时间超过
`APP_READY_TIMEOUT`(30s)。→ 修法首选**改全套的跑法契约**(performance 组永远走自有串行 config,
作为全量验收的独立第二步),而不是全局调大超时。

**A 族 ×3 · 冷启动超时**(`timeline/home-tab-navigation-benchmark.spec.ts:40` /
`session-parent-hydration-benchmark.spec.ts:51` / `session-tab-switch-benchmark.spec.ts:16`):

- 验证假设:全套 + `PLAYWRIGHT_WORKERS=1` 跑一轮,若 A 族转绿即坐实并行度根因。
- 落地:全量验收拆两步 —— ① 默认套件(维持 `testIgnore` 排除 performance)② performance 组走
  `test:bench` + `test:stability`(自有 config 串行)。`OPENCODE_PERFORMANCE=1` 混跑口径**废除**
  (或文档标注仅限 debug)。仍不稳则按用例微调超时,**不许删断言**。

**B 族 ×3 · 虚拟化时序**(需先调查再定修测试还是修行为):

- `adverse.spec.ts:82`(shell 行滚出视口应卸载 count 0,实测 1):定位竞态点(overscan 边界 /
  卸载时机),给出一句话定位后再定修法。
- `adverse.spec.ts:167`(resize 窄屏往返 shell 重挂载 1 次,期望 0):**六条里唯一可能护着真产品问题的**。
  先真机(local 包)看 resize 时 shell 卡片有无可感知闪烁/状态丢失 → 有则修行为,无则放宽断言并写明依据。
- `scroll-interaction.spec.ts` 整文件 flaky(失败在文件内漂移,负载敏感):在串行新跑法下先复测 ——
  若 flaky 消失则收口;仍 flaky 则逐条定位;处理不掉的按 R5 **显式移除 + changelog 记理由**,不许静默 skip。

**规范收口**:performance 组的定位写进《自动化测试规范》——推荐「**纳入发版验收清单**,作为独立串行步骤;
**不进 pre-push**(机器时间成本)」,终裁见 §6 D3。

**R8 测试用例清单**:

| # | 验什么 | 层级 | 预期 |
|---|---|---|---|
| T1 | 全套 + `PLAYWRIGHT_WORKERS=1` 单轮 | e2e | A 族转绿 → 坐实并行度根因 |
| T2 | 新跑法契约下连续 **3 轮**全套(默认套件 + performance 串行) | e2e | 稳定绿,或已移除项有 changelog 理由 |
| T3 | `adverse:167` 真机 resize 往返 | 真机 QA | 有明确「闪 / 不闪」结论记录 |
| T4 | B 族每条 | 分析 | 各有一句话竞态定位(修 or 放宽的依据) |
| T5 | 默认套件回归 | e2e | 全绿(改动不伤既有 65 条外的套件) |

### S3 · `submit.test.ts` 加载即挂(根因已定位,无需再调查)

**根因(2026-08-18 本次核实钉死)**:`submit.test.ts:135` 的
`mock.module("@opencode-ai/ui/toast", ...)` 只提供 `{ Toast, showToast }` 两个导出;而 import 链
`submit.ts → @/utils/toast(utils/toast.tsx)` 还静态引入了 `toaster`(`toast.tsx:99` 的 re-export)
与 `@opencode-ai/ui/v2/toast-v2` 的三个导出 → bun 校验具名导出失败,整文件加载即挂。
是 **mock 落后于 import 链演进**(v2 toast 引入时没同步),非加载器 bug。
另:裸 `bun test`(不带 `--conditions=browser`)会报成另一个错(solid-js 解析到 server 构建),
正确复现口径 = `bun test --conditions=browser --preload ./happydom.ts <file>`(即 `test:unit` 的参数)。

**修法**:补齐 mock —— 给 `@opencode-ai/ui/toast` 的 mock 加 `toaster` stub,并对
`@opencode-ai/ui/v2/toast-v2` 增加同型 mock(或改为直接 mock `@/utils/toast`,择实现时更稳的一种)。

**R8 用例**:修复后该文件用例数 > 0 且全绿(防「0 个用例通过」假修);`bun run test:unit` 全量回归绿。
commit 带 `[bug-repro: mock 缺 toaster 具名导出致 submit.test.ts 加载即挂]`(fix 与验证同笔)。

### S4 · i18n 工程化两条

**S4a CRLF 归一化**:`da`/`de`/`no`/`tr` 四个 `packages/app/src/i18n/*.ts` 是 CRLF/LF 混合行尾
(已核实);仓根 `.gitattributes` 现只有 2 行 linguist 标注、无任何 text/eol 规则。
修法:`.gitattributes` 加 `packages/app/src/i18n/*.ts text eol=lf`(**定向,不动全仓**,避免一次性
超大 renormalize diff)+ `git add --renormalize packages/app/src/i18n` 落一笔归一化 commit。
验收:`file` 报告四文件纯 LF;归一化后 `git diff -w` 为空(纯行尾差异)。

**S4b 死 key 清理**:23 个死 key **已逐一核实**(`fileTree.dialog.*` 20 个 + `settings.feishu.*` 3 个:
`bind.domain.label` / `bind.userCodeLabel` / `edit.cancel`;`fileTree.dialog.cancel`/`validation.*` 等
仍在用,**不误删**)。脚本化从全部 locale 文件删除这 23 个 key;注意 `settings.feishu.*` 在
FORK-BEGIN 块内,删行不破坏 marker 配对。验收:grep 23 key 全仓零命中 + typecheck 绿。

### S5 · REQ-068 归档 + fork 侧文档回填

**范围较原计划扩大**(勘误③):REQ-068 需求文档明写真正剩余两件 ——
① fork 侧文档回填(~15 分钟):`docs/features/stale-path-hardening/mac-qa-handoff.md`「待办 2」段
改为已完成结论(指向 `project-continuity-v2026-8-4/3-changelog.md` 的 REQ-070 实测记录)+
`stale-path-hardening/1-spec.md:36` 真机 QA 项勾掉;② Windows 四模态真机 QA —— **不做**,归档行记
「残留转 Win 端」(终裁见 §6 D4)。归档动作按《需求管理规范》§D:行迁 `需求归档.md` +
doc 迁 `需求池/已完成/` + `bash scripts/check-index-sync.sh` 全项 OK;**在本批全部子项完成时执行**
(§D「归档按计划批量」)。

## 4. OUT OF SCOPE(明确不做)

- REQ-103 整条归档 —— S1 交付后随本批收口一起处理其归档条件确认,不提前动。
- 上游 opencode 再同步(1.18.16 → 更新)—— S1 的 baseline drift 闸(T2)就是为下次 sync 准备的钩子。
- S2 中 B 族若定位出**产品层**行为缺陷且修复面大 —— 单开需求,本批只收测试护栏(`adverse:167` 若
  真机确认闪烁,修行为的规模评估后再定是否并入,超 Tiny 即单开)。
- REQ-084②(TC-6 Intel 真机复现)—— 原文即「有 Intel 环境时顺手补」,不进本批。
- 语音派活本体(REQ-102 S1-S4)、REQ-106/048/030 等 backlog 新功能。

## 5. 验收门槛(全批,对齐 OPENCODE-PLAN 计划原文)

- [x] S1:超前 db 真实污染场景实测通过(迁移期 T4 + 历史遗留 T5)+ 处置策略有 user 拍板记录(§6 D1/D2)
- [x] S2:新跑法下 performance 组连续 3 轮稳定(绿,或已移除项有 changelog 理由);`adverse:167` 有真机结论
- [x] S3:`submit.test.ts` 用例数 > 0 且全绿
- [x] S4:四文件纯 LF 且归一化 commit `git diff -w` 干净;23 死 key 全仓零命中
- [x] S5:fork 两处文档回填落地;OPENCODE-PLAN 对账脚本全项 OK
- [x] 全批:typecheck **33/33**(立项写的 29/29 是当时快照,包数已增)+ 单测五包全绿 +
      Playwright 默认套件 **139/139** 全绿(回归基线)。
      **一处如实标注**:desktop 包 262 pass / **1 fail** —— `draft-store.test.ts` 因上游顶层
      `import "node:sqlite"`(bun resolve 不了)加载即挂,`main` 上同样如此 = **存量、非本批回归**,
      详见 3-changelog「全批验收」段。

## 6. 待拍板项(user 审签时决定)

| # | 决策点 | 推荐 | 备选与理由 |
|---|---|---|---|
| D1 | S1 迁移期检测到超前 db 怎么办 | **不迁该 db**(auth/config 照迁,空库起步 + toast 告知)。**✅ 已拍板(2026-08-18 user 同意推荐)** | 仅告警照迁 = 等于没修(污染照样进 ns);拒绝启动 = 过重(auth/config 本可无损保住) |
| D2 | S1 启动期(历史遗留/存量污染)检测到 ns 内 db 超前怎么办 | **挪走 `opencode.db.incompatible-<ts>`(保留)+ 空库起 + toast**。**✅ 已拍板(2026-08-18 user 同意推荐,含降级边界的接受)** | 仅告警不挪 = sidecar 照崩、无自愈,违背 REQ-084 原语义。⚠ 已知边界:updater `allowDowngrade=true` 下用户被降级/主动降级后,自家新 db 也会判超前触发同一处置 —— 把「静默永久坏」换成「显式隔离、文件可手动恢复」,推荐接受并写进 changelog 已知边界 |
| D3 | S2 收口后 performance 组与发版验收的关系 | **纳入发版验收清单**(独立串行步骤:`test:bench` + `test:stability`),不进 pre-push。**✅ 已收口(2026-08-18 user 授权「待拍板项收口处理」,按推荐采纳)** | 明确排除 = 回到「谁都不知道它坏着」的现状,白修 |
| D4 | S5 归档时 Windows 四模态 QA 残留去向 | 归档行记「残留转 Win 端」,不因残留阻归档。**✅ 已收口(同上)** | 为 15 分钟文档活保留整条 backlog 占位,正是本条要治的病 |

## 7. 核实结果与勘误(vs OPENCODE-PLAN 计划原文,2026-08-18 对 main `2cb59f69d7` 逐条核实)

**断言核实全部成立**:fork core = 1.18.16(升级确已发版,硬约束确已破);`REQ-084`/`迁移污染`/`污染检测`
全仓 grep 零命中(零实现);S2 六条失败与 flaky 族证据链与 changelog 记录一致;`submit.test.ts`
按 `test:unit` 口径复现出与记录完全一致的报错;四 i18n 文件确为 CRLF 混合、`.gitattributes` 无 text 规则;
23 个死 key 逐一 grep 核实数目精确(20+3,且相邻的 `dialog.cancel`/`validation.*` 在用)。

**勘误/新信息三条**:

1. **REQ-084 方案 A 的核心顾虑已过时**:原文写「Electron 主进程读 sqlite 需新增 better-sqlite3 native
   依赖或轻量解析」;实际 core 1.18.16 已有 `sqlite.node.ts` 用 Node 内置 `node:sqlite`,desktop
   主进程零新依赖可只读打开 db(Electron 42;保险起见 T7 spike 首步验证)。这使 A′(基线比对双点跑)
   成为明显优选,原方案 B(字符串匹配 sidecar 错误)不再必要。
2. **S2 A 族的「调 APP_READY_TIMEOUT 或降 workers」有更准的修法**:performance 自有 config 本就是
   `workers:1`(单文件跑法),失败只出现在主 config 混跑口径(`OPENCODE_PERFORMANCE=1`,本地 workers
   非 1)。首选修跑法契约(混跑口径废除、performance 永远串行独立跑),不动全局超时 —— 调超时治标,
   且会拉长所有正常轮次。
3. **S5 不是纯台账 5 分钟动作**:REQ-068 需求文档(2026-08-07 钉死段)明写剩余两件 —— fork 侧文档回填
   (`mac-qa-handoff.md` 待办 2 + `stale-path-hardening/1-spec.md:36`)与 Windows 四模态 QA。
   只迁行不回填,两处 `- [ ]` 会永远漂着,下次盘点复发同款「状态漂移」。本 spec 把回填并入 S5(+15 分钟),
   Windows QA 去向走 D4。
