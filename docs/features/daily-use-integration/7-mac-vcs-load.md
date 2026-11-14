# REQ-149 T04：Mac 打包应用前后负载对照

执行：笑南的电脑，Codex 子 agent `vcs_ignore_design`，2026-11-14。仅 QA，未改产品代码、未提交。本回执补充 [6-mac-local.md](./6-mac-local.md) 当时尚未执行的 T04；不覆盖该文其他未验边界。

本轮 Mac T04 通过：候选版 idle / ignored / mixed 各 10 次文件树展开、10 次普通聊天提交均 ≤1 秒，全部消息最终落库，无缺样。基线 ignored / mixed 各出现 1 次展开和提交等待 ≥2 秒，并存在持续请求积压；失败原样保留，六个 phase 各只跑一次。此结论限本机、下述负载和 CDP 驱动的真实打包应用，不能代签 Windows 或完整发布验收。

## 代码与包的来源

- 基线：独立 detached worktree `/Volumes/ExtSSD/software/Codex/worktrees/daily-use-baseline-fc96`，精确 HEAD `fc96b0b5b5c8f4fce55875ec42b328f4731d6cc5`；构建后及测试后 `git status --short` 均为空。未采用带语音差异的包。
- 候选：`daily-use-integration` 的产品基准 `a4d3ec5691` 加 MCP 补充修复。构建时为 `c5b9ded3b5` 加已批准补丁 `ec8a042c6d3b097b600693b655309f97eaff36fb08783e9b68494db591a0b7f1`；该补丁随后以 `f517fc04b4` 提交。ASAR 与 [6 号回执](./6-mac-local.md) 的复验产物一致。
- 两版均为 `OPENCODE_CHANNEL=local bun run build`、DeskFox electron-builder 配置 `--mac --dir --arm64`，复用相同 Electron 42.11.15 缓存。T04 不调用 LibreOffice。
- 基线首次 frozen install 因 tree-sitter-powershell 找不到 node-gyp 失败；补充临时 node-gyp 可执行路径后 frozen install 成功（97.26 秒）。另以 APFS clone 复用依赖，并核实 40 处 node_modules、9,659 条 symlink 没有指向其他 worktree；app / core / opencode / SDK / session-ui / desktop 所需 workspace 解析均回基线。两边 bun.lock SHA-256 相同：`1563688f944b9a8a2d844c1877274c8bc345dac665a3fa437c6a75992df2101e`。没有修改 tracked 依赖或源码。

| 打包产物 | app.asar SHA-256 | 包内核验 |
|---|---|---|
| 基线 | `d4ffb121406583832c5b381d4a90e04d75a8ab424e23fc3e3af22eb81ab7c295` | renderer `main-4oK4b5lH.js`；无新 refresh-required API / createVcsRefreshFilter / MCP 默认配置 marker |
| 候选 | `378a32dd08aa46ea25410d96e5efde55b608e04089fce7d393169c6cca3890c8` | renderer `main-XdbEvLD-.js`；三个 marker 均存在 |

以上核验读取实际 ASAR 的 main / renderer JS，而非仅检查源文件。构建日志保留 `/tmp/t04-baseline-install.log`、`/tmp/t04-baseline-install-retry.log`、`/tmp/t04-baseline-build.log`、`/tmp/t04-baseline-package.log`；依赖与包证明见下述证据根的 `dependency-provenance.json`、`package-provenance.json`。

## 采集方法与隔离

证据根：`/Volumes/ExtSSD/software/Codex/artifacts/t04-native-20261114`。脚本 `run-phase.py`、`measure.cjs`、`fake-model.py`、`analyze.py` 全部保留在该目录；未加入产品源码。

- 六组顺序固定：基线 idle → ignored → mixed → 候选 idle → ignored → mixed。每组独立 runtime / DB / app 主进程 / sidecar；前组完整退出后才开始下一组。不以关闭窗口替代退出，不把重启取消请求记为自然排空。
- 同一个真实 Git 夹具，HEAD `fd45ce499fbaf4f31e97d85d75f0409b36aad040`：186 个未跟踪文件，各 100 行；另有 tracked.txt 和忽略目录 ignored。每组恢复 tracked 初值、清除合成 ignored 文件。六份 fixture.json 的 path / hash / lines 完全相同，独立审阅者计算归一序列 SHA-256 `b1533a0f98ef348e734b8f5d2c1b4f5305cadb6dfa5435e185faf1c93b67750d`。
- 真实 Electron renderer、真实 sidecar、真实文件系统、watcher / SSE / VCS / HTTP / SQLite；CDP 只驱动应用按钮和观察结果。仅模型为独立 loopback OpenAI-compatible 短回复服务，用于排除远端模型时间；没有 mock 文件、VCS 或提交链。
- 每组先提交一条普通预热消息并看到模型 OK；随后两笔真实 tracked 写入（修改、恢复），各等实际 `/vcs/diff` 200 完成及请求排空，才开始正式窗口。六组 pendingAtStart 均为 0，预热 diff 不计入下表。
- 每组固定 35 秒；ignored / mixed 使用相同 50ms 定时器，前者全写 ignored，后者交替写 ignored / tracked。实际调度不保证精确 20Hz，逐次写入时刻全部留存，实际速率见下表。窗口实测 35000.8–35001.6ms。
- 10 个预定时点为窗口开始后 4、7、10、…、31 秒。每次点击此前未展开的独立目录，等待指定子文件实际可见；同时顺序填入唯一普通提示并点击 Send，等待对应 session + 提示的 `prompt_async` HTTP 204。网络监听在动作前建立；窗口后逐条核实真实 SQLite user message 文本。没有使用 question reply。
- 计时使用同一个宿主单调时钟，从 locator click 调用前开始，包含派发开销；目录可见采用 Playwright assertion，有轮询粒度，不代表精确像素绘制时刻。1 秒为指标，2 秒仅为等待截尾上限；HTTP 拒绝、交互失败、missed-slot 与等待超时分别记录。本轮无拒绝、交互失败或 missed-slot；最大 slot 偏移 2.68ms。
- 35 秒后停止写入，继续静默观察 10 秒。原始 requests / peak 包含这段静默；下表明确按 `startedMs < 35000` 切正式窗，峰值由 request → requestfinished/failed 重算。所谓并发峰值是**浏览器未完成请求（含连接池排队）**，不是 TCP 连接数。SSE 长连接排除。
- CFFIXED_USER_HOME、XDG 四目录、OPENCODE_TEST_HOME、OPENCODE_DB 均独立，Git 全局配置隔离。不读写正式 DB。原正式版 PID 1786 和 voice local PID 50560 全程保留。

准备/构建与正式执行分开：前面的“开始”通知包含启动准备，不能当作计时起点。以下为证据文件时间（Asia/Shanghai），主进程就绪至结果落盘包含预热、35 秒窗口及 10 秒静默；正式窗口精确耗时与样本均使用 JSON 的相对单调时间，未声称记录了毫秒级绝对起点。

| 组 | 进程记录 / 结果落盘 | 主进程 / sidecar PID（均已退出） |
|---|---|---|
| 基线 idle | 18:33:10 / 18:34:16 | 7257 / 7270 |
| 基线 ignored | 18:34:21 / 18:35:24 | 20231 / 20238 |
| 基线 mixed | 18:35:30 / 18:36:36 | 53816 / 53823 |
| 候选 idle | 18:36:42 / 18:37:49 | 88293 / 88302 |
| 候选 ignored | 18:38:03 / 18:39:06 | 9100 / 9107 |
| 候选 mixed | 18:39:18 / 18:40:25 | 29131 / 29139 |

## 结果

每组均计划并执行 10 次树展开、10 次普通提交；60 条请求均实际发出且最终落库。候选三组共 60 个操作无超限；基线两负载组共 4 个操作超过等待上限。落库成功不能代替提交延迟达标。

| 组 | 树 ≤1s | 提交 ≤1s | 树 / 提交最大观测 ms | 窗内 diff / 分类请求 | 窗内未完成峰值：全部 / diff / 分类 | 35s / 静默10s后未完成 |
|---|---:|---:|---|---|---|---|
| 基线 idle | 10/10 | 10/10 | 193.0 / 104.7 | 10 / 0 | 13 / 3 / 0 | 1 / 0 |
| 基线 ignored | 9/10 | 9/10 | ≥2000 / ≥2000 | 44 / 0 | 41 / 30 / 0 | 29 / 21 |
| 基线 mixed | 9/10 | 9/10 | ≥2000 / ≥2000 | 55 / 0 | 49 / 43 / 0 | 45 / 44 |
| 候选 idle | 10/10 | 10/10 | 172.0 / 81.5 | 9 / 0 | 12 / 1 / 0 | 1 / 0 |
| 候选 ignored | 10/10 | 10/10 | 159.1 / 73.3 | 9 / 55 | 12 / 1 / 1 | 1 / 0 |
| 候选 mixed | 10/10 | 10/10 | 156.4 / 87.4 | 10 / 79 | 12 / 1 / 1 | 1 / 0 |

基线 mixed 若包含静默期，全部请求峰值为 54，不能与正式窗的 49 混用。两组最后一条 prompt 在超时后仍收到 204；原始 request → 204 约 3479ms / 4009ms，这是网络请求时长的旁证，不冒充从 click 起算的精确延迟。超时样本保持 ≥2000ms，不当作 2000ms 实值纳入完整分布。`summary.json` 的中位/P95 只针对已完成样本，不能据它推导整体达标。

本轮包含普通聊天，idle 本身也有 9–10 次 diff。因此候选 ignored 的 9 次 diff 不能直接归因于忽略文件，也不能仅凭 aggregate 声称“忽略事件产生零 diff”；本轮证明的是共同用户动作下未见新增积压。纯 ignored 不触发 diff 的证据仍以已完成的独立 watcher / Git / 浏览器回归为准。

| 负载组 | 实写次数（ignored / tracked） | 实际 Hz（次数/35） | 首次 / 末次写入 ms | 写间隔中位 / 最大 ms |
|---|---|---:|---|---|
| 基线 ignored | 687（687 / 0） | 19.63 | 51.4 / 34980.6 | 51.03 / 58.43 |
| 基线 mixed | 686（343 / 343） | 19.60 | 51.3 / 34949.4 | 51.10 / 52.69 |
| 候选 ignored | 677（677 / 0） | 19.34 | 52.3 / 34984.8 | 51.85 / 62.37 |
| 候选 mixed | 677（339 / 338） | 19.34 | 50.7 / 34950.6 | 51.88 / 53.36 |

候选实际写入数分别比基线少 1.46% / 1.31%；这是相同计时器规则的实际调度差异，未把它描述成事件次数完全相等。写入数也不是 OS watcher 去重后的通知数。只有一次顺序对照，无随机化、多机或长时统计置信度结论。

逐次数据如下，单元格为 **树可见 / prompt 204，毫秒**；`≥2000` 是右截尾，所有样本 requestSent / persisted 均为 true。完整精度、实际开始偏移、HTTP 完成时刻与每次写入保存在各组 measurement.json。

| 样本 | 基线 idle | 基线 ignored | 基线 mixed | 候选 idle | 候选 ignored | 候选 mixed |
|---|---|---|---|---|---|---|
| 1 | 193.0/104.7 | 138.0/58.5 | 134.1/60.4 | 164.3/80.9 | 47.5/70.5 | 136.1/57.3 |
| 2 | 150.6/59.7 | 158.6/117.6 | 151.8/56.2 | 147.4/59.3 | 144.8/69.1 | 156.4/66.5 |
| 3 | 153.1/62.1 | 138.3/61.8 | 136.4/59.8 | 150.4/59.4 | 146.6/67.9 | 134.8/56.3 |
| 4 | 138.4/71.2 | 140.5/56.5 | 136.4/57.3 | 150.6/67.2 | 146.0/56.4 | 143.1/77.5 |
| 5 | 138.2/66.3 | 140.6/64.9 | 139.2/65.2 | 150.6/66.9 | 147.0/70.8 | 139.4/62.0 |
| 6 | 141.8/73.6 | 157.1/65.1 | 142.3/69.4 | 138.9/70.6 | 132.2/66.0 | 144.3/66.5 |
| 7 | 142.7/68.5 | 145.5/67.3 | 144.0/74.0 | 140.8/69.1 | 151.3/70.1 | 143.0/70.6 |
| 8 | 142.7/76.6 | 146.0/68.6 | 143.2/61.4 | 172.0/72.3 | 53.8/70.0 | 47.6/67.6 |
| 9 | 144.5/64.7 | 147.1/72.0 | 143.6/70.2 | 155.0/68.8 | 151.2/72.3 | 140.6/66.7 |
| 10 | 142.8/82.1 | ≥2000/≥2000 | ≥2000/≥2000 | 154.8/81.5 | 159.1/73.3 | 145.6/87.4 |

## 留证、退出与边界

每个 `{baseline,candidate}/{idle,ignored,mixed}/` 留存 measurement.json、measure.log、fixture.json、ready/end-cdp.png、electron.log、process-start/exit.json、protocol.log；根目录 `summary.json` 含六份原始 JSON 的 SHA-256 及完整聚合。脚本和原始失败均未删除。

六轮启动后和退出后均恢复 `opencode` 默认处理器；最终只读回读为 `ai.deskfox.app`（final-protocol.log）。六轮主进程与 sidecar 均确认消失；假模型 PID 7253 已停止，端口 19501 / 19511 / 19512 / 19521 / 19522 全部关闭（final-cleanup.json）。正式 PID 1786 与 voice local PID 50560 均保留。未引入范围外的 local protocol guard 修复。

独立复核：`file_links` 已只读核查脚本、依赖解析、包内 marker、六份原始数据和退出记录；确认无方法阻断，候选本轮 T04 指标通过。此为 CDP 驱动实际打包 Electron 的结果，**不是 CUA 真鼠标或人工原生 OS QA**；不覆盖模型首 token、真实模型耗时、Windows、Intel、长期高负载或最终正式制品验收。没有产品修改，也没有因此发版或合入 main。
