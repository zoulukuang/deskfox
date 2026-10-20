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
