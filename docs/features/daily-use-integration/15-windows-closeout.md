feat-id: daily-use-integration
status: in-progress
related: ./3-changelog.md ./4-windows-handoff.md

# Windows 六项验收收口

执行端为 Windows 电脑（YUEXI），Windows 11 x64 10.0.26300.9974，Git 2.52.0.windows.1，Bun 1.3.14。接手时远端功能分支头为 `5fa21778b9b478be3c8e03c0f2afe9db0875a2ae`。接手登记 `dd9e7ade99c520846e2d10b3f7940cf3c9bae213` 只改交接文档。验收涵盖 `f517fc04b42cbb9e47439832dec05f7b23c7a8dc`、`48909c6959fa0f02c87c85d945470946e92a65ce`、`7e14b0e48913b822758d7db37dff003fca7a9e20`、`a5c91952300bc8d4ccf274db7a0431c30c215cd2` 和最终产品提交 `09d0615cc77c96d2213832b0475bf01f95855172`，均已用 Git 祖先关系核对。

## 回执核对

| 需求 | 此次验收前已证实 | 核对时仍有的边界 |
| --- | --- | --- |
| REQ-149 | 新旧包实测目录展开、普通聊天 HTTP 204 和 SQLite 落库。新包直接 diff 358 ms，混合轮 diff 与分类各最多一条在途。实测 tracked、未跟踪、删除、HEAD、切项目及 ignored 文件预览。 | 旧对照有一轮与打包重叠。需在构建结束后成对跑基线和最新包。结论适用于单窗口短时负载。 |
| REQ-152 | 文件预览和真模型聊天分别点开五种 Windows 盘符链接，区分真实空格、字面 `%20`、中文、百分号和井号。 | Windows 文件名不能含 `?`。错误编码的历史回复已有专项回放证据。 |
| REQ-146 | 同文档来回及缺失锚点、跨文档首次和同名章节间重访通过，重访有原生点击证据。 | 在最新包补查普通外链和会话历史前进、后退。 |
| REQ-160 | 项目外 PDF、DOCX、XLSX、PPTX、Markdown、文本可见内容，缺失文件提示，旁边资源不加载。显式 HTTP 和实际 WSL 有项目外隔离证据。 | Windows 端补查实际的权限、格式、编码及容量错误。磁盘离线需有能实际返回对应系统错误的设备。 |
| REQ-162 | DeepSeek API 和默认 OpenAI OAuth 各有真实读写、六条链接与正确文件内容证据，OAuth 原失败和 101 握手记录可核对。 | 本机认证清单只含 DeepSeek API 和 OpenAI OAuth。单独核查原生运行时样本、网站和代码示例。GetBot、Kimi、Anthropic、Alibaba、工作流和模型桥接待可用通道。 |
| REQ-153 | 双窗口与 B/同仓另一 worktree、两次冷启、手动恢复、只读保存失败、同名覆盖、迟到连接和请求工具列表已留证。 | 补查另一个 UI 入口、运行时连接失败与显式禁用的区别。本机使用受控 MCP 夹具。 |

原始资料按需引用。[初次 Windows 证据](./10-windows-evidence.md) · [负载与锚点修复后证据](./11-windows-followup.md) · [真实 WSL 和 OAuth 原失败](./12-windows-oauth-wsl.md) · [字面百分号回放](./13-windows-oauth-fix.md) · [默认 OAuth 六链和握手](./14-windows-oauth-websocket.md) · [既有通道认证诊断](./9-model-channels.md)。

## 新构建

独立 worktree `D:/project/deskfox-win-final` 从接手远端头的干净树 `6912b02e6c1bcf3a087e4983458b448108e3c13c` 重新构建。Bun 1.3.14 用单次 registry 参数执行冻结安装，68.88 秒。锁文件 Git blob 为 `5b829249afb0ae32cd812c2f5a043a29b82c65fc`，CRLF 工作文件 SHA-256 为 `1ce5abf5925e81ae0a5f2ab9ef769706a903b2c4471a1bf4dcbc315b1725bd8b`。首次构建因 models.dev 连接重置退出。重新用压缩下载获得完整目录 JSON，校验包含所需供应商，通过构建脚本既有 `MODELS_DEV_API_JSON` 输入。目录快照 SHA-256 为 `cd6306210d8182d401597795d3c1e7b768ace88dc0b8c9708ed30143b1f3961e`。执行 `pwsh -NoProfile -File packages/branding/scripts/build-deskfox-electron.ps1 -Env local` 用时 376.49 秒，确认包内含 LibreOffice。

产物为 `D:/project/deskfox-win-final/packages/desktop/dist-deskfox/win-unpacked/DeskFox 本地版.exe`。新生成 EXE SHA-256 为 `216df402a82a5b8968dc184d495b7002c404c2ea6e8743108e342dc31e4586fc`，新生成 app.asar SHA-256 为 `02bcc87ed8348a35c2636659e92c12d1cceaeb93a0aedea982beb78fe5e0dc36`。旧输出目录先归档至 `D:/tmp/deskfox-daily-win-20261114/before-closeout-dist`。两次构建产物字节一致，本轮运行生成时间为 23:29–23:32 的新输出。

## REQ-149 同机负载

修前包来自 `fc96b0b5b5c8f4fce55875ec42b328f4731d6cc5`，EXE SHA-256 `36c01a5b349f68659995c0167fae80ccdafbebd86b947d3cf4ba5745ce1b47e1`，app.asar SHA-256 `7d6e154e300d60ee40e78c94f7da50510bc76ca30b77e2258d50cc71b97aab25`。本轮新建 A/B 合成仓库。负载六组全部在打包结束后串行执行，同一项目快照保留 186 个未跟踪文件，每个 100 行。每轮冷启单窗口，预热动作一致，正式窗开始时均无在途。基线预热的两次 tracked 修改在各自 4 秒观察窗内未见 diff 200，最新版均见到 200。这项行为差异随原始日志留存。搭建期间三组基线试跑保留在本机。

每轮采样 30 秒、停写后再观察 10 秒。每个采样点先点目录并等待真实子文件，再点 Send 并等待同一普通聊天的 `prompt_async` 返回 HTTP 204，付诸 SQLite 复核。模型用 loopback stub。基线与最新版的仅忽略轮均实写 599 次，混合轮均为 599 次忽略快照替换和 29 次 tracked 修改，忽略写入约 19.97 Hz。六轮 Git porcelain 原文 SHA-256 同为 `7c0fdafc052672458268ddd84c2fa057b8ce8e48b591837c9ddf255a8667f975`。

| 包 / 组 | 目录中位 / P95 / 最大 ms | 提交中位 / P95 / 最大 ms | 普通提交落库 | diff 发出 / 完成 / 峰值 | 分类发出 / 完成 / 峰值 | 停写 / 10 秒后在途 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 基线 / 空闲 | 73.2 / 101.0 / 101.0 | 105.4 / 114.9 / 114.9 | 10/10 | 1 / 0 / 1 | 0 / 0 / 0 | 1 / 1 |
| 基线 / 仅忽略 | 75.1 / 107.6 / 107.6 | 106.0 / 123.0 / 123.0 | 10/10 | 6 / 0 / 6 | 0 / 0 / 0 | 6 / 7 |
| 基线 / 混合 | 78.2 / 97.8 / 97.8 | 106.7 / 128.1 / 128.1 | 10/10 | 94 / 1 / 94 | 0 / 0 / 0 | 106 / 108 |
| 最新 / 空闲 | 61.7 / 120.2 / 120.2 | 86.1 / 108.5 / 108.5 | 10/10 | 10 / 10 / 1 | 0 / 0 / 0 | 0 / 0 |
| 最新 / 仅忽略 | 68.5 / 103.0 / 103.0 | 87.3 / 200.6 / 200.6 | 10/10 | 10 / 10 / 1 | 118 / 118 / 1 | 1 / 0 |
| 最新 / 混合 | 78.6 / 114.9 / 114.9 | 100.6 / 120.7 / 120.7 | 10/10 | 36 / 36 / 1 | 108 / 108 / 1 | 2 / 0 |

两包各 30/30 次目录及普通提交均在 1 秒内。基线混合组唯一完成的 diff 用时 23.74 秒，观察末仍积压。最新版混合组 diff / 分类最大分别为 672 / 288 ms，浏览器开始发包前最大分别为 4.00 / 22.42 ms。仅忽略组的 118 次分类均为 false，diff 次数与空闲组同为 10。混合组 29 次分类返回 true，停写十秒后非 SSE 在途归零。峰值指各路浏览器未完成请求，各自计数。[六组逐次样本、落库与请求事件](./15-windows-evidence/closeout-load.json) · [混合组截图](./15-windows-evidence/load-mixed.png)。

新包直接 diff 469 ms，打开的 ignored 文件能见到更新。tracked 与新 untracked、切分支、切 detached HEAD，以及 A 请求发出后切到 B 的隔离均通过。组合场景中删除后的首条响应仍可能遗漏删除，原始结果保留。独立从本次 `git rm` 起持续观察的用例确认 930 ms 时 classifier 为 true 且 diff 为 `deleted`。这项按用户看到正确刷新的结果验收。

## REQ-152、REQ-146、REQ-160 本机与 WSL

Windows 文档的五个盘符链接 5/5 显示匹配内容。字面 `%20` 与空格分别使用 `report%2520draft.md`、`report%20draft.md`，两者打开不同文件。五项测试步骤用时 541–699 ms。Windows 的 `?` 字符限制保持原先平台边界。

同文档来回及缺失锚点通过，首次跨文档与含同名标题文档之间的重访通过。重访 1.3 秒后目标顶部为 162.8 px，底部为 186.8 px。[锚点与文档链接截图](./15-windows-evidence/anchor-revisit.png) · [字面百分号截图](./15-windows-evidence/literal-percent.png)。

从标题栏新建会话，前进和后退均到达预期页面。点击跨文档锚点前后，会话 URL 与浏览历史长度相同。首轮因侧栏遮挡不能点击，第二轮等待的路径来源与实际路由不同，记录均留存。最终采用实际会话 URL 推导项目路由，并按标题栏入口复验通过。普通外链触发用户发起的 `Page.windowOpen`，保持原路由与历史。默认浏览器访问夹具页面的 GET 未捕获，证据止于 DeskFox 的外链交接。[会话导航截图](./15-windows-evidence/navigation-history.png) · [外链交接记录](./15-windows-evidence/external-browser-result.json)。

本机项目外 PDF、DOCX、XLSX、PPTX 的步骤耗时分别约 0.44、21.52、3.04、2.99 秒，Office 实际转换均 HTTP 200，显示独立内容标记。DOCX 冷转换约 21.5 秒。项目外 Markdown 和文本显示内容，Markdown 中的相邻图片/CSS 资源未载入。项目树和会话路由保持。Windows 原生鼠标点击项目外 PDF 后，实际预览显示 `OUTSIDE_PDF`。缺失、只给隔离文件设置 ACL 拒读、超 2 MiB 文本、非 UTF-8、目录、未知扩展分别显示可区分的错误。夹具 ACL 已恢复。断开真实磁盘产生的系统错误仍待设备复验。[原生点击 PDF 截图](./15-windows-evidence/native-preview.png) · [Office 截图](./15-windows-evidence/outside-docx.png) · [权限拒绝](./15-windows-evidence/outside-permission.png) · [超限提示](./15-windows-evidence/outside-too-large.png)。

最新 Windows 包的显式 HTTP 连接拒绝本机项目外 PDF。另从留证导出的 Alpine 3.23.5 镜像临时注册 WSL 2，真实 Linux OpenCode 1.18.16 通过应用原生 IPC 启动。项目内文本对照通过。实际点击 Linux 与 Windows 共六条外部 PDF/Office 链接，全在点击后 21–81 ms 显示限制提示，未产生本机预览请求，路由保持。测试发行版已注销。[WSL 后端与路径](./15-windows-evidence/wsl-connection.json) · [六条 WSL 记录](./15-windows-evidence/wsl-checks.json)。

## REQ-153 MCP

同项目 A 另一窗口同步关闭；跨项目 B 和同仓另一 worktree 均保留 connected，后者配置字节在核对前后相同。A 两次完整冷启仍 disabled，探针均记录 A 启动 0 次、B 正常启动。手动恢复后下一次冷启动 A 重新连接。真实普通消息请求的工具列表随项目开关更新。只读配置拒绝保存且控件仍显示原状态，项目同名定义保留连接参数和注释，删去全局定义后单独 enabled 覆盖不启动，恢复定义后沿用 disabled。慢 stdio 夹具在初始化未完成时关闭，约 14.86 秒观察末仍 disabled，子进程已退出。

本机 MCP 使用真实 stdio fixture 和未监听的 loopback 端口构造连接失败。连接关闭时对话框显示 `failed` 和 `ECONNREFUSED`，项目显式禁用后同一项显示 `disabled`。首轮在后台项目已预热后才改夹具，得到缓存旧状态，保留失败，更新夹具后销毁隔离实例再复验通过。外部带鉴权的真实 MCP、未配置的服务及长期高并发未签。[双窗口同步](./15-windows-evidence/mcp-second-window.png) · [连接失败提示](./15-windows-evidence/mcp-connection-failure.png)。

状态面板 MCP 行也可切换。从 disabled 开启后，后台变为 connected、项目配置已保存，快捷键 MCP 对话框同步显示开启，最终恢复初始状态。点击完成后状态面板会关闭，先前采集程序在已关闭的面板里找 switch 超时，记录保留。本轮实际使用状态面板在另一入口核对结果。[状态面板](./15-windows-evidence/mcp-status-popover.png) · [快捷入口同步](./15-windows-evidence/mcp-status-reflected.png)。

## REQ-162 可用真实模型

模型任务仅访问合成项目。任务要求读取五个文件、说明一个未知子目录里的同名文件、保留示例网站和命令，然后真正写入并回读一个新报告。两个用户提示均未指定 Markdown 或要求输出文件链接。

| 通道 | 结果 | 读取 / 写入 | 文件点击 |
| --- | --- | ---: | --- |
| 默认 OpenAI OAuth `openai/gpt-5.6-luna`，AI SDK | **通过** | 28.91 / 15.12 秒 | 6/6，162–2448 ms |
| DeepSeek `deepseek-chat`，显式 OpenAI-compatible 配置，AI SDK | **通过** | 12.36 / 6.06 秒 | 6/6，139–2548 ms |
| 默认 DeepSeek API `deepseek/deepseek-flash`，AI SDK | **通过** | 13.77 / 7.59 秒 | 6/6 |
| 实验开关 `OPENCODE_EXPERIMENTAL_NATIVE_LLM=true`，同一真实 OpenAI OAuth | **未通过** | 9.82 秒测试步骤结束 | sidecar 确认 `llm.runtime=native`，返回 `RequestExecutor.execute: HTTP transport failed`，没有完整回复和可验链接 |

三组通过样本中网站保留为 `https://example.com/` 链接、`cat example.txt` 保留为代码，缺失同名文件未生成链接。字面 `%20` 和真实空格文件都命中各自内容。DeepSeek 默认配置首轮选了未出现在实际 provider 目录里的 `deepseek-v4-flash`，在发请求前退出并保留记录。之后改用目录中已连接供应商提供的 `deepseek-flash`。默认 OpenAI OAuth 路径已有上一轮同一产品树的 HTTP 101 诊断证据。[默认 OAuth 六条 href](./15-windows-evidence/real-oauth-closeout-links.json) · [默认 DeepSeek 六条 href](./15-windows-evidence/real-deepseek-closeout-default-links.json) · [DeepSeek 兼容配置六条 href](./15-windows-evidence/real-compat-closeout-links.json) · [运行时和失败日志摘要](./15-windows-evidence/model-transport-excerpts.txt)。

GetBot、Kimi、Anthropic、Alibaba、GitLab workflow 和模型桥接本轮无相应可调用凭据或配置。Mac 上已观测的 GetBot/Kimi 认证错误见历史通道记录。本轮保留 Windows 外部通道未测结论。

## 自动化

在同一源码头执行 opencode 相关测试 76 通过、1 项 POSIX FIFO 跳过，desktop 精确读取和外链 11 通过、2 项平台条件跳过。Chromium 文件链接与 VCS 5/5，包含旧 OAuth 回复、二次解码边界、重访以及排队合并。Windows 权限证据另由打包 GUI 使用实际拒读 ACL 取得。产品最后一笔提交的完整 pre-push 可由此前推送摘要核对，本轮追加提交为验收文档与证据。[产品推送检查日志](./14-windows-evidence/approved-push-excerpt.txt)。

测试根为 `D:/tmp/deskfox-daily-win-20261114/closeout`。原始包、网络、SQLite、sidecar、未通过的过程记录都已索引。打包构建及首次失败日志位于其父目录 `evidence/closeout-*.log`。测试进程和监听已退出，临时 OAuth / API 鉴权副本和专用 WSL 实例已清理，默认协议已恢复。[逐项结果](./15-windows-evidence/closeout-checks.json) · [启动退出索引](./15-windows-evidence/run-index.json)。未合 main、未发布。
