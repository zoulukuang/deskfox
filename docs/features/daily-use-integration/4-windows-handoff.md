feat-id: daily-use-integration
status: in-progress
related: ./3-changelog.md ../deskfox-vcs-refresh-overload/1-spec.md ../daily-file-links/1-spec.md ../mcp-toggle-persistence/1-spec.md

# Windows 验收交接（2026-11-14）

## 可直接转发给 Windows agent

本轮最终产品提交为 `48909c6959`（完整 href 修复），接手时必须同时包含此提交与 `f517fc04b4`；旧 local 包不包含最新模型约定。

```text
请接手本期 Windows 真机验收。先读 CLAUDE.md、docs/governance/三端协作-Agent接入.md 和测试与发布规范，核实电脑身份，登记并推送“接手中”，避免重复执行。在独立 worktree fetch origin，取 origin/feat/daily-use-integration 的最终头，记录完整 SHA，并确认包含 f517fc04b4；不要沿用旧包或旧 REQ-149 回执。

按本文件详细夹具与原始 spec 执行。使用 Bun 1.3.14 冻结安装依赖，按下文命令重新构建 local 包，隔离配置、数据库和测试项目，记录 exe 路径及哈希。重点验六项：149 请求积压与忽略过滤；152 中文、空格、字面百分号和盘符链接打开正确内容；146 同文档及跨文档锚点；160 项目外 PDF/Office 内部预览与远端隔离；162 真实模型自动给出文件链接；153 MCP 关闭跨重启、项目作用域及多窗口一致。

负载须在同机对照修复前与新包，测真实目录展开和普通聊天提交到后台接受，不能用 question reply 或首 token 代替；保留逐次耗时、实写速率和超时。回执写入 docs/features/daily-use-integration/3-changelog.md，附截图、日志、包与代码哈希、未测项。失败保留复现和证据，未测不签通过，修复按仓规单独推进。完成后汇报结果；本次不合 main、不发布。
```

编写：笑南的电脑。接手端：**Windows 电脑，尚未有人接手或签字**。本文件是执行材料，不是 Windows 通过回执，也不授权合 main、冻结版本或发布。

## 代码与包

- 远端分支 `origin/feat/daily-use-integration`，首轮产品树基准 `a4d3ec5691`，后续 MCP 补充修复见下。**接手时 fetch 并拉取最终远端头，记录完整 SHA，从该头重新构建 local 包验收**，不要只 checkout 旧产品哈希后漏掉补丁和交接更新。
- **必须包含补充修复 `f517fc04b4`**：Mac local 验收发现的 MCP 自动配置目录覆盖问题已修复，经用户新增 R4 批准、完整检查后推送。对应冻结补丁 SHA256 `ec8a042c6d3b097b600693b655309f97eaff36fb08783e9b68494db591a0b7f1`。Windows 接手前用 `git merge-base --is-ancestor f517fc04b4 HEAD` 确认包含此提交；不能用未修复的旧集成包验收 MCP。见[补充复核](../mcp-toggle-persistence/4-native-config-review.md)。
- 在干净独立 checkout/worktree 内使用根 `packageManager` 指定 Bun（当前1.3.14），`bun install --frozen-lockfile`；Windows 构建用 `powershell -File packages/branding/scripts/build-deskfox-electron.ps1 -Env local`。运行生成的「DeskFox 本地版」，确认 LOCAL 徽标、独立 `opencode-local.db`；记录实际 exe 路径、SHA256与构建头。不要用旧 exe、正式包、浏览器或开发热更新冒充本次 local 结果。
- 六项原始契约：[REQ-149](../deskfox-vcs-refresh-overload/1-spec.md)、[REQ-152/146/160/162](../daily-file-links/1-spec.md)、[REQ-153](../mcp-toggle-persistence/1-spec.md)。自动化证据见[集成回执](./3-changelog.md)，不能代替以下真桌面项。
- **旧 REQ-149 Windows 回执只验过早期合并请求版本，本次新增 Git 忽略、HEAD保护和其他五项，必须重新验，不能沿用旧签字。**

## 最小夹具

在测试目录新建 Git 项目 A、另一个独立项目 B，禁止在正式项目/正式数据库注入负载。以下 PowerShell 从仓库根执行；只创建随机名字目录，后续删除也只删本轮目录。

```powershell
$checkout = (Get-Location).Path
$caseID = 'DeskFox-daily-' + [guid]::NewGuid().ToString('N')
$lab = Join-Path $env:TEMP $caseID
$project = Join-Path $lab 'A'
$projectB = Join-Path $lab 'B'
$outside = Join-Path (Join-Path $env:USERPROFILE 'Downloads') $caseID
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Put($p, $s) { [IO.File]::WriteAllText($p, $s, $utf8) }
New-Item -ItemType Directory -Force -Path $project,$projectB,$outside,(Join-Path $project 'ignored-cache'),(Join-Path $project 'untracked') | Out-Null
Put (Join-Path $project '.gitignore') "ignored-cache/`n"
Put (Join-Path $project 'tracked.txt') 'TRACKED BASE'
Put (Join-Path $project 'ignored-cache/tracked.txt') 'FORCE TRACKED'
git -C $project init
git -C $project add .gitignore tracked.txt
git -C $project add -f ignored-cache/tracked.txt
git -C $project -c user.name=DeskFox-QA -c user.email=qa@example.invalid commit -m fixture
$cases = @{'中文 空格.md'='CN_SPACE'; 'report%20draft.md'='LITERAL_PERCENT'; 'report draft.md'='REAL_SPACE'; 'report#节.md'='HASH_NAME'; '100%.md'='RAW_PERCENT'}
foreach ($name in $cases.Keys) { Put (Join-Path $project $name) ("# 文件`n`n" + $cases[$name]) }
1..186 | ForEach-Object { Put (Join-Path $project "untracked/$_.txt") (("line $_`n") * 100) }
function LinkPath($p) { (($p.Replace('\','/') -split '/' | ForEach-Object { if ($_ -match '^[A-Za-z]:$') { $_ } else { [Uri]::EscapeDataString($_) } }) -join '/') }
$links = foreach ($name in $cases.Keys) { "[$name](" + (LinkPath (Join-Path $project $name)) + ')' }
Put (Join-Path $project '目录.md') ("# 开始`n[到章节](#目标章节)`n`n" + (("占位段落`n`n") * 40) + "## 目标章节`nTARGET_SECTION`n[回开头](#开始)`n[缺失](#不存在)`n`n" + ($links -join "`n`n"))
Put (Join-Path $project '入口.md') '[跨文档章节](./%E7%9B%AE%E5%BD%95.md#%E7%9B%AE%E6%A0%87%E7%AB%A0%E8%8A%82)'
git -C $project add -- '*.md'
git -C $project -c user.name=DeskFox-QA -c user.email=qa@example.invalid commit -m file-fixtures
```

在 `$outside` 放一份**真正有效**的 PDF、DOCX、XLSX、PPTX，内容各含唯一标记 `OUTSIDE_PDF/DOCX/XLSX/PPTX`，不能改扩展名伪造；文件名带中文、空格或字面 `%`。使用 `LinkPath` 将各绝对路径链接追加到 A 的 `入口.md`。另留一个不存在路径。Windows 不支持文件名 `?`，该字符用例由 Mac 验，不在 Windows 伪造文件。

MCP 使用现成无凭据 fixture：`packages/opencode/test/fixture/mcp-lifecycle-stdio.ts`。配置键取本轮唯一名，定义为 `{"type":"local","command":["<bun.exe绝对路径>","<checkout>/packages/opencode/test/fixture/mcp-lifecycle-stdio.ts"]}`；它列出 `current_directory` 工具，不用于检验工具执行结果。先在 **local sidecar 的 `/path` 响应所示 config 目录**备份全局配置并加入此项，再使 A/B 继承；不要改正式版配置。另做同名项目定义覆盖场景，连接参数以各自定义为准。

## 六项最少操作与通过标准

| 项目 | 操作 | 必须实际看到 |
| --- | --- | --- |
| REQ-149 | 按下一节做前后负载对照；修改 tracked/新建未忽略文件；force-tracked 文件 `git rm`；切项目/分支及 detached HEAD 切提交 | 忽略事件不堆积 diff；tracked/删除/HEAD变化仍更新；旧项目迟到结果不覆盖新项目；负载中目录和普通消息提交可用 |
| REQ-152 | 从 `目录.md` 逐个点击五个盘符绝对链接；再让模型引用同组文件，从聊天点开 | 显示对应唯一标记；`LITERAL_PERCENT` 与 `REAL_SPACE` 不混淆，中文/空格/%/#不截断、不二次解码；`C:/…` 保持可点击链接，不退化为正文 |
| REQ-146 | 点击目录里的来回/缺失锚点；从 `入口.md` 点击跨文档章节；切文件后再点 | 目标标题真实进入视口；缺失锚点不跳首页、不离开会话；不滚动别的同名章节 |
| REQ-160 | 点击 Downloads 内 PDF、三种 Office 和普通 Markdown/文本；再点不存在路径；项目外 Markdown 含本地图片/style资源；切到远端/WSL重试外部路径 | 内部只读预览显示标记/页内容，项目树与根不变；错误明确，不隐式启动默认应用；图片/style不自动读旁边文件；远端/WSL不打开本机同名文件。Office失败不能算成功验收 |
| REQ-162 | 在新测试会话要求实际模型读取/引用上述文件，再要求生成一个中文空格文件并汇报完成；**不要显式要求链接或Markdown格式**，验证应用注入约定；每类当前启用通道至少一次 | 回复给真实路径链接，点开正确内容；未知同名文件不猜地址。记录 provider/model/通道（原生、AI SDK、OAuth、workflow、桥接按实际启用项），未配置者记未测；不要把手写 Markdown 当模型输出 |
| REQ-153 | 按下节在两个 A 窗口与 B 做关闭、切换、冷重启、手动开启、故障/只读测试 | 保存用户意图、作用域不外溢、窗口一致、失败不伪成功，不因迟到连接重新启用 |

## REQ-149：两端一致的负载基线口径

Mac 已完成实际对照，详细夹具与实测偏差见 [7-mac-vcs-load.md](./7-mac-vcs-load.md)。该轮为固定 35 秒、10 个采样点、实际约 19.3–19.6Hz，前后各 phase 独立重启；Windows 若沿用本节 30 秒示例，应明确记录差异，仅在同平台同规则下比较两版，不跨平台直接比较耗时。普通聊天自身会触发少量 diff，判断 ignored 额外请求时须与相同交互的 idle 组比较，不能把所有 diff 都归给 ignored。

Mac/Windows **各在自己的同一台机器**对比“修复前 local 基线”和“最终集成头 local”；基线优先 `fc96b0b5b5`，若使用实际旧版本须写完整 SHA。同端保持同一仓库快照、186个未跟踪文件/每文件100行、Git版本、磁盘位置、窗口数、预热方式和请求采集方式；跨机器不直接比较绝对耗时。

每个版本先空闲30秒记录基线，再各跑一轮“仅忽略事件30秒”“忽略+tracked混合30秒”。下方沿用建夹具的PowerShell会话（若另开终端，先重新设置同一 `$project`、`$utf8` 与 `Put`），先调用 `Load $false`，回到相同快照后再 `Load $true`；每轮600次、约20次/秒、200个文件轮换，用临时文件替换模拟快照更新。附加Office链接/MCP配置完成后先固定快照并记录实际未跟踪文件数，两版使用同一计数，不能只写名义186。

```powershell
function Load([bool]$mixed) {
  1..600 | ForEach-Object {
    $dst = Join-Path $project ("ignored-cache/snapshot-{0}.json" -f ($_ % 200))
    Put "$dst.tmp" ("{`"tick`":$_}")
    Move-Item -Force "$dst.tmp" $dst
    if ($mixed -and ($_ % 20 -eq 0)) { Put (Join-Path $project 'tracked.txt') "TRACKED $_" }
    Start-Sleep -Milliseconds 50
  }
}
```

记录实际事件速率（调度误差允许，不能只填名义20Hz），相同事件集合也由 Mac 重放。每轮用桌面 DevTools Network/HAR记录 `/vcs/diff` 与 `/deskfox/vcs/refresh-required` **分别**的次数、同时在途峰值、排队时间、单次耗时和结束后恢复时间；不要把“判定1+diff1”误报成同一个请求并发2，也不宣称跨多窗口全局限流。

负载中每轮至少展开目录10次、提交普通聊天消息10次，录屏/时间戳测“点击→内容出现”和“普通消息提交→后台接受（或用户消息已持久化）”，不把模型首token耗时算提交延迟。基线与新包必须测同一普通消息路径；现有GUI仅覆盖question reply，不能据此替代T04。逐次记录、汇总中位/P95/最大值，目标每次≤1秒。仅忽略轮相对空闲初始请求应无新增diff；混合轮同一窗口diff/判定各最多1条在途，挂起期间合并、结束最多补一次，队列不持续增长；真实内容不能漏刷。保留已有ignored文件预览能更新的回归。任一不符记失败，不靠只看“最终不卡”签字。

## REQ-153：重启、作用域与多窗口

1. A 两个窗口与 B 均先看到fixture工具。A窗口1关闭，窗口2同步为disabled/工具不可用；成功提示仅当前项目。检查 A `.opencode/opencode.jsonc` 仅写 `mcp.<name>.enabled=false`，原连接参数、注释/其他配置不变；B及另一worktree仍按原配置启用。
2. 刷新、切会话、切B再回A；**退出所有local窗口并确认sidecar退出，再冷启动两次**。A仍禁用且日志无该fixture连接尝试；必须手动开启后才能恢复，开启后再重启仍启用。状态disabled与网络/认证失败必须区分。
3. 加同名项目定义，重复关闭/开启，验证项目覆盖仍只保存enabled，不复制全局参数。移除该测试连接定义后只有enabled覆盖不应凭空启动；重新添加同名定义仍服从项目意图。
4. 仅对测试A的配置文件设只读，切开关应报保存失败且不显示虚假成功，恢复可写后可操作；不要修改正式配置ACL。慢连接/快速开关若有可用fixture则关闭后等待迟到响应，工具不得重新出现；无可用慢连接夹具须标未测，不借自动化结论代签。

## 回执与剩余项

Windows 电脑接手时先追加身份/日期/分支头；完成后在本目录 `3-changelog.md` 写：Windows版本/架构、产品SHA+最终文档头、local exe路径/哈希、夹具与Git/Bun版本、逐项结果、REQ-149两版数据表、截图/录屏/HAR/sidecar日志路径、模型通道和未测原因。模型/配置证据脱敏，不提交凭据或正式数据。

自动化已绿只是起点；Windows未接手、真实Office/模型/负载未跑的项保持待验。Mac只签Mac，Windows只签Windows；此交接单不把feat标done、不沿用旧149回执、不替李哲做版本放行。
