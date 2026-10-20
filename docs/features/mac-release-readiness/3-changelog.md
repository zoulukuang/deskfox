feat-id: mac-release-readiness
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2026-10-20 Mac 发布准备记录

主目录已同步远端 12 个提交至 65b23fca0b。Windows 已发布、备份保留政策和两站 timer 已落实；不继续沿用 10-13 的待办状态。工作在 mac-release-ready，主目录既有 wordmark 和 tray-icons README 改动未纳入。

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

正在准备本地双架构候选；尚未生成可交付的已公证安装器，未安装到 /Applications、未发布 Release、未改线上更新清单。后续仍需原生附件和两次冷启动、双架构签名公证与制品哈希。旧库副本迁移已验证，实际安装升级仍需单独验收。完成后按实际结果更新本记录。
