# Windows 本地版验收证据

执行电脑为 Windows 电脑（YUEXI），2026-11-14。六项结论见 [3-changelog.md](./3-changelog.md)。

## REQ-149 同机对照

Windows 11 x64，版本 10.0.26300，Git 2.52.0.windows.1。两版均为新构建的 Electron 42.11.15 本地包。测试项目 A 位于同一磁盘，Git HEAD 为 049937ad7ee7d99e1c97bcf8ed85ca2ae619f347，有 186 个未跟踪文件（各 100 行）。六组起始 Git porcelain 输出 SHA-256 同为 7c0fdafc052672458268ddd84c2fa057b8ce8e48b591837c9ddf255a8667f975。每组单窗口，独立进程、配置、缓存和 SQLite。模型使用 loopback stub，watcher、Git、HTTP、文件树与落库均走实际包。

每组固定采样 30 秒并观察 10 秒，以子文件实际出现计目录展开时间，以点击 Send 至对应普通提示的 POST /session/:id/prompt_async 返回 204 计提交时间，退出后逐条复核 SQLite。两种动作在同一采样点并发派发，可能存在窗口内焦点竞争，因此超时保留，不能直接归因于 Git。正式窗开始时浏览器无在途请求，两版预热时限内均未观察到预期 diff 200。

| 组 | 实际忽略写 / tracked 写 | diff 数 / 峰值 | 判定数 / 峰值 | 30s / 40s 全部未完 | 目录 ≤1s | 普通提交 ≤1s / 落库 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 基线 idle | 0 / 0 | 8 / 8 | 0 / 0 | 8 / 7 | 8/10 | 10/10 / 10 |
| 基线 ignored | 599 / 0 | 6 / 6 | 0 / 0 | 6 / 8 | 8/10 | 10/10 / 10 |
| 基线 mixed | 600 / 30 | 93 / 93 | 0 / 0 | 93 / 94 | 8/10 | 10/10 / 10 |
| 候选 idle | 0 / 0 | 1 / 1 | 0 / 0 | 1 / 1 | 8/10 | 10/10 / 10 |
| 候选 ignored | 599 / 0 | 1 / 1 | 98 / 1 | 1 / 1 | 8/10 | 10/10 / 10 |
| 候选 mixed | 599 / 29 | 0 / 0 | 106 / 1 | 0 / 1 | 8/10 | 10/10 / 10 |

各负载组实际忽略写速率为 19.97–20.00 Hz，mixed 每 20 次再写入 tracked 文件。待完成数排除 SSE。正式窗口计数按请求发出时间截取，峰值为浏览器未完成请求数，可能含连接池排队。候选 mixed 静默期才发出一条 diff。各组有两个目录样本 ≥2 秒，以下目录统计仅用已完成样本，P95 采用最近秩。

| 组 | 目录中位 / P95 / 最大 ms | 普通提交中位 / P95 / 最大 ms | 窗内启动的 diff 实测完成数 / 耗时 | 判定中位 / 最大 ms |
| --- | --- | --- | --- | --- |
| 基线 idle | 115.0 / 145.9 / 145.9 | 128.8 / 159.6 / 159.6 | 1 / 23260.7 ms | — |
| 基线 ignored | 90.7 / 149.2 / 149.2 | 105.1 / 136.9 / 136.9 | 0 / — | — |
| 基线 mixed | 110.7 / 141.8 / 141.8 | 116.6 / 150.8 / 150.8 | 1 / 28065.9 ms | — |
| 候选 idle | 95.2 / 116.5 / 116.5 | 102.1 / 133.9 / 133.9 | 0 / — | — |
| 候选 ignored | 125.6 / 157.2 / 157.2 | 137.0 / 161.0 / 161.0 | 1 / 25783.3 ms | 157.5 / 323.7 |
| 候选 mixed | 94.0 / 123.8 / 123.8 | 110.9 / 145.9 / 145.9 | 0 / — | 134.1 / 292.9 |

候选判定请求均为 HTTP 200。有浏览器完成记录的请求中，启动到开始发包最大差值为候选判定 22.2 ms、diff 1.8 ms。候选仅忽略组与 idle 的 diff 次数相同，混合组未见请求队列持续增长，但候选静默 10 秒时仍有 1 条未完。诊断样本中，watcher 确实将 tracked 文件送判并得到 true，直接判定忽略文件为 false。直接读取包含 188 项的 diff 用时 21.30 秒，渲染器后续自行发出 diff。已打开的忽略文件从旧标记刷新至新标记。

另用候选包做一轮混合负载串行补测，每个采样点先点开目录、见到子文件，再发送普通消息。该轮保留先前真实模型生成的合成报告，Git 状态与正式六组差一个未跟踪文件。两类交互均 10/10 在 1 秒内，最长 173.8 ms / 138.9 ms。实际写入 599 次忽略文件、29 次 tracked 文件。40 秒时仍有一条 diff 在途。原始记录在 `evidence/candidate-mixed-retry-sequential/`。

## 证据目录

本机根目录 `D:/tmp/deskfox-daily-win-20261114`。`evidence/{base,candidate}-{idle,ignored,mixed}/` 含逐次耗时和浏览器请求记录 `measurement.json`、落库记录 `db.json`、截图 `ready.png` 与 `end.png`、进程日志 `electron.log` 及启动退出记录。汇总为 `evidence/load-summary.json`。两次负载准备期失败保存在 `evidence/base-idle-preflight` 和 `evidence/base-idle-prewarm`。包构建日志为 `evidence/{base,candidate}-build.log`。

隔离 sidecar 日志位于 `runtime/<组>/data/opencode/log/opencode.log`，桌面日志位于 `runtime/<组>/home/AppData/Roaming/ai.deskfox.app.local/logs/`。完整原始数据、失败证据和脚本留在本机，代表截图如下。

- [候选混合负载](./10-windows-evidence/load-mixed.png)
- [跨文档重访时标题位于视口外](./10-windows-evidence/anchor-revisit.png)
- [项目外 DOCX 冷启动渲染](./10-windows-evidence/outside-docx.png)
- [真实模型文件链接](./10-windows-evidence/model-links.png)
- [同项目另一窗口同步为关闭](./10-windows-evidence/mcp-second-window.png)
- [逐次目录与普通消息耗时及落库结果](./10-windows-evidence/load-samples.json)
- [逐项诊断结果](./10-windows-evidence/checks.json)
- [构建、OAuth 超时和 MCP 验证日志摘录](./10-windows-evidence/qa-log-excerpts.txt)
