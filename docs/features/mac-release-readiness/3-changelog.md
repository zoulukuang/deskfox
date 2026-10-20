feat-id: mac-release-readiness
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2026-10-20 Mac 发布准备记录

主目录已同步远端 12 个提交至 65b23fca0b。Windows 已发布、备份保留政策和两站 timer 已落实；不继续沿用 10-13 的待办状态。工作在 mac-release-ready，主目录既有 wordmark 和 tray-icons README 改动未纳入。

本轮实现提交 `9a69266beb`，11 文件、267 行新增／11 行删除，正常 pre-commit 五项守卫通过。范围为候选构建脚本、验收环境配置、上游检查脚本、回归测试、Mac 候选号与记录；桌面产品运行逻辑不变。回退实现可在独立分支 `git revert 9a69266beb`；这不会更改已安装应用、线上清单或私有数据库快照。

## 修复与验证

Mac 官方 wrapper 增加 --keep-running 与 --output-directory，校验真实路径及软链接别名后才进入构建。候选使用外置盘独立目录，不停止当前正式版。干净工作树的图标生成原先调用退役 Tauri 复制脚本，导致构建终止；复现后改用已有 png-to-icns，7 项实际 Bash/图标回归通过，1 项 Windows 专属测试在 Mac 跳过。未更改桌面运行逻辑、公开协议或数据库迁移。

真实 Electron MacUpdater 检查：2026.11.2 和同版本 2026.12.0 均不可更新，2026.12.1 可更新；禁止降级、自动下载和退出安装，arm64/x64 各取对应 dmg/zip。结果 logs/mac-release-20261020/mac-updater.json。

首轮 pre-push 通过：29 包类型检查；App 1195 单元 +44 浏览器、media-gen 140、feishu-bridge 792、branding 83（9 平台 skip）、desktop 172、session-ui 125。此结果早于最终构建回归用例扩充，最终变更另需验收。分享专项 35 pass、2 live skip、0 fail，不将 live skip 计为公网创建验证。

首轮全量 E2E 为 157 pass/2 fail，保留 app-e2e.log 及 trace。导航超时伴随模块 20–44 秒加载；另一失败明确出现 504 Outdated Optimize Dep。停止同时进行的桌面/enterprise 重型构建（两份日志记录 exit 143，不能视为成功），隔离验收 Vite 缓存并在启动时扫描懒加载页面依赖。初次扫描误含 stories 的旧无效导出，已排除 stories、测试和声明文件；诊断日志保留。修正后时间线/流重连专项 13 pass/0 fail、58.2 秒、零重试；最终完整 E2E **159 pass/0 fail、4.2 分钟、零重试**，app-e2e-final.log。未增大断言超时，也未跳过失败用例。

## 旧数据副本

生产库以 SQLite 只读连接制作事务一致快照，保存在外置盘候选根的 private-backups（目录 0700、库 0600，不得随候选发布）；原生产应用持续运行。快照 quick_check=ok，六张表记录数与同一只读事务相同。最初试图在外置盘根创建备份目录遇到普通文件权限拒绝，随后改用项目已有可写制品目录，无权限变更。

快照的独立克隆通过真实 Database.layerFromPath 连续初始化两次：38→39 条迁移，project=40、session=1946、message=35457、part=227795、session_message=902、session_input=0 均保持；34 条 session_share 对应 34 条 share_operation，远端删除凭据、URL 与原记录逐项相同（仅输出计数、不输出凭据）。第二次初始化数量不变，database-upgrade.json。此为真实存量数据迁移验证，不替代最终 Electron 安装升级及原生两次冷启动。只读预检与稍后的快照间生产库仍在写入，part 数量正常增加 3 条；比较依据是快照事务而非不同时间的原库。

## 服务和上游状态

两站 share 服务及 backup.timer 均 active，上次备份 Result=success，下一次计划为 2026-10-21；仅只读检查，未重新部署。线上 Mac 清单仍为 2026.11.2，候选号 2026.12.0 未公开。

上游检查脚本的 git fetch 长时无响应后被终止，其回落缓存的 38 条结论不代表最新上游。改用 GitHub contents API 读取 upstream/dev 的 packages/core/src/database/migration，实际为 50 条；本地 39 条，其中上游独有 12 条，本地独有 share-source 一条。新增项涉及凭据、工作区、执行、inbox、worktree、查看状态、权限与项目归档等。本次不合入上游核心迁移；该信号进入后续专项评估，不修改迁移基线来消除告警。

为避免再次出现缓存假绿，使用真实临时 Git 仓库（缓存 upstream/dev 存在、远端不可达）先红后绿复现；gen-migration-baseline 的 Git 调用增加 30 秒上限，拉取失败直接报告“未检查成功，缓存不能证明当前上游状态”，仍遵守信号制 exit 0，不改运行期迁移基线。

Enterprise 生产构建完成，test/deskfox 与 test/solid-start-config 共 **37 pass/0 fail、269 assertions**。两站已有合成公开页通过真实 Chrome 重新打开：图片、代码、表格、公式及紧凑页头可见；海外样例额外核对展开的工具输出、文件差异、第二轮 30 段长文和结尾标记。share-cn.png、share-ai.png、share-ai-end.png 保留在本轮日志目录。海外页面先显示原始 Markdown，随后异步完成排版，不把初始状态当成最终通过。未创建新的公网分享或修改服务器。

## 当前交付边界

生产性能测试 `bun run test:bench` 完成：65 pass/0 fail、14.8 分钟。四个默认 30 倍 CPU 限速的流式场景均处理 160 个增量、待处理队列为空、消息行与 Markdown 节点未重建；未调低限速、增大超时或重试失败项，performance.log。

最终 pre-push 检查完成：29 包类型检查；App 1195 单元 +44 浏览器、media-gen 140、feishu-bridge 792、branding 90（9 平台 skip）、desktop 172、session-ui 125，全无失败，package-gate-final.log。最终日志已走到 hook 最后一个 session-ui 检查，进程正常结束。

arm64 候选载荷初步核对通过：2,511 个 out 文件与本轮编译字节相同；app.asar SHA-256 `429082213b347e92e218fe9b911418205efb621e02543778f2b4a05a5c33c528`；插件、生产更新源、39 条迁移基线及禁止降级逻辑正确。主程序、LO、pty、msgpackr、watcher 均为 arm64，package-arm64.json。一次 codesign 验证在构建器仍逐文件签名时过早发起，返回资源签名不完整；codesign-arm64.log 保留为未完成阶段诊断，必须待构建完成后重新验证，不能据此判定成品失败或通过。

随后两架构完成应用签名，`codesign --verify --deep --strict` 均通过（codesign-arm64-final.log、codesign-x64-final.log）。x64 候选同样核对 2,511 个编译文件、插件和更新策略，主程序／LO／三种原生模块为 x86_64；app.asar SHA-256 `4fdb27b30584e4b4288404ddd4aefb0f427b5be3e40339e54a3f2b461dc6b39b`。这还不是 DMG 公证结论。

签名后的 arm64 候选用既有 TEST_ONBOARDING 模式独立启动两次，隔离临时数据与文稿目录，生产 2026.11.2 始终保持运行。原生选择器验证正文中间 `LEFT @small.txt RIGHT`；CSV／PNG／PDF 混选验证文本路径引用及二进制内联；289.9 KiB 提醒、中文取消、英文 Escape 均保留草稿／附件，确认前本机模型请求为零。Finder 真实文件复制粘贴得到相同路由，未知二进制显示明确拒绝。确认发送后，只向回环地址的合成模型发出请求，界面完整显示 LOCAL_NATIVE_QA_COMPLETE；请求记录仅含路径、模型、数量和大小，不保存正文。截图与 AX 证据均以 native- 开头。

初次测试配置只有 attachment=true，未声明 image 输入能力，因此图片被正确拒绝；补齐测试模型 modalities 后混选通过，没有改产品代码。Finder 跨窗口拖放两次未可靠落入候选输入框，仅有选择变化、无附件结果，故不计通过。测试 Finder 新窗口已关闭，候选正常退出；真实生产数据未用于模型发送。TEST_ONBOARDING 每次新建临时库并跳过迁移守卫，不能冒充生产数据升级或持久化冷启动验收。升级副本额外 quick_check=ok，database-upgrade-integrity.json。

两架构内嵌 LibreOffice 实际执行 TXT→PDF 均 exit 0，生成可识别的单页 PDF（arm64 15,257 字节、x64 15,252 字节），libreoffice-conversion.json。x64 首次运行耗时明显较长；转换成功不代表桌面启动通过。

Intel 候选在本机 Apple M4／macOS 27.0.1 的 Rosetta 环境验收未通过。首次启动 16:05:27→主进程记录 16:07:21→server ready 16:09:17；16:11:54 连续三次健康检查失败触发 sidecar 重启，16:12:22 报恢复，但界面仍出现 bootstrap 503、发送合成文本未完成。正常退出最终成功，无需强杀。第二次使用全新隔离配置启动，16:17:46→server ready 16:19:20，16:20:03 再有健康检查失败，界面仍处加载状态；该次同样不计通过。采样确认 X86-64 translated，不能据 Rosetta 现象断言 Intel 真机必现，也不能以未取得真机结果放行。native-x64-startup-diagnostic.json、native-x64-second-start.png 保留证据。两次均拒绝线上较低版本更新。测试应用和回环模型服务已退出，正式版 PID 75309 持续运行。

## 发布前尚缺的事项

| 项目 | 当前证据与下一步 |
| --- | --- |
| Intel 桌面启动与会话 | Rosetta 两次异常，必须继续定位并取得 Intel 真机或可信等效环境的启动、发送、退出结果；不能只凭架构和签名正确放行。 |
| 正式升级与持久化冷启动 | 旧库副本真实迁移已通过；仍需完整应用／配置备份、实际安装升级及至少两次 CLEAN 冷启动，验证无新增 incompatible 隔离文件。当前运行中的正式版未被替换。 |
| Finder 跨窗口拖放 | 原生选择器及 Finder 文件复制粘贴通过；拖放未可靠命中，仍须实测，不记为产品失败或通过。 |
| 最终分发制品 | app 深签通过，Apple 公证仍待结果；之后还需 DMG 单独公证／staple／Gatekeeper，四个资产最终哈希与双架构更新清单核对。 |

截至 2026-10-20 16:18 的 Apple history，两笔 app 公证均为 In Progress：arm64 `7a1caa9e-ab16-45e5-b422-8cc2707b53c5`、x64 `da28f8de-1b35-40c5-9acd-457501f2a49a`。未重复提交或绕过公证。官方构建继续运行；本地后处理已启动，只有两份 BUILD_EXIT=0 才继续逐项校验、DMG 公证及官方更新清单 dry-run，失败记录到 packaging-status.json 并停止。该后处理不上传分发资产、不改线上更新源、不发布 Release；即使完成，其状态也是 packaging_verified_acceptance_pending，不代表上述验收缺口已关闭。

本地制品根：`/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-release-20261020/`。`candidate/` 仅放应用和安装包；`private-backups/` 是生产数据私有快照，严禁整个制品根打包上传。最终安装包未就绪前，不把当前 `.app` 当作正式交付安装器。主目录两处原有修改在收口时重新逐字节核对，保持原样。

## 2026-10-20 后续原生诊断与修复

本节更新上述结论，前序失败记录保留。local 官方 wrapper 构建成功，独立输出到 `local-qa`，未替换 `/Applications/DeskFox.app`。Finder 三种合成文件（CSV、PNG、PDF）通过多个窗口位置尝试真实拖放；在开发者工具中仅添加事件日志监听，未派发模拟 drop。日志只有 QA_NATIVE_DRAG_READY，未捕获 dragenter/drop，因此仍不能把原生跨窗口拖放计为通过，也不能据此认定附件处理代码故障。后来观察到 local 草稿持续出现用户输入，停止界面操作；后续需要窗口空闲后继续。

Intel 对照结果（Apple M4、macOS 27.0.1；均不算 Intel 真机验收）：

| 对照 | 进程启动至 server ready | 健康检查失败 | 自动重启 |
| --- | ---: | ---: | ---: |
| 旧版 2026.11.2，原测试模式 | 67.729 秒 | 4 | 0 |
| 2026.12.0，OPENCODE_PURE=1 | 84.670 秒 | 6 | 1 |
| 2026.12.0，pure + jitless 诊断 | 62.342 秒 | 6 | 2 |
| 2026.12.0，pure + no-opt 诊断 | 49.046 秒 | 1 | 0 |
| arm64 local，pure 对照 | 3.087 秒 | 0 | 0 |

各轮观察时长不同，计数不是发生率比较。no-opt 对照结束时仍未取得完整智能体/模型就绪与发送成功证据；jitless 会改变运行时能力，不能据其失败证明产品根因。未把这些参数写入应用。旧版和无插件候选均能复现异常，说明不能只归因于本次业务改动或飞书插件；尚未证明 Rosetta 是唯一根因。主进程和后台采样确认 X86-64 translated，保留 `intel-baseline-sidecar-sample.txt`、`intel-pure-sidecar-sample.txt`；汇总 `native-followup-report.json`，界面重启提示截图 `intel-pure-restart.png`。

确定缺陷一：主进程重启 sidecar 后，以一个 30 秒后 resolve 的 Promise 竞争健康检查，即使未健康也会广播 ready。现改为 `waitForSidecarHealth`，超时 reject，成功/失败均清理计时器；看门狗保留 recovering 状态，后续真实健康探测成功才恢复 ready。真实定时器回归先复现 6 pass/1 fail（watchdog-red.log），修复后桌面现有子集 **176 pass/0 fail、665 assertions**，包含“未就绪不可恢复”“原始失败保持”“超时后真实恢复”路径。轮询/启动宽限默认值保持 5 秒/15 秒，健康等待仍为 30 秒；未靠放宽超时使测试通过。

确定缺陷二：TEST_ONBOARDING 的 XDG 隔离不覆盖插件直接使用的 os.homedir()。先前测试确实启动了真实飞书 WSS，并改写共用连接文件；不能再称该模式完全隔离。已关闭这些测试实例，后续诊断显式使用 OPENCODE_PURE=1；代码在 shell 环境合并之后对 TEST_ONBOARDING 强制该开关，普通 local/prod 行为不变。正式版主进程持续运行，但飞书设置入口的连接文件需要恢复，已申请正常重启正式版，尚未获得答复，未擅自重启。未输出连接文件密码，也未主动发送飞书消息。

这些修复改变了桌面代码，先前的完整 pre-push、签名与公证不能证明新代码已验收。`candidate-superseded.json` 明确标记旧 `candidate/` 仅供诊断；其公证完成也不得发布。Apple Silicon 旧候选 app 已 Accepted 并产出 dmg/zip，后处理仍仅做制品验证，不对外分发。修复后的 local 包单独重建；最终两架构候选、正式升级冷启动、Finder 拖放、Intel 正常运行四项仍未关闭。

修复提交 `b4b54a58ad`，正常 pre-commit 五项守卫通过；最终桌面 `bun typecheck` 成功。`local-qa-r3/mac-arm64/DeskFox 本地版.app` 官方构建 BUILD_EXIT=0，主程序与内嵌 LO 均为 arm64。包内 2,511 个 out 文件逐项匹配本次编译，确认测试隔离发生于 shell 合并之后，并包含健康超时 reject；app.asar SHA-256 `b3688ddf433ed40c829f453c100f32f055124223f7e3a0e6cbbf3a0f8bc50654`，`local-followup-package.json`。中途的 r2 包编译早于最后的隔离位置调整，不作为交付包。为避免干扰用户正在使用的 local 窗口，r3 尚未启动，不能把载荷核对算成原生验收通过。

## 2026-10-20 深夜：正式版恢复与 r3 原生复验

用户授权后，以正常退出/打开方式重启 `/Applications/DeskFox.app`，版本仍为 2026.11.2，未安装升级。飞书设置页重新列出原有 8 个账号，连接文件指向的认证 `/accounts` 接口 HTTP 200、账号数 8；`production-recovery.json` 只记录状态、数量和文件哈希，不记录凭据。未发送飞书消息。

接管旧 local 前，将原有 44 字草稿另存 `local-user-draft.txt`（0600），正常退出旧包后启动 r3。启动器故意传入 `OPENCODE_PURE=0`，验证 TEST_ONBOARDING 在 shell 合并之后强制隔离。r3 启动并显示测试模型；观察期间无健康检查失败或自动重启、未见真实飞书 WSS 启动。随后再次核对正式连接文件哈希未变，认证接口仍为 HTTP 200、8 个账号，`local-r3-recovery-verification.json`。

Finder 与 local 已在 Studio Display 左右并排；三种合成文件跨窗口拖动仍未形成可见附件结果，继续保持“未验证”，不计通过。Finder 真实复制/粘贴在 r3 上得到 CSV 路径引用及 PNG/PDF 附件。期间专用测试草稿再次出现非测试文字，已另存 `local-r3-interrupted-draft.txt`（0600），停止修改输入框，未点击发送；r3 的取消保留测试尚未完成，不能沿用旧候选的通过结果。已请求暂停可能的全局语音输入后再继续。

旧候选的后台后处理于 20:18 完成 `packaging_verified_acceptance_pending`：两架构 DMG 均完成公证，四个分发文件生成并通过制品检查；`publicRelease=false`。这些制品仍受 `candidate-superseded.json` 约束，缺少 b4b54a58ad 修复，不可发布。

用户随后确认已暂停全局输入，继续 r3 测试。先保存最新非测试文字，再恢复纯合成测试草稿。CSV 路径引用、PNG 与 PDF 混合附件触发 289.9 KiB 提醒；点击取消及按 Escape 均保留全部文字、路径和两份附件，回环模型请求日志逐字节不变。确认发送后界面完整显示 LOCAL_NATIVE_QA_COMPLETE，`local-r3-cancel.ax.txt`、`local-r3-send.ax.txt`。Finder 图标视图重新定位后再尝试真实拖动，仍无附件结果，不计通过。

对 r3 专用后台 PID 49393 注入一次进程终止，未操作正式版进程。23:55:30.602 退出，连续三次失败后 23:55:41.505 触发重启，23:55:43.007 才广播 respawn healthy/ready，新 PID 54022；恢复约 12.405 秒。新建测试会话发送成功，`local-r3-watchdog-utility.log`、`local-r3-watchdog-recovered.ax.txt/.jpg`。旧测试会话续发返回 Session not found，经源码核对 TEST_ONBOARDING 明确设置 OPENCODE_DB=:memory:，后台退出即丢失该测试库；不能据此判定生产持久化故障，也不能把本轮算作历史会话恢复通过。复验结束后正式飞书连接文件哈希仍不变，接口 HTTP 200、8 个账号。

### Intel 无界面后台对照

使用已缓存的官方 Electron 42.3.3 两架构运行最小诊断主进程，只启动旧候选包的真实 sidecar、调用真实健康与智能体接口；无 BrowserWindow、无真实插件、独立临时配置/数据库。测试脚本保存在日志目录，不改产品运行参数。下表起点是诊断脚本开始执行，不含操作系统启动可执行文件前的时间；不与前面的桌面端进程启动耗时混用。

| 同一诊断流程 | sidecar ready | 健康接口 8 次 | 智能体列表 |
| --- | ---: | --- | ---: |
| arm64 原生 | 1.155 秒 | 全部 200，1–24 ms | 200，77 ms |
| x64 / Rosetta | 24.106 秒 | 全部 200，982–2479 ms | 200，11402 ms |

`backend-arm64-headless.json`、`backend-x64-headless.json` 保留时间线。`/api/health` 和 `/global/health` 均成功，因此本轮不支持“错误健康接口导致失败”的假设；无前端仍显著变慢，不能仅归因于渲染层。此轮无自动看门狗，也不含完整会话发送，不能据 8 次成功就放行 Intel 桌面。

额外 x64 inspector 采样保存 `backend-x64-inspector.cpuprofile`，仅为诊断（采样本身增加开销），涉及 SQLite、模块/Schema 初始化及运行期多处开销，尚未找到单一已证实根因。最小 node:sqlite 对照的 1000 次插入/查询在 x64 上为毫秒到百毫秒量级，不能用 SQLite 框架栈占比直接解释整个应用数十秒延迟。未修改 JIT、放宽健康阈值或绕过验收。当前仍需继续性能定位，并取得 Intel 真机/可信等效环境结果；正式升级和两次持久化冷启动、Finder 真拖放、最终新候选制品验收继续保持未完成。
