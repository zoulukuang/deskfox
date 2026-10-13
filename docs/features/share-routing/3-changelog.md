feat-id: share-routing
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-148 施工记录

2026-10-12：独立工作树基于 b2162c0c7dc77700d718aa43ecbf8a080466565b。
user 已确认 D-A/B/C，已提供 `/Volumes/ExtSSD/deskfox-web` 两站配置。S1–S3 已实现，组合 local 已交付；两站于 2026-10-12 完成实际部署和公网/原生分流验收。运营保留期/删除举报联系人、Windows 入口及整期其余验收仍待完成；源码尚未提交、合并、推送。

## 构建阻碍复现

- 未修改基线的 enterprise `bun run build` 失败：UI 的 `@opencode-ai/core/office-pdf-protocol` 没有声明依赖。日志 `/tmp/share-routing-baseline-build.log`。
- 已含该依赖修复的成本工作树仍在 SSR 阶段失败：SolidStart 为共享 UI 模块注入 `@solidjs/start/server`，从 UI 包位置无法解析。日志 `/tmp/share-enterprise-baseline-build.log`。
- 将 UI 实际使用的 Core 声明为运行时 workspace 依赖（与成本分支同一修复）；enterprise Vite 对 SolidStart 使用宿主应用 dedupe，避免给通用 UI 增加服务端框架依赖。
- 修复范围仅依赖声明与宿主构建解析，不改分享协议、数据存储或线上服务。独立分享及组合工作树的 enterprise 生产构建均已通过。

R4：package/lock 如命中黑名单，提交前与成本组统一提供依赖修复复核，不自行提交或合并。

## 已实现

- enterprise fork 仓储：单分享原子文件、fsync/rename、幂等创建、初始同步前不可公开、持久墓碑、ID/归属/结构/大小校验、磁盘余量保护、限流/并发保护。模型 options/headers/API URL 在公开落盘前移除。
- 独立本地 API 与原云 adapter 分开；公开页采用 DeskFox 品牌、同源 OG、动态 no-store，撤销覆盖 page/data/SSR/RPC。旧云存储测试没有连接真实生产桶。
- Core 正式迁移：来源字段和独立于 Session cascade 的 operation 表，旧分享删除凭据回填。创建前持久 recovery key；初始同步完成后才公开 URL；失败清理可重试。
- ShareNext 按 Session 在进程内串行，来源/原账户固定；实际 HTTP 重定向禁止转发 secret；HTML 404 不作为撤销成功。增量同步只在确认成功后移除批次，失败保留并每 5 秒重试，作用域结束时停止。
- UI 两入口复用 typed hook：捕获语言/连接/目录，检查当前服务 OpenAPI 后才发送 cn/global；公开入口不带组织凭据。桌面自动分享缺 target 明确报错，CLI 兼容。SDK/Client 已执行规定的生成命令。
- 离线管理删除、同地哈希备份和恢复；恢复须有完整最新删除账本并覆盖晚于备份的墓碑。缺账本或跨区恢复拒绝。服务和 Nginx 模板已准备，尚未安装。

## 测试证据（2026-10-12，仍在补全）

| 范围 | 已核实结果 | 原始证据 |
|---|---|---|
| 分享生命周期/来源/OpenAPI | 25 pass，包含重定向真实传输、账户变化、初始同步/取消并发、重启清理、自动分享 | `/tmp/share-lifecycle-tests.log` |
| 仓储/API | 15 pass；此次四个逻辑模块行覆盖率 100% | `/tmp/share-service-tests.log` |
| 备份/恢复/删除 | 3 pass，含备份后删除不复活、跨区/篡改拒绝 | `/tmp/share-maintenance-tests.log` |
| Core | 既有迁移/投影 23 pass；新迁移回填/cascade/idempotency 1 pass | `/tmp/share-core-tests.log`、`/tmp/share-migration-tests.log`（首份包含已修正的测试 fixture 外键开关失败） |
| App 单元/browser | 1191 unit、41 browser pass | `/tmp/share-app-regression.log` |
| UI Playwright | 菜单 zh→cn、命令 global、旧后端有可见错误且零创建，3 pass | `/tmp/share-ui-e2e.log` |
| 公开页 Playwright | 桌面/移动 2 pass：正文、代码、数学、工具、diff、危险链接过滤、撤销 | `/tmp/share-public-browser.log` |
| Node 生产制品 | 1 pass / 40 断言，page/data/RPC 撤销后均真实 404、no-store | `/tmp/share-production-tests.log` |
| 生产基准 | 前后各 cold/hot 5 次；无空白/错误会话。cold 首次正确中位数 24.5→26.8ms，hot 1.8→2.1ms；不据一次样本宣称性能提升/退化 | `benchmark.json` |

App/Core/opencode/enterprise 类型检查已跑，变更后的最后一轮结果以日志为准。未用自动重试掩盖失败：先复现、分析，再修正源码或测试前提。原生 Windows、两站真实落盘、生产容量、单写锁和灾备操作尚未验，不把模板及本机替身当通过。

## 实测发现并修复

1. 取消分享时投影跳过 undefined，数据库留下旧 URL。改为显式 NULL，初始发布/取消并发回归通过。
2. 增量同步失败后原队列提前删除。先写失败复现，再改为成功确认后逐项移除；期间新事件保留。
3. 菜单分享错误仅 console，没有界面反馈。浏览器复现后接入现有 toast；原生 fetch 必须以普通函数调用，不能将自定义参数对象绑定为 this。
4. SolidStart/H3 会改写部分 404 响应；SSR middleware 提前设置不存在状态，RPC 通过内部响应标记由最外层转成 404，并移除标记。仅抛 Response 不足以保留 RPC 的 HTTP 状态，最终生产制品回归已通过。
5. 完成状态的 tool 缺必需字段、错误类型的 filename/patch.files/agent.name 原先可写入。先新增失败接口用例，再补 part 与嵌套 tool/附件字段校验，拒绝时保留旧快照。
6. 恢复创建时无条件清队列会丢掉当前分享已收到的 diff。先复现，再限定只清除旧 share ID 的 generation；恢复、并发创建和取消后跨区重发回归通过。

## 组合工作树最终自动化（2026-10-12）

`/Users/openclaw/.codex/worktrees/batch-local/opencode-fork`，分支 `batch-local`，整合两组未提交源码。只用于集成验收，未改主分支。

- App：1195 unit + 44 browser；session-ui：125；Core：限额/迁移 10 + 既有迁移/投影 23。
- opencode：prompt/read/分享第一轮 125 pass / 1 原有 skip；message-v2 39 pass；最终分享/OpenAPI 47 pass，含实际 SQLite 写失败后的远端补偿、真实计时的 30 秒请求超时与原恢复键重试。各轮有重叠，不合计冒充独立用例数。
- enterprise：仓储/API/维护 19 pass，五个逻辑模块行覆盖率 100%；另有真实子进程 SIGKILL 写入中断 1 pass，只证明任意观察到的临时写入窗口原子可见，不冒充断电或每个 fsync 边界测试。
- 生产制品 1 pass / 40 断言；公开页桌面/移动 2 pass（含 PNG 真加载）；组合 UI 7 pass。对应 `/tmp/batch-{production-test,public-browser,ui-e2e}.log`。
- app/core/opencode/enterprise/session-ui/desktop/ui 包级类型检查、app `typecheck:e2e`、Core migration `--check` 通过；后者未发现 schema 漂移。
- 组合性能诊断采样冷/热各 5 次：首次正确中位数 29.2/2.1ms，稳定 46.9/20.8ms，错误/空白均 0。第一轮 runner 异常退出只留下 Node 版本，无断言报告；改用 list+JSON reporter 对同一生产制品诊断跑通过。原因未定，两份原始日志都保留，不能把首轮记通过。
- 跨 Location 的独立 service 实例取消等待初始同步；Session cascade 凭据保留；并发发布、取消重发、恢复队列均在最终分享测试覆盖。

交付目录：主工作区 `packages/desktop/dist-deskfox/batch-20261012-local/`，包含 local `.app`、服务制品、测试清单、报告和源码/hash 清单。Mac arm64 / local / 2026.11.2，未升版。正式包的 2511 个 out 文件逐项核对；后端含附件保护、shareTarget 和 share_operation。

原生验收仍不闭环：初次组合包隔离启动已看到 LOCAL 和编辑器；重打包后的独立 QA 身份副本在 CUA 观察中长时间等待并只返回空白 AX，不能宣称原生通过。测试进程已结束，用户原 local 实例保持运行；最终包未自动替换正在运行的软件。Mac 拖放/新光标修复、Windows、真实两地发布/恢复/限流、旧线上链接样本和完整超时/断电边界仍待验。原生工具问题和未提供的运维信息分别记录，不相互替代。

## 翻译记录

新功能文案在 shared typed feature bundle 中集中维护 zh/en；其他语言明确回落英文，不宣称已完成 62 种语言翻译。中文“服务器/支持/更新”及提示句式交叉核对 Apple 中文支持（https://support.apple.com/zh-cn/126655）和 Microsoft 中文支持（https://support.microsoft.com/zh-cn/windows/deployment/updates-lifecycle/what-does-it-mean-if-windows-isn-t-supported）。Mozilla 对应页面注明机器翻译，不作为独立人工审校证据。

## R4 提交前复核（待最终测试收口后送审）

| 既有文件 | wrapper 不足的原因与风险 |
|---|---|
| `packages/opencode/src/share/share-next.ts` | 旧生命周期内部重新选择账号、先返回 URL 后同步、队列/取消竞态在模块内部；外层 wrapper 无法可靠改变这些时序。主要风险为失败恢复、账户解绑与多实例缓存，已加集成覆盖，仍需跨 Location 最终复核。 |
| `packages/opencode/src/share/session.ts` | 自动分享无点击语言且吞错，入口必须增加明确目标和可见失败；原 CLI 行为保留。 |
| `packages/opencode/src/server/routes/instance/httpapi/{groups,handlers}/session.ts` | 公共协议必须接受并转发 shareTarget；只改 UI 会被旧后端静默忽略。生成声明作为能力合同。 |
| `packages/opencode/test/share/share-next.test.ts` | 在现有真实 Session/投影/HTTP 依赖测试中验证生命周期，不复制业务实现。 |
| `packages/core/src/share/sql.ts`、`src/database/{schema.gen,migration.gen}.ts`、`schema.json` | 来源和删除凭据必须持久，不能靠 UI/localStorage 缓存。通过正式 migration 工具生成，未手改生成客户端；新迁移回填旧凭据。 |
| `packages/core/src/session/projector.ts` | Drizzle 跳过 undefined，需在唯一持久投影处明确 NULL；外层重复发事件无效。 |
| `packages/core/src/config.ts`、`src/v1/config/{config,migrate}.ts` | 显式自动分享目标必须可校验且被 v1 配置迁移保留。 |
| `packages/enterprise/src/{app,entry-server}.tsx`、`src/routes/api/[...path].ts`、`src/routes/share/[shareID].tsx` | 通过最小入口接入独立服务模块；SSR 状态/缓存/OG/错误出口必须在框架边界处理，代理无法分辨正文是否已撤销。 |
| `packages/enterprise/vite.config.ts` | workspace SolidStart 注入解析需宿主 dedupe；动态 middleware 接入只能在宿主配置完成。 |
| `packages/sdk/js/src/v2/gen/{sdk.gen,types.gen}.ts` | 由规定脚本生成的公共参数，不手写绕过协议。 |
| `packages/ui/package.json`、`packages/enterprise/package.json`、`bun.lock` | UI 实际依赖 Core、enterprise 使用 branding，构建需显式声明；lock 只保留两项 workspace 依赖，不带整体重算噪声。 |

独立 fork 新文件保留在各自模块；命中 R4 的既有文件在 user 审签前不提交。回退服务保留原目录/墓碑，客户端安全回退必须保留来源固定，不允许旧客户端把 secret 投向当前新账号或新区域。

## 2026-10-12 连续重启验收补正

用户授权随时重启 local 后，实测发现分享迁移已执行，但桌面 `migration-baseline.generated.ts` 漏掉该 ID，第二次启动将自家库误判超前并隔离。已有 `db-schema-guard.test.ts` drift 用例复现失败；使用 `packages/branding/scripts/gen-migration-baseline.mjs` 生成 39 条基线后，desktop fork 全套 169 pass/652 断言。修复属于本期新迁移的打包配套，不改变隔离策略。原 local 库和 WAL 均保留，临时副本 integrity_check 通过后恢复原库，误建空库另存；新包连续启动两次均 209 个会话、原测试会话可见、无新增隔离。正式版数据库未动。

新增删除响应丢失、本地取消事务失败两项集成通过（17 断言），验证 cleanup-required 保留原服务凭据、禁止跨区重新发布、可幂等取消恢复。新增真实 Node 服务三代进程重启 1 pass/14 断言，验证相同恢复 key 返回原 ID/secret、正文保存、删除墓碑重启后仍拒绝恢复。首次测试误将删除 key 重试预期写成 410，按既有 ShareConflict 409 契约修正；实现未改。opencode 类型检查通过，新增服务测试纳入 enterprise 包类型检查。

本机四条旧分享 URL 只读检查全部是 HTTPS opncd.ai、路径精确等于保存 ID 的 `/share/<id>`，只保存匿名化布尔结果，没有访问或删除旧分享。最终组合 app.asar SHA-256 为 `4b93dbcab5b1f78cd907a94c670e0545ac981c6fd326b196ce4610049cd66c04`，2511 个 out 文件逐项核对。仍待两地正式部署、运营参数、Windows 及其余故障边界；保持 in-progress。

## 2026-10-12 两站实际部署验收

用户明确授权两站部署后，已安装同 SHA 制品、Node 22.23.3、独立服务用户/持久目录/单写锁及精确 Nginx 路由。两站公网创建、同步、增量更新、重启、取消、跨区隔离、备份恢复墓碑、限流/体积/真实 IP 防伪造全部通过。真实 local 简中 CN、切英文来源固定、取消重发 AI、两站取消失效通过，原界面语言已恢复。官网及更新/统计入口回归通过。配置同步至 deskfox-web，详见 `packages/enterprise/deskfox-deploy/DEPLOYED-20261012.md`。这是对前文“未部署”的更新；保留期/联系人未获回复，未配置定时备份。整期仍保持 in-progress。

## 2026-10-12 历史模型分享失败补修

交付前原生窗口出现另一条历史会话分享 500。远端记录为创建后立即补偿删除、没有正文同步；本地消息引用的 `claude-code/opus` 在当前配置中不存在。隔离回归重现 `ProviderModelNotFoundError`：`ShareNext.full` 原本把历史模型解析作为发布前置。

修复仅在模型已移除时跳过可选模型展示元数据，消息/正文/原模型 ID 完整保留，不虚构模型价格或调用模型；其他异常仍传播。新增回归先红后绿，分享生命周期全套 26 pass /123 断言，包级类型通过。另用真实分享逻辑、隔离数据库和合成历史消息实际发布到 CN/AI：SSR 正文可读、原模型 ID 保留、无 secret、取消成功，2 pass /18 断言。两站服务制品无需变化。

该实际会话的 25 条消息、224 个 part 仅在本机做分享 schema 结构检查，全部通过，没有导出或重新公开其正文。未替用户重试发布私人会话；可在新包中自行重试原失败会话。

已按正式 local 流程重构建/打包，2511 个 out 文件逐项核对。当前 app.asar SHA-256：`dce43b0fb856ad23a48c1d34b79370339deb1e2dbf74f9f26e1835c3f97b09da`。此前 `4b93dbc...` 包保留为隐藏的 `.previous-history-fix.app` 回退副本；两站服务 SHA 仍为 `4427b00a...`。正常重启后 LOCAL、原历史会话和未发送草稿均恢复，未自动发送草稿，窗口已置前。新旧验证日志都保留在 evidence，不将旧包测试混作本次新增验证。

## 2026-10-12 Chrome 真实页面验收补充

根据用户要求，在 Chrome 原生浏览器打开两站实际 HTTPS 分享页，人工操作滚动、展开工具、切换轮次及文件差异；没有以 HTTP 200 或 SSR 字符串检查替代页面验收。

浏览器发现并修复：有文件差异时，正文列 `w-full + shrink-0` 把右侧会话变更面板挤出视口。现按有无差异分配全文/半宽，右侧允许收缩；无差异的窄屏外层增加 flex 高度约束。修改位于既有分享路由，外部 wrapper 无法修正内部两列宽度；标注 FORK，源码仍待 R4 提交审签。

修复已部署两站，release 为 `20261012-a5cb9fbc`，旧 `20261012-4427b00a` 保留用于回退，数据和墓碑不回退。新服务压缩包 SHA-256：`a5cb9fbcbfe5181659047c847fa74397527d4e7cf2cd32d2ed5d2728e1d740be`。两站部署后健康检查通过，浏览器刷新后右侧差异正常。打包时 Linux tar 忽略 macOS provenance 扩展属性，解包/校验/启动正常。

| 验收点 | 大陆站 | 海外站 |
|---|---|---|
| 正确域名、标题、历史模型 ID（模型元数据缺失） | 通过 | 通过 |
| 中文/英文/emoji、范围与删除线、代码高亮、表格 | 通过 | 通过 |
| 行内/块级公式、引用、任务列表、首轮末尾 | 通过 | 通过 |
| 图片缩略图、推理文本、展开 Shell 后的中文完整输出 | 通过 | 通过 |
| 两轮对话切换、30 段正文逐段标记、最终末尾标记 | 30/30，通过 | 30/30，通过 |
| 宽屏文件差异展开、统一/并排视图 | 通过 | 通过 |
| 150% 缩放触发窄视口：会话连续滚动、变更标签、差异展开 | 通过 | 通过 |

环境：当前 macOS Chrome，100% 与 150% 缩放；测试后恢复 100%。窄视口验证不等同于手机真机或 Windows 验收。浏览器初始显示 Markdown 原文后完成异步渲染，最终代码、表格与公式均已检查；未做首屏性能计时或全资源控制台审计。

配套验证：enterprise `bun typecheck` 通过，`bun run build` 成功；新产物真实 Node 生产测试 1 pass /40 assertions，覆盖 SSR、资源、API 与撤销。此处只是本次分享页浏览器验收，整期 Windows、原生边界、业务容量和运营参数等待项不因此关闭。

本次两个合成验收分享保留给用户复核，不含私人会话或凭据：

- 大陆：https://deskfox.cn/share/34d8bff25f6ab45ea53f8a0c7bebffd08113eb918a4639e4
- 海外：https://deskfox.ai/share/7db8733c7103e5598719bc0e3ef7d79a65bb24ec6af37bc7

Chrome 已打开两站标签。宽屏左侧两条短横线用于切换第一/第二轮；工具行与右侧 example.ts 可展开。正文为每轮独立滚动，窄视口在 Session/1 Files Changed 标签间切换。截图位于交付目录 `evidence/browser/`。此前“临时分享已全部撤销”描述适用于上一轮测试，本次新增上述两条保留验收样例。

本次只更新网页服务，local 桌面 app.asar 仍为 `dce43b0fb856ad23a48c1d34b79370339deb1e2dbf74f9f26e1835c3f97b09da`，无需为网页布局重新安装桌面包。

## 2026-10-12 用户截图所示旧会话补验

截图会话为“海尔公司与海尔电器集团关系”，请求端口 54005。日志对应 15:57:31 /15:57:40 的旧进程 cd27db98；16:16:42 重启后的已修复包使用 63107。截图本身不能证明新包仍发生同一 500。

本次将该会话的 14 条消息、49 个 part 只读加载到隔离测试库，使用真实 Session/ShareNext 生命周期和内存 HTTP 替身，未向公网传输实际正文。发布、初始同步、全部 part 字段逐项保留、服务端 schema 校验、撤销均通过（1 pass /8 assertions）。历史用户消息引用 claude-code/sonnet 和 opencode/mimo-v2.5-free。另用合成的已移除模型数据验证两站真实网络创建/同步/撤销，2 pass /18 assertions。

当前 local 包 SHA 仍是 dce43b0fb856ad23a48c1d34b79370339deb1e2dbf74f9f26e1835c3f97b09da。原生窗口显示另一历史会话已成功发布到 deskfox.cn。没有替用户公开本次报错会话；该具体会话在新包 UI 的真实发布仍需用户重试，不能把本机隔离测试表述为已完成该私人会话的公网发布。本次没有新增运行时代码变更，无需重复打包。诊断测试含用户本机绝对路径，已移出源码树，仅保留匿名化测试日志作为证据。


## 2026-10-12 分享页顶部压缩

用户反馈顶部悬浮区域过高。品牌栏从 48px 减到 32px，上边距从 56px 减到 12px，标题与正文间距从 40px 减到 12px，标题内部间距从 16px 减到 4px。移除元数据固定高度；版本、模型、日期独立换行，长标题与模型名称允许断行，内容完整保留。窄屏同步减少上下留白，文件差异栏顶端同步对齐。

Chrome 中打开用户提供的海外原分享链接及大陆合成验收页；宽屏顶部约从 220px 压缩到 108px（不含浏览器工具栏，单行标题），正文滚动区域提前。首轮放大检查发现模型名与日期相挤，已扁平化元数据行并采用 Tailwind 4 的 wrap-anywhere 修正。最终两站宽屏及窄视口目视复核通过，截图存于 evidence/browser/compact-*.png。桌面缩放检查不等于手机真机验收。

enterprise 包级 bun typecheck、生产构建、git diff --check 通过；最终 Node 生产制品测试 1 pass /40 assertions。两个站点均切换至 20261012-14cd6ccd，SHA-256：14cd6ccd399f4539319ccf28dd3ce00dc06247809b9ef1fe6e53a14084131a85。systemd active，公网健康检查通过；原 20261012-a5cb9fbc 保留回退。此次只更新网页服务，分享数据、来源及 local 桌面包无需变更。源码尚未提交/合并/推送，整期其他等待项不因此关闭。


## 2026-10-12 开发者接管验收

本轮接管 Computer Use 原生与浏览器验收；完整记录及前后失败/通过日志见交付目录 `开发者接管验收记录.md` 与 `evidence/self-qa-20261012/`。Happy DOM 20.9.0 弱引用回调被 GC 是时间线测试偶发超时根因，增加强制 GC 先红后绿及依赖最小补丁后 App 1195+44 和类型检查通过。真实失效文件引用、中英文大附件取消、切会话草稿恢复、Finder 混合粘贴与累计体积通过。新增首次发布 60 秒总期限测试通过；取消存储不足/权限拒绝和四个落盘边界各自错误/强杀通过，Enterprise 31 项及类型检查通过。两站已有合成页 Chrome 复核通过。新公网分享复测被自动审批拦截，待即时授权，没有绕过；跨应用拖放、其余原生矩阵、Windows/手机和运营验收仍不标通过。运行代码、local 包及两站制品本轮不变，源码未提交。

## 2026-10-13 合并复核

用户在已获知自测结果和剩余验收项后明确要求“按照仓库的规范合并主分支”。本次按授权提交并合入本地 main，功能仍保持 in-progress；合并不等于全部验收完成、正式安装包发布或远端推送。前文“待 R4 审签/未提交”是施工阶段快照，以本节为准。

已复核原 R4 表的逐文件 wrapper 不可行性、风险和验证证据：附件准入、分享生命周期、来源持久化、公开协议和框架出口须在内部接入；外层包装不能可靠改变原有时序。独立逻辑保留在新增文件。现有回归覆盖历史兼容、来源固定、取消恢复、存储故障和页面渲染，未验项仍保留。用户本次明确合并指令作为提交与本地合并授权。

补充测试依赖 R4：Happy DOM 20.9.0 内部 MutationObserver 回调只有 WeakRef，强制 GC 可重现监听失效；补丁在原依赖保留强引用。根 package.json/bun.lock 必须登记同一补丁，业务 wrapper 无法修正依赖内部生命周期。该修复与 GC 回归单独提交，不改产品时间线行为。

采用 conventional commit、feat、bug-repro、override-blacklist 标记；超过 500 行的功能提交附 large-diff 理由。按仓库 pre-commit 明示的 override 机制提交受保护文件，不更改 hook；另检查 diff whitespace、文件名大小写、loopback 与 browser 测试参数。原主目录两处无关改动不纳入提交。回退按各功能提交撤销；分享数据、墓碑、来源凭据不随代码回退删除。

REQ-148 已实现并部署两站，历史模型兼容及紧凑分享页已验证；Windows/手机真机、运营保留与定时备份及剩余验收待完成。

### 本次提交与合并闸结果

`af056a70c7`（双站分享实现、迁移、服务与回归）；共同依赖修复 `6c9fb6d608`。

2026-10-13 完整运行仓库 `.husky/pre-push`：29/29 typecheck；app 1195 unit +44 browser、media-gen 140、adapter-feishu-lark 792、branding 82 pass/8 skip、desktop 169、session-ui 125，均 0 fail。Branding 8 项既有 skip 不算通过。Client 正式生成无漂移；legacy SDK 正式脚本完整成功，只产生预期的 shareTarget 两处类型/调用增量。上次中断遗留的 SDK 中间格式由完整脚本重生成清除。

提交前 whitespace 检查通过（Happy DOM patch 的上下文行保留依赖原始 tab/空行，不把补丁语法当产品空白错误）；仓库黑名单/大 diff 采用有理由的 override，剩余大小写/网络监听/browser 参数闸通过。最新服务端与分享专项结果沿用上一轮相同源码的 31 pass 与 33 pass/2 live skip；没有把未重跑项记为本轮重新执行。
