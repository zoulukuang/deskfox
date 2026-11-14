feat-id: daily-use-integration
status: in-progress
related: ./3-changelog.md ./4-windows-handoff.md ./10-windows-evidence.md

# Windows 验收缺陷复验

## 验收用例

- [x] REQ-149 后台真实 Git：186 个未跟踪文件复现性能问题，另以真实 Git 回归核对批量补丁和统计、Git 调用数、空文件、二进制、特殊路径、属性、暂存删除、无 HEAD、嵌套目录和工作树。逐文件对照 Git 原有结果，核对真实索引和对象目录未被写入。
- [x] REQ-149 Windows local：使用原夹具与同机旧包和新包。真实混合负载记录普通提交至 HTTP 204、SQLite 落库、目录展开至子文件可见、diff 与路径判定的请求数、并发和清空时间。另验忽略、tracked、force-tracked 删除和 HEAD。
- [x] REQ-146 浏览器：首次跨文档跳转、从已经打开的目标返回顶部后切到同名标题文档，再经入口重访。以标题进入视口验收，同时验证无链接切换仍还原之前的文件滚动位置。
- [x] REQ-146 Windows local：重新构建后用上述步骤在隔离桌面窗口验收，留存重访的坐标与截图。

## 定位与实现

- REQ-149：watcher 已判定 tracked 需要刷新，耗时集中在实际 diff。原 Vcs 实现对每个未跟踪文件分别调用 Git 的 numstat 与 patch。用原夹具的 186 个文件实测，372 次串行 Git 调用用时 10.71 秒。使用临时索引批量计算为 151 ms，另一次带隔离对象目录的独立原型为 171 ms，对应原串行为 13.00 秒。
- REQ-146：跨文档重访时，已缓存 Markdown 的标题先定位成功，下一帧的 tab 滚动恢复把视口拉回旧位置。Chromium 回归修前在最终重访步骤的 viewport ratio 为 0，修后三条文件链接 e2e 全绿。成功定位时同步记下实际视口坐标，并清除更早的排队滚动保存，复用既有的 tab 滚动状态。

## R4 提交复核

冻结产品/测试树 `36dd62205aeb1bd6aab19689e824c947dbed0e9a`，基于 `525fe662efcab4a1d9b54268bc2e24ae1c2425c8`。实际补丁 SHA-256 为 `a6da4f8d8d8c25468c5489c676b2985a89c2846b0ea96f271e0b4d97f7fc1b71`。本机补丁在 `D:/tmp/deskfox-daily-win-20261114/evidence/followup-r4.patch`。

| 黑名单文件 | 需要改动的原因 | 风险与验证 |
| --- | --- | --- |
| `packages/opencode/src/project/vcs.ts` | 现有 HTTP、分支和 working diff 都走 Vcs 文件组装入口。独立 helper 需要在该入口获取同一份 Git 路径列表并回填现有响应。仅在渲染器或 HTTP 外层包装会遗漏现有调用者，无法复用内部的路径与输出预算。 | 变化集中在多文件未跟踪项。用独立临时索引、对象目录和 NUL 路径，按 Git 输出关联统计和补丁，保留 cap 和文件级回退。回归覆盖 Git 真实补丁、属性、空文件、特殊路径、staged deletion、无 HEAD、嵌套目录和 linked worktree。验证用户索引字节和对象文件列表一致。 |
| `packages/opencode/test/project/vcs.test.ts` | 在现成的 Vcs 服务和真实 Git 实例夹具上调用生产入口，使用 Git Trace2 跟踪实际子进程。只测 helper 无法发现生产调用继续走逐文件命令的问题。 | 变更限新增用例，Trace2 环境在用例结束时恢复。 |

暂存补丁已通过 Git diff 检查。按 CLAUDE.md R4，黑名单改动正式提交前需要用户对该冻结补丁二次确认。

## Windows local 包

Bun 1.3.14 冻结安装用时 64.11 秒。在独立 worktree 执行 `pwsh -NoProfile -File packages/branding/scripts/build-deskfox-electron.ps1 -Env local`，最终构建用时 295.43 秒，产物内包含 soffice.exe 和 presets。构建基于上述 HEAD 加冻结产品树，尚无该产品树对应的正式提交。

- exe 为 `D:/project/deskfox-win-daily/packages/desktop/dist-deskfox/win-unpacked/DeskFox 本地版.exe`，SHA-256 `a7dc5675ca55596e2843642897edf54910ed99ba107156ab80976e1fa7c35d26`。
- app.asar SHA-256 为 `366d8f52541881d7d131c5d4e77b0b48ae4a2494281bd4a540017377103f3af7`。
- 对照为上一份集成候选 local 包，代码 `30d0d13afa2371190212959c3cb7ba25195e63b4`，exe SHA-256 `995253f32183e238778bc0375c5d5146f7ed4c010b1debb4f77b838943c276f9`，app.asar SHA-256 `9f896b89b4814e9f80dd45789b4cf2d19aa7b8688f57060d59deb00990b1bf51`。两版 bun.lock SHA-256 为 `1563688f944b9a8a2d844c1877274c8bc345dac665a3fa437c6a75992df2101e`。

## 自动化结果

- `bun typecheck` 在 `packages/app` 和 `packages/opencode` 通过。完整 `.husky/pre-push` 本地执行通过，29 个 workspace 类型检查及 6 个包的自动化测试均完成。
- Chromium 文件链接回归 3/3 通过，包含重访标题和普通 tab 恢复原有滚动位置。Markdown 锚点单测 5/5 通过。
- 与打包和桌面负载同跑时，HTTP 路由的 ignored 检查曾返回 `true`，符合分类超时的保守刷新路径。保留失败日志。结束桌面负载后，不改测试和超时，VCS diff、路径判定和 HTTP 三组重跑共 20 通过、105 断言、零失败；依赖 POSIX FIFO 的一项按原条件在 Windows 跳过。

## Windows local 结果

实际运行 Windows 11 x64 打包 Electron，通过 CDP 操作窗口。每轮隔离配置、数据库和合成 Git 项目。普通聊天使用 loopback 模型桩，测点击发送到真实 sidecar 返回 HTTP 204 并用 SQLite 核对消息。目录展开耗时至真实子文件可见。每轮采样十次，先展开，再发普通聊天。每种负载运行 30 秒并观察 10 秒。仅忽略组实写 599 次（约 20 Hz），混合组额外修改 tracked 文件 29 次。旧包负载与新版构建有时间重叠，比较时保留这一条件差异。

| 包 / 负载 | 目录中位 / P95 / 最大（ms） | 提交中位 / P95 / 最大（ms） | 落库 | diff 次数 / 峰值并发 / 最大（ms） | 判定次数 / 峰值并发 / 最大（ms） | 停写 / 10 秒后在途 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 旧包 / 空闲 | 96.2 / 128.7 / 128.7 | 122.2 / 157.3 / 157.3 | 10/10 | 0 / 0 / — | 0 / 0 / — | 0 / 1 |
| 旧包 / 仅忽略 | 96.5 / 166.3 / 166.3 | 130.1 / 164.1 / 164.1 | 10/10 | 0 / 0 / — | 91 / 1 / 335.1 | 2 / 1 |
| 旧包 / 混合 | 190.8 / 368.5 / 368.5 | 157.6 / 187.2 / 187.2 | 10/10 | 0 / 0 / — | 74 / 1 / 1041.3 | 13 / 0 |
| 新包 / 空闲 | 59.1 / 96.7 / 96.7 | 85.8 / 99.2 / 99.2 | 10/10 | 10 / 1 / 517.6 | 0 / 0 / — | 0 / 0 |
| 新包 / 仅忽略 | 61.9 / 82.5 / 82.5 | 91.9 / 99.2 / 99.2 | 10/10 | 10 / 1 / 489.9 | 118 / 1 / 248.7 | 0 / 0 |
| 新包 / 混合 | 84.1 / 149.3 / 149.3 | 100.8 / 123.7 / 123.7 | 10/10 | 39 / 1 / 707.7 | 108 / 1 / 296.7 | 2 / 0 |

diff 和判定统计按 30 秒内开始的请求计数。旧包仅忽略组另有一条窗口开始前发出的 diff，历时 50.99 秒并于停写后完成，随后还有一次刷新在途。旧包混合组停写时 13 条包含 12 条文件读与 1 条判定，已在观察期内清空。新包仅忽略组 118 次判定全部返回 `false`，diff 数与空闲组相同。新包混合组 39 次 diff 和 108 次判定均在观测内完成，两类请求各最多一条在途。停止写入时各有一条，静默十秒后的非 SSE 请求归零。测试期间的独立直连 sidecar diff 由旧包 21.30 秒降为新包 358 ms，返回同为 188 项，tracked 内容仍正确。已打开的 ignored 文本预览在写入后可见更新，完整检查步骤为 753 ms。

新包实际 watcher 看到了 tracked 与新未跟踪文件（1.34 秒），detached HEAD 切换通过（1.05 秒），在 A 请求在途时转到 B 后只显示 B 的内容（15.30 秒，含两次导航和固定等待）。组合用例取删除后的首条 diff，当时未包含删除，保留失败。独立删除测试从 `git rm` 起监听连续响应及分类结果，第一条同样未含删除，第二条包含正确的 `deleted` 补丁且分类返回 `true`。按观察到正确刷新的完整步骤计，旧包 36.71 秒，新包 1.10 秒。

REQ-146 首次跨文档和跨文档重访均通过。旧包重访后标题顶部为 2330 px，超出 902 px 高视口。新包重访 1.3 秒后标题仍完整位于视口内，范围为 162.8–186.8 px。首次及重访验收步骤（包含固定等待）分别用时 3.98 秒和 2.08 秒。

另用 Computer Use 在新包的 Windows 窗口点击重访链接。前置状态用 CDP 准备，最终点击走 Windows 原生鼠标输入，可见标题与 `TARGET_SECTION`。随后采集的坐标仍为 162.8–186.8 px。[点击后截图](./11-windows-evidence/req146-native-click.png)和[坐标](./11-windows-evidence/req146-native-click.json)已留存，原始记录位于 `candidate-followup-native-anchor`。

十一轮验收均记录了退出，CDP、隔离 sidecar 和本地模型桩均已关闭，默认协议恢复，原正式版进程保留。

## 证据索引

- [两包六组逐次数据](./11-windows-evidence/load.json)、[新包混合负载截图](./11-windows-evidence/req149-mixed.png)、[新包重访截图](./11-windows-evidence/req146-revisit.png)、[修前坐标](./11-windows-evidence/req146-revisit-before.json)、[修后坐标](./11-windows-evidence/req146-revisit.json)。
- 原始证据根目录 `D:/tmp/deskfox-daily-win-20261114/evidence`。负载见 `candidate-{idle,ignored,mixed}-retry-rerun-{before,after}`，每组含 `measurement.json`、`db.json`、`measure.log`、`electron.log`、启动和退出记录。直接 diff 与预览见 `candidate-vcsinspect` 和 `candidate-followup-vcsinspect`，首次和重访图片、几何记录见 `candidate-anchor` 与 `candidate-followup-anchor`。
- tracked/untracked、HEAD、项目切换与首条删除响应见 `candidate-followup-vcsfocused`，修前、修后持续观察删除见 `candidate-vcsdelete` 与 `candidate-followup-vcsdelete`。每组的 `checks.json`、`measure.log` 和相应网络记录均保留。
- 构建及测试见同目录 `followup-install.log`、`followup-final-build.log`、`followup-vcs-red.log`、`followup-final-vcs-isolated.log`、`followup-vcs-final-combined.log`、`followup-anchor-green.log`、`followup-pre-push.log`。
