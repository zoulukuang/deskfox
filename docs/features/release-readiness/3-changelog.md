feat-id: release-readiness
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2026-10-19 发版准备记录

## 2026-10-20 再次启动故障：撤回发版就绪

用户在确认初次视觉／拖放后报告再次启动出现 Session not found，所有项目会话为空。当前程序实际已变成 2026.11.1，并非 local 身份。日志确认：00:30 安装的 2026.12.0 启动后因 allowDowngrade=true，将线上 2026.11.1 判为可用更新、复用已有缓存；09:29:54 运行该旧安装器。09:30 旧版基线 38 条不认识 `20261012052604_share-source`，将原库三件套改名隔离，然后启动空库。2026.12.0 候选载荷本身有完整 39 条基线，源码无遗漏；初步“候选遗漏迁移”推断已否定。

只读核对：被隔离原库仍有 project 40、session 1027、message 63929、part 190205，迁移 39 条；新空库 session／message／part 为零，迁移 38 条。升级前私有备份也保留完整记录。此前数量／哈希检查及用户初次回执不能覆盖后续更新降级，撤回准备完成结论；必须补更新检查与再次冷启动。诊断只读取数量和迁移 ID，不读取聊天正文。

修复采用 fork 独立 updater-policy.ts，统一配置 channel 后显式禁止降级；updater.ts 仅接入调用，保留无自动安装策略，不关闭真正超前数据库保护。独立 helper 封装真正影响可更新判定的配置顺序；原 upstream 控制器无需修改，主 updater 仅替换配置调用，无根依赖或黑名单变更。真实 NsisUpdater 版本判断回归先红：旧策略 1 pass／2 fail，确实把 2026.11.1 判为可更新；修正后三项通过。更新器及数据库隔离边界合计 52 pass／141 assertions，desktop 专项 172 pass／660 assertions，desktop 类型检查通过。日志 updater-downgrade-red.log、updater-downgrade-green.log、desktop-incident-regression.log、desktop-incident-typecheck.log。

用户确认点过应用内“更新／安装并重启”，并从托盘正常退出。进程为零后，保留被隔离原库及当前空库至私有 `D:\DeskFoxReleaseBackups\20261020-0930-recovery`，DB／WAL 逐字节校验，原库 quick_check=ok、39 条迁移、记录数量完整。原件与昨晚升级前备份均不删除。

修正候选在独立 windows-candidate-r2 输出构建成功：2026.12.0 NSIS 339951837 bytes，SHA-256 `3982605b8a31d4da6c85af89af782fbd2f026e80c49d2d9d04eef90552cff775`；包内 app.asar SHA-256 `abc4986d9769c2b01ea25f755916b36928d95d56ed31995a4b582d80e12f57e5`。2511 out 文件、两个插件、13 个 LO presets 和更新清单 SHA-512／大小／blockmap 校验通过，windows-r2-package-verification.json。直接抽取包内更新配置函数，驱动真实 NsisUpdater：2026.11.1=false、2026.12.0=false、2026.12.1=true；包内 39 条基线覆盖原库全部 39 条 journal，windows-r2-policy-verification.json。

代码修复已本地提交 68397f2a02，正常 pre-commit 通过。修正 NSIS 内部载荷另由 7-Zip 实测：5264 文件／1478386888 bytes，Everything is Ok，windows-r2-payload-integrity.log。

用户明确批准恢复原库并安装修正版。确认进程为零后，将当前空库三件套另名保留为 `.empty-before-recovery-20261020095020`，从已校验的私有原库副本复制恢复；被隔离原件未改名／删除。恢复前后 DB SHA-256 为 `405bd96f2542f21e1f7a522c1ae5e1a4cedbd55e844437f439ed59864245a468`，记录数量与完整性保持，windows-original-restored.json、windows-db-restored-before-launch.json。

修正 NSIS 实际安装完成并自动启动，实际安装 app.asar SHA 与 R2 一致，主 EXE、插件、更新配置与 LibreOffice 主程序也与 R2 一致，windows-installed-r2-verification.json。首次冷启动 run=20261020T015215：实际配置 allowDowngrade=false，联网读取线上 2026.11.1 后明确输出 downgrade is disallowed，转 up-to-date，没有下载或准备安装。原库 40 项目／1027 会话／63929 消息／190205 part 均保留，quick_check=ok，无新增隔离，windows-r2-boot1-verification.json／windows-r2-boot1-update.log。等待用户确认旧会话恢复并正常退出后，再启动完成第二次冷启动；公开发布继续停止。

## 分享红项

完整回归原 34 pass /2 skip /1 fail；失败为自动分享断言预期两次请求而实收三次。追加方法和 URL 的诊断确认额外请求为 GET https://models.opencode.ai/api.json。先前将它推断为增量同步的假设已被证据否定，不作为结论。

模型目录与分享共用被替换的 HttpClient，后台刷新是否在断言前发生导致结果漂移。现在用仓库现有模型 fixture 回应该精确 GET，其他请求仍逐项记录；强制真实 ModelsDev.refresh(true) 确保该边界每次发生，并精确断言 POST 创建及初始同步的完整 URL。产品分享运行代码未修改。最终完整专项 35 pass /2 live skip /0 fail，173 assertions；日志 share-final.log。

## 已完成检查

29 个包级类型检查及六包单测通过，完整日志 package-gate.log。新增备份保留测试 3 pass /10 assertions，enterprise 类型检查通过。

默认开发服务器 Playwright 158 pass /1 fail（零重试）；历史分页用例的 page.evaluate 报执行上下文因导航销毁，保留 app-e2e.log，根因未确认。该次截图／视频未单独归档，后续同目录验收已覆盖，不作为保留证据。最终验收配置保留原开发入口与夹具，只关闭文件监听／热重载，并独立保存失败 trace，零重试，不修改原测试断言。

生产 Web 的 canonicalLocalServer 绑定 location.origin，与既有桌面夹具的固定 4096/4097 语义不同；把网页放在 API 端口又会被夹具截为 `{}`，prompt_async 落到静态站 404。defaultServerUrl 偏好也不能改变 canonical 本机身份；专项 trace 确认请求仍被重映射。因此撤回整套用例改跑生产 Web 的尝试，保留原测试入口契约。中止轮、两次 147 pass／12 fail 的配置诊断，以及停止于首个失败的专项，分别保存在 app-e2e-production-invalid-server.log、app-e2e-production-mixed-server.log、app-e2e-production-colliding-origin.log、app-e2e-production-canary.log；这些不是产品通过证据。最终完整验收用 playwright.release.deskfox.config.ts／vite.release.deskfox.config.ts，开发模式、无监听／热重载；真实生产构建另由下列性能套件及 Windows 包校验覆盖。

最终完整端到端 **159 pass／0 fail，6.8 分钟，零重试**，包括历史分页、附件成本确认、上下文卡真实发送、跨服务器与完整用户流程。日志 app-e2e-release-final.log；独立结果目录 e2e-release-final/.last-run.json 为 passed、failedTests=[]。本轮验收环境固定后通过，不宣称已证明首轮开发服务器导航的根因。

生产性能原速全套 65 pass（6.5 分钟），performance-native.log。默认 30 倍 CPU 限速的两个 streaming 场景超时，原记录 performance.log 保留；没有作为绿灯。检查已有 e2e/performance/README.md，确认 2026-08-18 已记录 Windows 必须使用六倍限速；据此补跑四个 streaming 场景，断言与时间上限保持原值。各次参数必须与结果一起阅读。

六倍限速四项全部通过（4.6 分钟），每项进度均为 160、pendingDeltas=0、rowReplaced=false、markdownReplaced=false，完成约 49.6–62.2 秒。仅这四项读取限速环境变量，其余性能项不受该参数影响。日志 performance-windows6.log 及摘要 performance-windows6-summary.json。上游 schema 漂移信号为本地 39 条／upstream/dev 38 条，无领先迁移，migration-drift.log。

## 备份

新增私有同区域定时备份、成功后七天清理和服务恢复包装器。清理验证所有候选清单后才删除，不处理实时数据和删除账本；跨区、损坏、软链接拒绝。备份失败只清理本次生成的未完成目录，并恢复先前运行的服务，不清理旧成功备份。

海外已安装并启用每日 timer；实际备份两次均为 6 records，service Result=success，分享服务健康，权限目录 0700／清单 0600。CLI SHA-256 为 2bb98c7317b258cb920ec7dcb9bd5584f70d6818986ba3d89f09dab54b6e5b44；网页程序 current 未切换。公开说明已更新，回退副本放 /var/backups，未置于官网目录。日志 backup-ai-final-status.log、share-notice-ai-deploy.log。

Linux 隔离实际文件系统验证通过：备份、恢复、七天清理、取消后旧备份不得恢复正文、软链接拒绝。独立容量样本的 16KiB／1MiB／8MiB 写入分别为 49／21／107ms；32 个并发读取 16 成功、16 按并发上限拒绝，之后 health 200。仅为单机合成样本，不等同于公网或持续业务负载容量。日志 share-capacity.log。

用户提供大陆服务器 8.141.93.183（root:22）、分享服务与数据位置。为本 Windows 主机生成独立 SSH 密钥，仅交付公钥；用户随后提供的主机指纹与扫描一致，严格主机检查登录成功。大陆安装与海外相同 CLI、包装器及 timer，实际备份 10 records，service Result=success，timer enabled/active，目录 0700／清单 0600；公网 health 正常。中文公开说明同步成功。日志 cn-preflight.log、backup-cn-final-status.log、share-notice-cn-deploy.log。初次安装缺少 /usr/local/libexec，失败时分享服务未停止；补齐目录后正常完成，原失败日志保留。没有调用静态官网部署脚本或切换分享网页程序。

## Windows 原生与安装包

本轮在原有 local 应用中，用 Windows 原生目录／文件选择器打开新的合成项目，混选 1MB CSV、PNG、PDF，观察到 CSV 路径引用及图片／PDF 附件。原窗口激活恢复失败后停止继续操作；没有发送付费模型请求，也没有清空旧草稿。2026-10-16 已通过的成本确认／取消保留、二进制拒绝、复制粘贴证据仍见 share-windows-build/3-changelog.md；外部跨窗口拖放与正式安装升级没有据此标通过。

正式 wrapper 新增 KeepRunning 与独立输出目录，拒绝默认目录及其规范化别名，保留运行中的正式应用；真实 PowerShell 路径测试及 branding 全套 91 pass／258 assertions。Windows 候选版本 2026.12.0，Mac 保持 2026.11.2 由同事验收；实际升级结果见下方 2026-10-20 记录。

Windows 正式 NSIS 已构建成功：logs/release-20261019/windows-candidate/DeskFox-2026.12.0-win-x64.exe，339976329 bytes，SHA-256 `2d49b0de5486ae793374fa0e109e3fd319c2bf21aa04f7cb3a1db20867f19982`。包内 name=deskfox、version=2026.12.0、author=DeskFox，Windows 文件产品信息正确，生产更新源为 updates.deskfox.ai/electron/prod；2511 个 out 文件与本轮构建逐字节相同，两个插件与源码构建一致，LibreOffice 存在且 presets 有 13 文件。latest.yml 的 SHA-512／大小和 blockmap 核对通过。按现有策略为未签名包。

候选打包阶段先用 7-Zip 检查内部 5264 文件（1478365157 bytes）完整性通过，抽取 app.asar 的 SHA-256 `15bb1bddade9f74ac139021a5873bdfae2a3cf11348b79725c66ae126e04b3e5` 与已验 win-unpacked 相同。这是安装载荷校验，不替代真实升级。日志 windows-build.log、windows-package-verification.json、windows-payload-integrity.log、windows-nsis-verification.json。旧 2026.11.1 安装器保留可作回退。

最终受影响包 enterprise／opencode／app 类型检查及 app E2E 类型检查通过；SolidStart 与备份边界合计 5 pass／14 assertions。维护 CLI 从格式化后的最终源码重建 SHA 仍为 2bb98c73，与线上两站一致。

根目录 `bun install --frozen-lockfile --ignore-scripts --dry-run` 成功（52.45 秒），只读核对锁定安装，无重装运行中的依赖，lockfile-dry-run.log。两站官网／说明／分享 health 均为 HTTP 200，说明日期与七天政策正确；线上 Windows 更新清单仍为 2026.11.1，public-final-verification.json。

升级只读预检确认原安装为 deskfox 2026.11.1，Roaming/ai.deskfox.app、~/.local/share/deskfox、~/.config/deskfox 三个目录均存在。预检只读版本和目录存在性，不读取聊天正文，windows-upgrade-preflight.json。

2026-10-20 用户从托盘正常退出后确认正式版进程为零。旧安装及三个目录最终备份到 `D:\DeskFoxReleaseBackups\20261020-2026.11.1-before-upgrade`，私有 ACL，仅本机用户与 SYSTEM 可访问；21,207 文件／4,474,660,443 bytes 逐文件 SHA-256 校验通过。排除缓存、日志、其他渠道数据库及可重建的 SQLite SHM，生产数据库与 WAL 另与原件核对。先前 C 盘副本校验仅 SHM 因只读数据库检查而变化；最终备份保留 DB／WAL 并排除 SHM 后通过。清理本轮 C 盘临时副本被自动审批策略拦截，未绕过；副本保留，安装前剩余约 4GB，安装成功后仍约 4GB。私有 inventory 留在备份目录，不提交仓库；摘要 windows-upgrade-backup.json。

重新核对候选 SHA 后执行用户批准的 NSIS，安装器正常结束并自动启动 DeskFox。实际安装为 2026.12.0，Windows ProductVersion=2026.12.0.0；安装后的 app.asar SHA 与候选载荷完全一致。主 EXE、两个插件、生产更新配置、LibreOffice 主程序逐字节一致，13 个 presets 存在，windows-installed-verification.json。

升级前后 SQLite quick_check 均 ok；六张表记录数量完全相同：project 40、session 1027、message 63929、part 190205，session_message／session_input 均零。配置目录及四项桌面偏好共 7,302 文件没有缺失或哈希变化，windows-upgrade-data-verification.json、windows-upgrade-settings-verification.json。只校验数量与哈希，不读取正文或凭据。程序窗口和进程已启动。

用户于本轮初次升级后明确回复“显示正常，拖放三种文件均成功”：旧项目、会话列表和偏好显示正常；从 Explorer 混选合成 large.csv、image.png、large.pdf 拖入新空白会话，CSV 路径引用及 PNG／PDF 附件均成功。该项为用户真机回执，不冒充自动化观测；无需发送付费请求。当时关闭了 Windows 准备，但后续更新降级故障已重新打开，以上初次回执不能替代修正版复验。Mac 内测仍按用户分工由同事负责；尚未推送、合并或公开发布。

## 六项当前状态

| 缺口 | 本轮结果 | 剩余动作 |
| --- | --- | --- |
| 分享回归红项 | 精确隔离模型目录请求，35 pass／2 live skip；83d9956360 已本地提交 | 已完成 |
| Windows SolidStart 补丁 | 锁定安装预演、真实配置／路由、Linux 32 项及本轮正式构建证据齐全；R4 已批准并本地提交 | 已完成本地集成 |
| 原生 Windows 附件 | 选择器、粘贴、确认取消／拒绝已有证据；用户确认 CSV／PNG／PDF 的 Explorer 跨窗口拖放成功 | Windows 已完成；Mac 由同事负责 |
| 正式安装升级 | 修正版已实际安装，原库恢复，首次冷启动保留全部记录并拒绝线上旧版，无新增隔离 | 用户视觉确认及正常退出后，补第二次冷启动 |
| 分享运营保障 | 两站每日私有备份／七天清理上线，实际备份成功，公开说明同步 | 已完成本次部署；持续运维按 README |
| 最终自动门与记录 | 既有自动门及原生回执保留；降级复现先红后绿，52 项定向及 172 项桌面回归通过，68397f2a02 本地提交 | 等待修正版实际恢复与重启结果；公开发布暂停 |

## R4 提交前复核

- 根 package.json、bun.lock：正式登记已有 SolidStart 最小补丁是干净安装生效的必要条件；外部应用 wrapper 无法修正依赖内部在解析前生成的非法路径。风险、Linux 生产证据和回退见 share-windows-build/3-changelog.md。
- opencode/test/share/share-next.test.ts：必须修正原生命周期测试所用共享传输边界，另加外部测试无法消除该用例的后台请求污染。只改测试及测试层声明；无产品请求、数据或公开协议变更。回退恢复本测试即可。

风险评估：依赖补丁影响入口字符串生成和 URL 路由发现，升级 SolidStart 后必须重新核对；Windows 实际构建及目标 Linux 真实运行覆盖了该边界。分享测试增加真实模型目录刷新以确定性覆盖共享传输，产品模型请求不变。备份 CLI 从最终源码重建与两站已部署 SHA 完全一致。未改公开 Protocol／HttpApi，无需重新生成 Client。

计划提交到本地 release-validation 分支，提交消息包含 `[feat: release-readiness]`、`[override-blacklist: Windows dependency patch and shared-transport regression]` 和 `[bug-repro: ModelsDev refresh polluted publication request count]`。安装升级与源码提交分别请求用户确认；没有创建公开 Release、推送分支或更新线上客户端清单。

用户已明确同意本地提交及 2026.11.1→2026.12.0 安装升级验收。正式版窗口正常关闭后驻留托盘，当前电脑操作接口未提供可定位的托盘窗口，已请用户手动选择“退出 DeskFox”；确认进程退出后才开始备份，不强杀运行中的数据库。

源码按本次 R4 授权提交；Windows 升级结果和提交号随后在本记录补充。

本地提交按 Windows 依赖／分享回归、备份运维、候选构建三个主题拆分。受保护文件所在提交按仓库 R4 路径使用带 override 理由的 --no-verify；黑名单 guard 本身不识别提交消息豁免，其余原 hook 的 diff 阈值、大小写、网络绑定及 fork 参数检查单独原样执行。其他提交正常执行完整 pre-commit。

- 83d9956360：Windows 依赖补丁与分享传输回归，R4 已审签，其余原 hook 检查通过；git diff --cached --check 通过。
- 797abd35f0：两站七天备份、维护 CLI、公开说明及保留边界测试；完整 pre-commit 通过。
- 50a01953a5：候选构建配置、版本及 E2E 证据路径调整；完整 pre-commit 通过。
- ef012db881：Linux 备份部署文件签出固定 LF；完整 pre-commit 通过。
- a96553fedd：实际 Windows 升级、备份及数据／偏好验证记录；完整 pre-commit 通过。

本笔仅补入用户原生验收回执并关闭 Windows 准备状态，不改产品代码或候选包；执行文档 diff 检查与正常提交 hook，无需重跑已通过的产品测试。

收尾发现 Windows core.autocrlf 会把新运维文件改成 CRLF；部署目录增加仅针对这三个 Linux 文件的 LF 属性，避免未来 Windows 签出后直接上传造成 Bash／单元文件字节变化。用真实 checkout-index 验证签出仍为 LF，并检查 Bash 语法，不改变已部署文件内容。
