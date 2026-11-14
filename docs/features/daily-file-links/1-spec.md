feat-id: daily-file-links
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 文件链接与查看

审签补记（2026-11-14）：用户对主 agent 汇总的 REQ-149 过滤与本节 B 项目外内部预览方案明确回复「批准两项施工方案，继续并行推进」。B 的 Large 施工门已通过；C 的具体 R4 提交仍待实现及测试后的单独复核。

范围依据：用户确认的 2026-11-14 六项计划，本组覆盖 REQ-152、146、160、162。执行：笑南的电脑 / Codex `file_links`，独占 `fix/daily-file-links`。

## A. 编码与锚点（可独立交付，Medium）

聊天和文件预览共用 `md-link-click.ts`，先从原始 href 分离片段，再对路径和片段各解码一次；非法百分号保留原文。保留 Windows 盘符和反斜杠；解码、归一化后仍执行现有项目边界检查，不借此放开项目外读取。

纯 `#fragment` 点击在当前 Markdown 容器内寻找 ID（兼容 `user-content-`），滚动到章节并阻止原生路由导航；不存在也不整页跳转。同页存在重复 ID 时只选择点击所属 Markdown 容器。

`file.md#fragment` 检查并打开真实文件路径，片段传入一次性导航请求，待该 Markdown 内容渲染后滚动。请求仅关联目标 root/path，不在其他文档误跳。

R1：核心逻辑在 fork-only `md-link-click.ts`、新 fragment helper；现有 `file-tabs.tsx` 仅 import + 一处挂接（不超过 5 行）。不改 Markdown 底层渲染器或上游 UI 黑名单。预计代码与测试 300–450 行，无新依赖。

## B. 项目外成品（施工方案，待 Large 审签）

目标体验是 DeskFox 内只读预览，保持当前项目与目录树不变。增加独立文件预览对话框，复用 Markdown/PDF 渲染组件；桌面主进程新增单文件读取 IPC，输入确切绝对路径，返回该文件的已校验内容，不授权父目录、不把 root 扩成 `/`。

主进程解析 realpath、验证普通文件与大小、白名单文档类型；错误区分缺失/权限/离线/过大/不支持。符号链接不获得父目录权限。Markdown 内资源默认不自动读取旁边其他文件；HTML、脚本不执行。项目外 Markdown 内链须再次点击、按同一单文件入口处理。文本/Markdown 设 2 MiB、PDF/Office 设 50 MiB 限制，超过限制明确提示，防止大文件进入 renderer 内存。

Office 使用现有 `file.officePdf({path: canonicalAbsolutePath})`：当前 handler 已接受绝对路径，复用既有 LibreOffice 的单文件转换和错误处理。进入转换前先走 native 单文件元数据校验（普通文件、大小、类型），不改 server 的根目录/HTTP 契约；PDF 使用现有 DocumentViewer。类型覆盖 txt/md/json/csv/常见代码文本、PDF、doc/docx/xls/xlsx/ppt/pptx/rtf/odt/ods/odp；无法预览的类型显示明确原因，不启动默认应用、不执行文件。

只接受桌面内建本机 sidecar 会话发起的本机路径；远端/WSL 会话不尝试读本机同名文件，明确反馈。默认应用打开不作为隐式回退；如有不能在内部预览的格式需另确认产品策略。

具体触点：新 `packages/desktop/src/main/deskfox/document-preview.ts` 与真实文件测试；fork-only `deskfox/ipc.ts` 注册命令；新 app `components/dialog-document-preview.tsx` 与入口 helper；共享 `md-link-click.ts` 在项目外路径转交该入口；`session.tsx`、`file-tabs.tsx` 各增加少量注入（内建 sidecar 来源、dialog、Office SDK）。不更改 `local-asset.ts` 协议授权，不改上游 core/UI。预计新增代码+测试 600–900 行，按 Large 在动代码前审签。本节尚未表示已获实施批准。

## C. 模型文件交付（施工方案）

将“已定位文件应输出 `[文件名](真实路径)`，不能猜同名文件、不能虚构路径；路径空格/百分号正确编码”的约定注入实际使用的所有模型通道。共享 `LLMRequestPrep.prepare` 是原生、AI SDK 和 workflow 汇合点；原生提供方的 OAuth instructions 也由此派生。插件桥接需要继续核查插件是否保留 system 内容，不能仅改某一模型 prompt。

链接语法使用绝对文件路径、按路径段编码空格/中文/百分号，保留 `/` 分隔与 Windows 盘符，例如 `[报告.pdf](/Users/name/Downloads/report%20draft.pdf)`、`[说明.md](C:/work/docs/guide.md)`；不输出 `file://` URL，不给未经定位的裸文件名拼接猜测地址。遵守用户明确要求的输出格式；不改代码示例里的文字。

已核查飞书 pipeline 的兼容记录：Claude Code 等桥接可能忽略 system 提示，不能只追加 system。选择在 `LLMRequestPrep.prepare` 汇合点调用 fork helper：system 加一次同一约定；发送给模型的 messages 副本中最后一条用户消息追加明确标记的 DeskFox 文件交付提示，字符串和 text-part 数组两种形态都支持。只改请求副本，不修改原消息、持久化历史、工具调用/结果、图片/文件 parts，不生成额外用户轮次；重复调用不重复附加。

该请求副本同时流向 AI SDK、native runtime、OAuth/workflow 和 provider 插件，桥接即使丢弃 system 仍能从用户文本收到约定。未知第三方桥接若连用户文本也自行改写不在客户端可保证范围，必须在真实启用通道抽查中暴露，不能宣称结构测试等于全部模型服从。

具体触点：新 `packages/opencode/src/session/llm/file-delivery.ts` 与单元/prepare 集成测试；`llm/request.ts` 两处调用（system 注入、messages 包装，合计预计 ≤5 行，加 FORK marker）。`request.ts` 在 upstream-base 中存在，命中 R4：wrapper 自身无法接入统一 prepare，需要此注入点；风险是提示增量/缓存成本及消息格式兼容，测试覆盖不可变、重复、混合 parts、OAuth/workflow/native。施工后复核材料与 diff 交李哲确认再提交该黑名单变更。新增插件安装方案会额外修改安装器与用户配置，还不能保证 system-only 插件桥接生效，故不采用。

旧会话裸文件名不批量猜测改写，既有有效链接继续可用。模型真实抽查须使用测试项目及用户已有可用通道，不接触生产会话。

## R8 用例

- [ ] A1 单元：空格、中文、`%2520` 单次解码与非法 `%`，检查真实打开参数；聊天/预览基准目录各测。
- [ ] A2 单元：编码点段/分隔符、Windows 盘符、跨根仍受边界约束。
- [ ] A3 DOM：ASCII/中文编码/`user-content-` 锚点定位；不存在不导航；相同 ID 的其他消息不被滚动。
- [ ] A4 DOM：`file.md#fragment` 不把片段作为文件名；目标内容延迟渲染后跳转；切文件不误跳。
- [ ] A5 GUI：聊天链接、Markdown 目录、普通外链、浏览历史往返不丢 SPA，检查内容可见。
- [ ] B1 IPC 集成：普通文档/PDF/中文空格/历史路径能读取；symlink 仅实际单文件，不能扩成目录；脚本不执行。
- [ ] B2 IPC：缺失、权限、磁盘不可用、超限、类型不支持有准确结果。
- [ ] B3 GUI：远端/WSL 路径不调用本机 IPC；项目内预览保持原有行为。
- [ ] B4 Mac/Windows local：项目外 PDF 与普通文档真实看到内容，不以打开空对话框算通过。
- [ ] C1 集成：原生/AI SDK/OAuth/workflow/启用插件模型均收到共享约定；原始/持久化历史消息、工具 parts 不改写，仅模型请求副本追加应用提示。
- [ ] C2 真模型：每类实际启用通道抽查生成和引用文件，返回有效链接并实际打开；同名文件不猜，网页和代码示例不被误写。
- [ ] 闸：app 包级 typecheck、相关自动化与完整 pre-push；不得用 unit 代替真桌面/真模型。

## 回退

A/B/C 分笔提交，可分别 revert。任何请求权限扩大、外部代码执行或错误文件打开都阻止验收；未经双端回执不能标 done。
