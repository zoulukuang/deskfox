feat-id: attachment-cost-guard
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施与验证记录

2026-10-12：用户批准规格后完成 C1–C3 开发，工作树 `attachment-guard`。代码尚未提交、合并或发布；下方 C0 是开发前快照，不代表当前状态。

2026-10-12 后续：原生选择器发现箭头/鼠标移动光标后仍用旧 store cursor，先增加失败 browser 用例，再在 picker 打开前捕获编辑器 DOM selection；浏览器环境从 43 增至 44 pass。组合工作树 `batch-local` 已纳入修复与分享组，App 1195 unit +44 browser、两组 UI E2E 7 pass、包级类型检查通过。最新 local 交付目录为主工作区 `packages/desktop/dist-deskfox/batch-20261012-local/`，旧 `attachment-cost-guard-local` 包不含该光标修复及分享代码。

旧包已通过 11 项 Mac 原生交互，详见旧交付目录 `本机实测记录.md`；随后混合 CSV/PNG picker 也观察通过。新版光标的 Mac 原生复核、Finder 外拖、英文原生与 Windows 仍未通过。组合 QA 副本遭遇原生控制工具长时等待/空白 AX，未按通过记录。最终交付状态以组合目录 `验收报告.md` 为准。

## 当前行为

- 新 legacy 内联文本正文封顶为 50KiB/2000 内容行，单行 2000 UTF-16 字符边界不切开 emoji，截断提示计入字节预算；非法编码报错，绝不声称对未经验证的路径调用了 Read。
- 新附件合成文本带服务端来源元数据。旧 synthetic 与真实用户正文保持原样；历史残余风险有实际模型请求回归。V2 文本媒体能力保持原状。
- 选择器/粘贴/外拖共用规范 MIME；桌面 base sidecar 的文本用引用，其他连接内联；PDF/图片内联，未知二进制拒绝；异步插入归属于捕获的草稿，无路径引用分支 blob 分配。
- 内联附件累计 >=200KiB 时确认，取消不创建会话/工作树、不写历史、不发送；草稿或目标变化使确认失效；并发提交合并为一次。旧内联文本有可靠本机路径时提供转换引用按钮。
- 完成轮次的输入量包含 input/cache.read/cache.write；达到增量 100000 且原值 3 倍时提醒。初始历史只建基线，模型/压缩/revert 隔断比较；提醒复用新会话/压缩命令。

## 验证结果

| 范围 | 结果 |
|---|---|
| app 全量 unit | 1191 pass，0 fail |
| app browser 环境 | 43 pass，0 fail，含新旧草稿归属与系统选择器异步回调 |
| session-ui 全量 | 125 pass，0 fail |
| opencode prompt/read/message-v2 | 138 pass，0 fail，1 个仓库原有 skip；新增历史保护后另跑 2 个附件请求回归通过 |
| core 限额/V2 保留行为 | 9 pass，0 fail |
| Playwright | 新功能 4 pass（中英文 864KB CSV + 6.4MB PDF 组合确认、新旧输入框、轮后提醒）；既有命令草稿/思考档位 2 pass |
| 类型检查 | app、core、opencode、session-ui、ui 的包级 bun typecheck，及 app typecheck:e2e 全部通过 |
| 新纯逻辑行覆盖率 | attachment-text / attachment-cost / attachment-cost-monitor 为 100%；attachment-reference 为 88.24% |
| 生产构建基准 | 前后各冷/热 5 次，全部完成；冷切换稳定中位数 54→45.7ms，热切换 20.2→21ms；空白/错误目标采样均为 0。单机采样不作性能提升保证 |

真实假模型 HTTP 捕获证明：864000 字节 CSV 新准入后，两轮都只携带受限正文，不再有全文；旧历史的 80000 字节 synthetic 与同文用户正文仍完整重放。没有访问用户数据库或真实供应商。

## 交付限制与 C4 剩余项

Win/Mac 系统级剪贴板、Finder/Explorer 外拖、原生选择器和执行侧真实权限交互未完成双端真机 QA。浏览器与注入式回调测试不能替代该项，因此 A11 不勾选，也不请求合并/发布。6.4MB PDF 的真实供应商计费没有测试；6.4MB 合成 PDF 与 864KB CSV 的浏览器组合确认/提交已通过，本批只保证 PDF 不误转路径、确认按字节触发。单附件正文上限不限制多附件总请求 token、HTTP 解码内存或原文件持久化体积。

英文和中文确认框已通过实际浏览器流程并截图检查。措辞参考 Apple 中文文件发送界面和 Microsoft Outlook 中文附件文档，token/上下文/压缩用项目既有术语；其他语言使用明确的英文回退，未作未经审校的翻译。

## 2026-10-12 local 验收包

用户要求先提供本地测试包。已重编 legacy Node 后端、渲染层及两个内置插件，并以 DeskFox local 配置生成 macOS arm64 `.app`（2026.11.2，未升版、未发布）。复用本机同版本 Electron 42.3.3 与既有 LibreOffice 运行资源。

产物位于主工作区 `packages/desktop/dist-deskfox/attachment-cost-guard-local/`，含 `.app`、16 项人工测试清单、7 个有效样例文件及来源/hash 清单。逐文件核对包内 2,511 个构建输出均与新 `out/` 相同，后端 chunk 含新限额及来源标记。该产物使用内置临时隔离测试配置启动，确认 `ai.deskfox.app.local`、LOCAL 徽标、编辑器加载、`/global/health` 返回 200/healthy；测试实例已关闭。此为打包启动冒烟，不替代上文双端原生附件交互验收。同期 REQ-148 分享组仍未开发。

## R4 提交前复核（待用户审签）

| 黑名单文件 | wrapper 不可行性与最小改动 | 风险与验证 |
|---|---|---|
| packages/opencode/src/session/prompt.ts | 只有准入内部能在存 synthetic 前限制文本；UI wrapper 无法覆盖 SDK/其他客户端 | 新数据截断语义；真实两轮请求、旧历史与用户正文保护回归 |
| packages/opencode/src/tool/read.ts | 原单行截断是函数内部局部实现，外部不能共享 Unicode 边界修正 | 仅复用常量/单行函数，保留流式分页；read 全套回归 |
| packages/opencode/test/session/prompt.test.ts | 必须复用现有真实准入/假模型 fixture 才能验证持久化与网络请求 | 仅新增测试，不影响运行行为 |
| packages/opencode/test/tool/read.test.ts | 复用既有 Read 服务环境锁住原分页行为 | 仅新增测试，不影响运行行为 |
| packages/ui/package.json | ui 已直接导入 Core office-pdf-protocol，外部 wrapper 无法让 ui 具备声明的模块解析依赖 | 只补 workspace 依赖；干净 worktree 构建与五包类型检查通过 |
| bun.lock | 声明依赖必须与 workspace lock 一致 | 仅新增一行 Core 依赖，无版本升级 |

Core 新纯模块/测试属于 fork 新文件，不伪装成既有上游文件。全部改动无 DB/schema 迁移、无公开协议变更。建议提交标记：`[feat: attachment-cost-guard] [bug-repro: oversized inline text replay and PDF path routing] [override-blacklist: cap attachment admission and declare ui dependency]`。回退为撤销这笔功能提交；已保存的受限新 synthetic 不会自动恢复全文，原 FilePart 保留。未审签前不执行代码 commit。

## C0 验证记录（开发前快照）

2026-10-12，基线 b2162c0c7d，Bun 1.3.14，macOS。新增/扩展 4 处调查测试，共 5 个 C0 用例，28 个断言通过；另一个现有 message-v2 测试通过，确认隔离环境有效。产品运行代码未修改，尚无修复/发布提交。

## 实测结果

| 探针 | 输入 | 结果 |
|---|---|---|
| legacy prompt 与后续请求 | 864000 字节、24000 行 CSV | 一份完整 synthetic；两轮假模型请求都包含全文 |
| V2 canonical projection | 同一附件，data URL 1152023 字节 | 未裁剪媒体；OpenAI Chat prepare 返回不支持 text/plain，未发送 |
| legacy read 行数 | 3000 行、6000 字节 | 仅前 2000 行；offset=2001；含行号/包装输出 15099 字节 |
| legacy read 字节 | 100 行、100100 字节 | 前 51 行；offset=52；含包装输出 51464 字节 |
| legacy read 超长单行 | 60000 字节 | 单行 2000 字符裁剪 suffix；含包装 2217 字节 |
| V2 read 小文件 | 3000 行、6000 字节 | 全文返回，不受 legacy 2000 行规则限制 |
| V2 read PDF | PDF magic 合成临时文件 | ReadTool.BinaryFileError |
| app 类型/路由 | CSV/TXT/PDF/PNG/Office 有无路径 | 文本规范为 text/plain；PDF 可内联却被外拖 path；Office MIME 拒绝却被外拖 path |

## 覆盖限制

legacy 第二轮使用实际已保存临时会话，验证历史重放，无用户数据库。没有验证所有历史版本的布局与来源标记，不能用该测试推断可安全自动识别旧附件。V2 使用真实 canonical projection 和协议 prepare，尚未运行完整 Session drain，也未证明其他 provider 对文本媒体的最终行为；C1 不更改 V2 能力。

路由验证是纯函数和真实 File MIME 检测，未替代 Mac/Win OS 剪贴板/选择器。C3 阈值及交互尚未实现；未跑产品 benchmark，修改 session UI 前执行。未部署、未公开分享、未发真实模型请求。

## 当前交付状态

Core 与 opencode 包的 `bun typecheck` 通过。app 包 `bun typecheck` 未通过：`packages/ui/src/pierre/media.ts:6` 无法解析 `@opencode-ai/core/office-pdf-protocol`；该 import 与目标文件均已存在于基线，本次未修改。新 worktree 使用锁定依赖安装后出现此解析问题，尚未认定主工作区也会复现；不以改依赖或跳过检查掩盖。C2 开工时需先核实依赖声明/解析环境，属于 app 完整验证前置。

`git diff --check` 通过；格式化只作用于本次测试，既有测试文件 diff 仅新增探针。产品代码仍零修改。

C0 技术证据完成，规格待审；D-J 阈值与 Large 审签未关闭，C0 整体门不勾选。C1-C4 未开始。回退 C0 只需移除本分支的调查测试/文档，不涉及用户数据。提交 hash：尚未提交；原因是现有测试涉及黑名单，等待完整复核后按 R4 处理。

## 2026-10-12 最新 Mac 原生补测（覆盖此前快照）

用户授权重启后，在组合 local 标准身份应用完成：原生选择器在正文中间准确插入 `LEFT @small.txt RIGHT`；CSV/PDF/PNG 混选保持文本引用及二进制内联；PDF+PNG 累计警告显示 289.9 KiB；中文取消、英文 Escape 后附件及草稿保留；Finder CSV 文件复制粘贴走引用、PDF 文件粘贴走内联、未知二进制给出明确拒绝。语言恢复为简体中文，测试草稿清理，未新增真实计费模型请求。

组合重启暴露并修复分享迁移清单遗漏，详见 share-routing/3-changelog。修复包恢复原 local 数据库后连续两次启动，209 个会话及原测试会话均保留。当前 `.app` 位于主工作区 `packages/desktop/dist-deskfox/batch-20261012-local`，保持打开。外部拖放、失效路径及部分异步原生矩阵、Windows 真机仍待验，不能把自动化或旧包通过记作本轮全验收。


## 2026-10-12 开发者接管验收

本轮接管 Computer Use 原生与浏览器验收；完整记录及前后失败/通过日志见交付目录 `开发者接管验收记录.md` 与 `evidence/self-qa-20261012/`。Happy DOM 20.9.0 弱引用回调被 GC 是时间线测试偶发超时根因，增加强制 GC 先红后绿及依赖最小补丁后 App 1195+44 和类型检查通过。真实失效文件引用、中英文大附件取消、切会话草稿恢复、Finder 混合粘贴与累计体积通过。新增首次发布 60 秒总期限测试通过；取消存储不足/权限拒绝和四个落盘边界各自错误/强杀通过，Enterprise 31 项及类型检查通过。两站已有合成页 Chrome 复核通过。新公网分享复测被自动审批拦截，待即时授权，没有绕过；跨应用拖放、其余原生矩阵、Windows/手机和运营验收仍不标通过。运行代码、local 包及两站制品本轮不变，源码未提交。

## 2026-10-13 合并复核

用户在已获知自测结果和剩余验收项后明确要求“按照仓库的规范合并主分支”。本次按授权提交并合入本地 main，功能仍保持 in-progress；合并不等于全部验收完成、正式安装包发布或远端推送。前文“待 R4 审签/未提交”是施工阶段快照，以本节为准。

已复核原 R4 表的逐文件 wrapper 不可行性、风险和验证证据：附件准入、分享生命周期、来源持久化、公开协议和框架出口须在内部接入；外层包装不能可靠改变原有时序。独立逻辑保留在新增文件。现有回归覆盖历史兼容、来源固定、取消恢复、存储故障和页面渲染，未验项仍保留。用户本次明确合并指令作为提交与本地合并授权。

补充测试依赖 R4：Happy DOM 20.9.0 内部 MutationObserver 回调只有 WeakRef，强制 GC 可重现监听失效；补丁在原依赖保留强引用。根 package.json/bun.lock 必须登记同一补丁，业务 wrapper 无法修正依赖内部生命周期。该修复与 GC 回归单独提交，不改产品时间线行为。

采用 conventional commit、feat、bug-repro、override-blacklist 标记；超过 500 行的功能提交附 large-diff 理由。按仓库 pre-commit 明示的 override 机制提交受保护文件，不更改 hook；另检查 diff whitespace、文件名大小写、loopback 与 browser 测试参数。原主目录两处无关改动不纳入提交。回退按各功能提交撤销；分享数据、墓碑、来源凭据不随代码回退删除。

REQ-142/143/144 已实现，自动化与 macOS 原生检查见记录；Finder 真正跨应用拖放、其余原生矩阵及 Windows 待验。
