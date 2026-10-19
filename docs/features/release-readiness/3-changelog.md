feat-id: release-readiness
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2026-10-19 发版准备记录

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

正式 wrapper 新增 KeepRunning 与独立输出目录，拒绝默认目录及其规范化别名，保留运行中的正式应用；真实 PowerShell 路径测试及 branding 全套 91 pass／258 assertions。Windows 候选版本 2026.12.0，Mac 保持 2026.11.2 由同事验收，真实安装升级仍待验收。

Windows 正式 NSIS 已构建成功：logs/release-20261019/windows-candidate/DeskFox-2026.12.0-win-x64.exe，339976329 bytes，SHA-256 `2d49b0de5486ae793374fa0e109e3fd319c2bf21aa04f7cb3a1db20867f19982`。包内 name=deskfox、version=2026.12.0、author=DeskFox，Windows 文件产品信息正确，生产更新源为 updates.deskfox.ai/electron/prod；2511 个 out 文件与本轮构建逐字节相同，两个插件与源码构建一致，LibreOffice 存在且 presets 有 13 文件。latest.yml 的 SHA-512／大小和 blockmap 核对通过。按现有策略为未签名包。

未执行安装器；用 7-Zip 检查内部 5264 文件（1478365157 bytes）完整性通过，抽取 app.asar 的 SHA-256 `15bb1bddade9f74ac139021a5873bdfae2a3cf11348b79725c66ae126e04b3e5` 与已验 win-unpacked 相同。这是安装载荷校验，不替代真实升级。日志 windows-build.log、windows-package-verification.json、windows-payload-integrity.log、windows-nsis-verification.json。现有正式应用仍运行；旧 2026.11.1 安装器保留可作回退。

最终受影响包 enterprise／opencode／app 类型检查及 app E2E 类型检查通过；SolidStart 与备份边界合计 5 pass／14 assertions。维护 CLI 从格式化后的最终源码重建 SHA 仍为 2bb98c73，与线上两站一致。

根目录 `bun install --frozen-lockfile --ignore-scripts --dry-run` 成功（52.45 秒），只读核对锁定安装，无重装运行中的依赖，lockfile-dry-run.log。两站官网／说明／分享 health 均为 HTTP 200，说明日期与七天政策正确；线上 Windows 更新清单仍为 2026.11.1，public-final-verification.json。

升级只读预检确认当前安装为 deskfox 2026.11.1，Roaming/ai.deskfox.app、~/.local/share/deskfox、~/.config/deskfox 三个目录均存在。计划在用户允许关闭应用后，先确保落盘，再将现有安装与这些目录备份到官网同步和仓库以外的位置，然后执行候选 NSIS，核验版本、旧会话／偏好及附件流程；安装动作尚未执行。预检只读版本和目录存在性，不读取聊天正文，windows-upgrade-preflight.json。

## 六项当前状态

| 缺口 | 本轮结果 | 剩余动作 |
| --- | --- | --- |
| 分享回归红项 | 精确隔离模型目录请求，35 pass／2 live skip；83d9956360 已本地提交 | 已完成 |
| Windows SolidStart 补丁 | 锁定安装预演、真实配置／路由、Linux 32 项及本轮正式构建证据齐全；R4 已批准并本地提交 | 已完成本地集成 |
| 原生 Windows 附件 | 选择器、粘贴、确认取消／拒绝已有证据 | Explorer 真正跨窗口拖放仍待验；Mac 由同事负责 |
| 正式安装升级 | 2026.12.0 NSIS 与内部载荷校验完成，2026.11.1 回退包在本机 | 用户允许关闭应用、备份并执行候选安装后验收 |
| 分享运营保障 | 两站每日私有备份／七天清理上线，实际备份成功，公开说明同步 | 已完成本次部署；持续运维按 README |
| 最终自动门与记录 | 29 包类型、六包单测、159 E2E、65 原速性能及四项 Windows 六倍限速通过 | 源码提交和 Windows 升级结果补入记录 |

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
- 候选构建配置、版本及 E2E 证据路径调整由下一笔常规提交保存，结果随后补齐。
