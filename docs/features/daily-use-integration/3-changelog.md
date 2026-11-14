feat-id: daily-use-integration
status: in-progress
related: ../deskfox-vcs-refresh-overload/1-spec.md ../daily-file-links/1-spec.md ../mcp-toggle-persistence/1-spec.md

# 六项日常使用修复集成验证

## 2026-11-14 追加验收

本轮产品与测试提交为 `48909c6959`；Windows 须包含此提交，旧 local 包没有新增的完整 href 约定。

Mac 多窗口、跨项目隔离、各开关入口、保存失败与完整重启通过，详见 [8-multiwindow.md](./8-multiwindow.md)。OpenAI OAuth 与 DeepSeek API 扩展真实样本通过；OpenAI 首次暴露省略路径问题，已仅在 fork 文件交付 helper 明确禁止省略 href，保留显式格式与内部请求排除规则。10 项请求测试、包级类型、独立复核及完整 pre-push 通过。详细通道结果与前次归因更正见 [9-model-channels.md](./9-model-channels.md)：GetBot/Kimi 调用认证阻断、Anthropic 过期且无对应接入、Alibaba/workflow 未配置鉴权，不能声明所有通道已通过。Windows 交接顶部已有可直接转发文本，尚未代发或代签。未合 main、未发布。

## 接手中（笑南的电脑，Codex 主会话，2026-11-14）

用户已确认六项计划、授权并行实施，并于本轮批准三组实际 R4 补丁提交推送。三个功能分支各自提交后，在 `feat/daily-use-integration` 汇合，验证交互与构建；主干基线 `fc96b0b5b5`，创建前已更新本地 main。该分支不承担版本号或发布候选冻结。

- 范围：REQ-149、REQ-152、REQ-146、REQ-160、REQ-162、REQ-153；功能设计及 R8 用例沿用三个原 feat 文档和规划仓 `需求计划/2026-11-14.md`。
- 已验：各分支完整 pre-push 和专项测试；文件组生产构建及 6 条 Chromium GUI。详见各组回执，不冒充整批验证。
- 本轮：合入三个已获提交授权的分支，处理索引/接线冲突；运行集成代码的完整闸、相关后台测试及浏览器回归；构建隔离 Mac local 包并尽可能完成本机原生场景。
- 验收边界：Windows 真桌面结果交 Windows 电脑；真实模型通道、Office 成功转换及两端负载用例须有实际证据。缺项如实留存，不能用单测或页面 mock 代替。
- 权限：仅功能分支提交/推送与集成验证；合 main、正式发布按既有治理另行执行。

本笔仅登记集成接手；diff 检查与普通提交守卫，docs-only 例外不重复产品测试。功能改动在已有三个 feat 中，不另建重复需求与设计。

## 回执（笑南的电脑，2026-11-14）：批准提交与整批自动化

用户对三组实际补丁明确回复「批准三组提交与推送」。各组冻结补丁 SHA 与获批对象逐一一致；功能分支正常推送完整 pre-push 均通过：

| 分组 | 实现提交 | 已推送功能分支头 |
| --- | --- | --- |
| REQ-149 | `6271ed9d02`（含此前查询键、HEAD/元数据修复） | `54ee8fd5d8` |
| REQ-153 | `ddd1940720` | `fc3a1b5f62` |
| REQ-152/146/160/162 | `eb343b8ce1`（模型约定；此前文件解析/预览分笔保留） | `eb343b8ce1` |

集成合并 `9bd78bba57`、`46e55926ed`、`a4d3ec5691` 只解决 INDEX 同位置新增行，保留所有条目；`session.tsx` 两处独立接线自动合并，没有额外产品修改。三笔合并沿用本轮已批准 R4/大改例外提交，未重复请求同一补丁审批。后续 `caafc2ece3` 只合入 MCP 推送回执。产品树基准为 `a4d3ec5691`；整批头 `caafc2ece3` 已通过正常 push 的完整 pre-push 并推送远端，没有跳过产品推送检查。

- 完整闸：29/29 包类型检查；app 1260+41、media 140、adapter 792、branding 82（8 条既存 skip）、desktop 185、session-ui 137，零失败，日志 `/tmp/daily-use-integration-push.log`。
- 后台专项：在 `packages/opencode` 分三个隔离进程首次运行，Git+HTTP 6 pass/80 断言、MCP+配置 74 pass/197 断言、文件交付 helper/真实 prepare 9 pass/32 断言，共 89 pass/309 断言，零失败、零重试。
- 后台证据：`/tmp/daily-integration-vcs-backend.log`、`/tmp/daily-integration-mcp-backend.log`、`/tmp/daily-integration-file-delivery.log`。真实 Git/FIFO 子进程终止、HTTP 鉴权/目录边界与 MCP 迟到回调均覆盖；不据此声称真实模型或桌面验收。
- 七条浏览器回归已通过（Chromium、单 worker、retries=0、18.5 秒），日志 `/tmp/daily-use-integration-gui-final.log`。首轮文件 6 条通过、VCS 在 SSE 夹具连接前超时，原因是手动 Vite 启动漏了原配置的 `VITE_OPENCODE_SERVER_HOST=127.0.0.1`，默认 localhost 与夹具 URL 不同；按既有配置补齐 HOST/PORT 后全 7 条通过，无产品/测试改动，无放宽断言。该结果是浏览器回归，不是 Electron IPC 结果。
- 文件组最终回执头 `6e8da39dcb` 已合入（仅新增推送记录）。Mac local 独立包与原生验证继续进行。Windows 端待交接；main、正式版本号和发布入口未变更。

## Mac local 验收发现（修复中，不可据前述自动化签完成）

隔离 local 包已成功构建并经 `verify-running-build.sh` 核对真实加载的 asar。2026-11-14 原生 MCP 点击关闭失败：桌面向 sidecar 注入 `OPENCODE_CONFIG_DIR=…/opencode-local`，但当前 Config 静态 `Global.Path.config` 仍为 `…/opencode`；仅 `Global.make()` 服务对象接受该覆盖。目录列表中的自定义 local 目录在项目配置之后加载，覆盖刚持久化的项目 `enabled:false`，随后有效配置校验按设计拒绝。这是本次真实桌面暴露的遗漏启动条件，不能以 74 项测试绿代替修复。正在补复现与最小来源区分修复，保持明确环境强制配置/托管配置的优先级。

同轮项目外特殊文件名读取、两个 DeepSeek 真模型产物经 Electron IPC 读取、错误分支及真实 DOCX→PDF（HTTP 200，12227 字节）已通过；完整桌面证据稍后补记。REQ-149 两版本普通聊天提交负载对照仍未完成，不能用 question reply 的浏览器用例替代。

补充修复已经完成包级红绿复现和独立复核：只给桌面自动注入的默认目录标记来源，仅重放当前项目 MCP enabled 布尔值；非空显式目录、CONTENT/组织/managed 强制配置保持优先。完整配置/MCP 177 项、desktop helper 7 项、两包类型及整批完整 pre-push 全通过。冻结产品补丁 `/tmp/daily-use-mcp-native-fix.patch`，SHA256 `ec8a042c6d3b097b600693b655309f97eaff36fb08783e9b68494db591a0b7f1`。重建后实际打包 Electron 的按钮经 CDP 驱动，开启/关闭、刷新和完整主进程+sidecar 退出重启均通过，手动开启才恢复；新旧 PID 和全局 true/项目 false 的证据详见 Mac 回执。修复后 CUA 工具不可用，不将本轮 CDP 驱动等同 CUA/人工鼠标复验。新增 R4 提交审批已向用户提出、尚待回复；不能冒用先前三组冻结补丁的批准。详情见[补充复核](../mcp-toggle-persistence/4-native-config-review.md)。

## 证据与交接入口

**补充提交回执（笑南的电脑，2026-11-14）**：用户明确回复「批准补充修复提交与推送」。7 文件产品/测试暂存 diff 的 SHA256 与上述冻结对象一致，连授权回执提交为 `f517fc04b4`；正常 push 再次完整闸通过并推送到 `feat/daily-use-integration`，日志 `/tmp/daily-use-mcp-native-approved-push.log`。上段“待回复”为此前状态，现已解除；未合 main、未发布。Mac T04 修前后负载对照继续进行。

- [Windows 执行交接](./4-windows-handoff.md)：六项最小夹具与通过条件，明确无人接手、不能沿用旧 REQ-149 Windows 回执。
- [真模型记录](./5-model-smoke.md)：DeepSeek API 真实读写返回有效链接，目标内容已验证；GetBot 401、OpenAI OAuth 未知服务错误分别保留，不算通过。未发现 workflow 真通道，未测试过期 Anthropic。
- [Mac local 原生回执](./6-mac-local.md)：真实 Electron IPC、CUA 点击、Office 转换、目录跳转、真实 watcher 短样本与 MCP 首次失败/复验，区分所有证据层级。local 启动曾改变默认协议 handler，已恢复 `ai.deskfox.app`；本轮后续启动均立即恢复并保留正式/既有 voice 进程，未把范围外修复并入六项。

**Mac T04 后续回执（笑南的电脑，2026-11-14）**：精确 `fc96b0b5b5` 修前包与含 `f517fc04b4` 的候选包，六组各执行一次，原始数据及统计经独立复核。候选空闲/ignored/mixed 30 次展开与 30 次普通聊天提交全部 ≤1 秒、全部消息落库；负载后自然清空。基线两种负载各有一次展开及提交 ≥2 秒超时，静默十秒后仍有 21/44 条未完成请求。两版均为实际打包 Electron、真实 watcher/Git/HTTP/SQLite，仅模型使用 loopback stub；CDP 驱动不冒充人工 OS QA。候选实际约 19.34Hz、基线约 19.60–19.63Hz，单轮短测不能外推长期/多机稳定性。逐次数据、依赖/包来源及退出证据见 [7-mac-vcs-load.md](./7-mac-vcs-load.md)。此回执解除前文 Mac T04 待验状态；六轮 QA 应用/后台及假模型均已停止，既有应用保留、默认协议恢复。

六项仍为 in-progress。整批发版前尚需 Windows local（含 T04）、完整已启用模型通道矩阵及其他原 spec 未验项；不把代码集成、浏览器绿或单个真模型样本当作发布验收完成。当前功能提交为 `f517fc04b4`，已批准且正常完整闸推送；后续为验收文档，无新增产品变动，未合 main、未冻结候选、未发布。

## 回执(Windows 电脑,2026-11-14)

Windows 11 家庭版 x64（10.0.26300，YUEXI），Git 2.52.0.windows.1，Bun 1.3.14。接手时从 GitHub 获取的完整头为 `0c2b6bbd6e987187fc7f4e0ef8cd07c2fa10ca92`。确认包含 `f517fc04b42cbb9e47439832dec05f7b23c7a8dc` 和最终产品提交 `48909c6959fa0f02c87c85d945470946e92a65ce`。接手登记已推送，构建时头为 `30d0d13afa2371190212959c3cb7ba25195e63b4`，相对接手时的头仅增交接单登记。修前基线为 `fc96b0b5b5c8f4fce55875ec42b328f4731d6cc5`。

候选和基线分别在独立 worktree 以 Bun 1.3.14 冻结安装，从各自的树执行 `pwsh -NoProfile -File packages/branding/scripts/build-deskfox-electron.ps1 -Env local`，均生成包含 LibreOffice 的 x64 win-unpacked 包。初次安装日志保留了 Bun 缓存冲突和 Node 原生依赖等待，补齐同版 Node 头文件后冻结安装成功用时 46.07 / 58.86 秒，构建用时 293.10 / 258.71 秒（候选 / 基线）。两版 bun.lock SHA-256 同为 `1563688f944b9a8a2d844c1877274c8bc345dac665a3fa437c6a75992df2101e`。

| 包 | exe | exe SHA-256 | app.asar SHA-256 |
| --- | --- | --- | --- |
| 候选 | `D:/project/deskfox-win-daily/packages/desktop/dist-deskfox/win-unpacked/DeskFox 本地版.exe` | `995253f32183e238778bc0375c5d5146f7ed4c010b1debb4f77b838943c276f9` | `9f896b89b4814e9f80dd45789b4cf2d19aa7b8688f57060d59deb00990b1bf51` |
| 基线 | `D:/project/deskfox-win-daily-base/packages/desktop/dist-deskfox/win-unpacked/DeskFox 本地版.exe` | `36c01a5b349f68659995c0167fae80ccdafbebd86b947d3cf4ba5745ce1b47e1` | `7d6e154e300d60ee40e78c94f7da50510bc76ca30b77e2258d50cc71b97aab25` |

实际启动确认 LOCAL 徽标。独立 AppData、HOME、XDG 数据/配置/缓存、A/B Git 项目、Downloads 合成文件和 SQLite 独立。应用自带预览、watcher 与请求处理走打包版 Electron/CDP；截图采自该渲染器，Computer Use 检查到候选窗口和 LOCAL。两包启动都曾报告内置媒体插件固定端口 51737 已由在用正式版占用，正式版保留，六项中的普通聊天和预览走隔离 sidecar。模型仅收到合成夹具任务，复用的鉴权材料只存在于临时隔离配置，随相应运行清理。

| 项目 | 结果 | 实测 |
| --- | --- | --- |
| REQ-149 请求积压 | **未通过本轮指标** | 六组 60/60 普通聊天收到 HTTP 204 并落库，最长 161.0 ms。各组 8/10 次目录展开 ≤1 秒。候选 mixed 判定峰值 1，40 秒仍有 1 条短请求，初始窗口未观察到 mixed 的 diff 完成。直接 diff 21.30 秒。已打开的忽略文件预览能更新。详见 [同机对照](./10-windows-evidence.md)。 |
| REQ-152 文件链接 | **通过** | 文档中的五个盘符链接均命中内容标记，字面 %20 与空格文件区分正确。五个文档链接耗时 144–339 ms。DeepSeek 真模型生成的同五组源文件 href 也逐一点开并核对内容。 |
| REQ-146 目录跳转 | **未通过重访场景** | 同文档返回及缺失锚点正确，首次跨文档跳转成功。复现：先打开目录并返回顶部，切到另一份含同名标题的文件，再从入口点回目录；目录打开后目标未入视口。目标顶部 2330 px，窗口高度 902 px。保留首次成功与两次重访失败截图。 |
| REQ-160 项目外预览 | **本机与显式 HTTP 连接通过，WSL 未测** | PDF、DOCX、XLSX、PPTX 均显示唯一文本标记。PDF 约 0.50 秒，XLSX/PPTX 约 3.54/3.55 秒。DOCX 首轮 20 秒时仍在加载，HTTP 200 在约 21.72 秒完成；独立冷启复测返回 20,553 字节，点击至标记显示约 6.51 秒。项目外 Markdown/文本、缺失文件提示、旁边图片/样式不加载均核验。显式 HTTP 测试走独立地址的 loopback 转发，拒绝读取本机同名 PDF。本机没有 WSL 发行版，WSL 保持待验。 |
| REQ-162 真模型 | **DeepSeek 通过，OpenAI OAuth 未通过** | 候选包中的 DeepSeek `deepseek-chat`（OpenAI-compatible API）真实读取五个合成文件，用时 10.83 秒，生成中文空格报告用时 6.07 秒；未显式要求链接或 Markdown，返回的 6 个完整编码链接均可点击并命中内容。不存在的同名文件未生成链接。第一次显式 `@ai-sdk/deepseek` 初始化失败，留存；OAuth `openai/gpt-5.6-luna` 多次 WebSocket 建连超时，在 97.5 秒观察窗内无完整回复。其余工作流、桥接和无可用凭据通道未测。 |
| REQ-153 MCP | **双窗口、双冷启、只读和同名定义通过** | A 窗口关闭后另一 A 窗口同步，B 保持开启，切回 A 仍禁用。落盘仅增加 MCP enabled 覆盖，保留既有注释与配置，应用配置补齐 schema，连接参数未复制。退出应用与 sidecar 后冷启两次仍禁用，手动恢复后重启保持开启。只读保存返回错误且 UI 保持，恢复可写后可切换。项目同名定义保留参数，全局定义移除后仅 enabled 覆盖不启动，重新加入后仍按项目意图禁用。慢 stdio 连接关闭后保持 disabled，子进程已退出。 |

REQ-149 详细复核中，tracked 与未跟踪文件合批更新用时 19.83 秒，切 detached HEAD 和分支的组合验证用时 34.85 秒，A 的在途请求期间切至 B 未污染 B。对 force-tracked 文件执行 `git rm` 后，第一个 diff 未列出删除，第二个正确出现 `deleted`，用时约 36.71 秒。串行补测的 10 次目录及 10 次普通提交都在 1 秒内，40 秒时仍有一条 diff 在途。并发样本与串行补测均留档。

REQ-153 另通过实际普通消息请求核对工具列表。fixture 开启时工具存在，项目关闭后工具消失，检查用时 5.88 秒。B 和同 Git 仓另一个 worktree 均保持 connected。第二个 worktree 首次实例化时，应用向其配置补写了 schema，未写 MCP 配置。该 worktree 完成初始化后的复验通过，切换前后配置字节一致，用时 8.75 秒。

[Windows 证据与负载表](./10-windows-evidence.md) 收录代表截图、请求与落库数据索引和完整日志位置。真实模型和工作区证据仅使用本轮合成数据。整体结论为 **Windows 未签整批通过**。本次为功能分支验收，未合 main、未发布。

## 缺陷复验回执（Windows 电脑，2026-11-14）

在独立 worktree `D:/project/deskfox-win-daily` 复现两项缺陷并补齐回归。以 `525fe662efcab4a1d9b54268bc2e24ae1c2425c8` 加冻结产品树 `36dd62205aeb1bd6aab19689e824c947dbed0e9a` 用 Bun 1.3.14 冻结安装、重打 Windows x64 local 包。exe SHA-256 为 `a7dc5675ca55596e2843642897edf54910ed99ba107156ab80976e1fa7c35d26`，app.asar SHA-256 为 `366d8f52541881d7d131c5d4e77b0b48ae4a2494281bd4a540017377103f3af7`。隔离 Electron 实测使用本轮新包，配置、数据库和 Git 项目均为临时夹具。

| 项目 | 专项复验 | 实测 |
| --- | --- | --- |
| REQ-149 diff 刷新过慢 | **通过** | 同机直接 diff 从 21.30 秒降至 358 ms，均返回 188 项。新包三组共 30 次普通聊天收 HTTP 204 并落库，最慢 124 ms；30 次目录展开均出现子项，最慢 150 ms。混合轮 39 次 diff 全部完成，最慢 708 ms，diff 与分类各最多一条在途，停写十秒后清空。独立测试确认 force-tracked 删除到有效 diff 为 1.10 秒，首条响应仍可能早于删除。 |
| REQ-146 跨文档重访锚点 | **通过** | 按原路径跨过含同名标题的另一文档重访。标题顶部由超出屏幕的 2330 px 恢复至 162.8 px，1.3 秒后仍完整可见。Computer Use 原生鼠标点击重访结果一致。浏览器回归同时覆盖普通切签滚动恢复。 |

HTTP ignored 用例在并行构建时曾触发既有保守刷新，保留失败，空出构建负载后相关三组通过。这里记录 Windows local 包的 CDP 专项复验和原生鼠标锚点补验。其余四项、WSL 和此前未通过的模型通道沿用原验收状态。

用户已批准本次 R4 冻结补丁提交与推送。产品提交 `7e14b0e48913b822758d7db37dff003fca7a9e20`，提交 diff 与获批补丁 SHA-256 一致。正常推送至 `feat/daily-use-integration` 时，完整 pre-push 通过。本次未合 main、未发布。

[详细数据、截图、日志和 R4 冻结复核](./11-windows-followup.md)。

## 剩余项补验回执（Windows 电脑，2026-11-14）

独立 worktree 从最新产品分支头 `9890fd8616d3074a90e6711afb922777b93bcc97` 执行 Bun 1.3.14 冻结安装并重打隔离 Windows local 包。exe SHA-256 为 `4d3441636bed0ca7638ec60a02d6bdd3d5793b30bd75bfa351d451d56a8ade5d`，app.asar SHA-256 为 `466b72ae308de0c327cda5da044532b4dbf9ee51c92f5eaefdb684a73e73cb7e`。

| 项目 | 本轮结果 | 实测 |
| --- | --- | --- |
| REQ-162 OpenAI OAuth 真模型文件链接 | **未通过** | `openai/gpt-5.6-luna` 经建连重试后实际读取五个文件并写入中文空格文件，分别用时 127.27 / 24.23 秒。回复正确说明错误子目录中的同名文件不存在。六个链接有五个显示正确内容，含生成文件；字面 `%20` 文件的 href 多编码了一个空格，实际点击提示「文件不存在」。 |
| REQ-160 WSL 项目外预览隔离 | **通过** | 使用实际 WSL 2 Alpine 与 Linux OpenCode sidecar。项目内文本正常显示。点击两条 Linux 项目外 PDF、DOCX 和四条 Windows PDF、DOCX、XLSX、PPTX 路径，全部提示仅支持本机桌面会话，未打开项目外文档，未改变会话。 |

[包哈希、模型原文、逐项截图和日志](./12-windows-oauth-wsl.md)。其余未验通道沿用原状态，Windows 整批尚未签通过。未合 main、未发布。
