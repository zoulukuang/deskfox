feat-id: stale-path-hardening
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

分支 `feat/stale-path-hardening`(从 `main/bbc990861`)。commit hash 待提交后回填。

## 追加批次 2:发版前 code-review 修复(`feat/stale-path-shipfix`,2026-06-28)

`/ship prod`(批次1合 main 后再发)步骤 1 的 high-effort workflow code-review(8 finder + 独立 verify,40 agent)
对 `ship-prod-2026.8.1..main` 全量复审,命中 3 条 CONFIRMED 正确性回归 + 4 条 PLAUSIBLE(无启动崩溃级);
其中数条是批次1「修复」自身引入的回归。user 拍板「先修高危再发」。本批在 `feat/stale-path-shipfix`(从批次1
合并后的 `main`)修掉 **4 条**(3 CONFIRMED + 1 命中网络盘目标场景的 PLAUSIBLE),每条配复现测试、同 commit。

| commit | 修复 | 文件 | 测试 |
|---|---|---|---|
| `3dbeb540b` | **Fix A** `openProject` 改异步后多选目录循环未 await → 并发 navigate 竞态(落点不确定/toast 乱序) | `app` `home.tsx`(LegacyHome.chooseProject)/`startup-precheck.ts`(新 `openPickedDirectories` 串行助手) | startup-precheck +2(maxActive=1/完成顺序=输入顺序、错误冒泡) |
| `3dbeb540b` | **Fix D** 可移动盘拔出/盘符未映射 ENOENT 被无条件归 missing → forget 永久遗忘合法项目 | `desktop` `fs-probe.ts`(ENOENT/ENOTDIR 再探盘符根可达性) | fs-probe +2(A2c USB拔出/A2d UNC离线→unreachable),A2/A2b 改路径感知 stub |
| `6773f722f` | **Fix B** 自愈重试时真实非 NotFound 错误(磁盘满/DB 写失败)被 blanket catch 吞成 404 → 误导「项目不存在」+保存静默失败 | `opencode` `project-update-selfheal.ts`(重试只 catchTag NotFound,真错透传) | selfheal +1(B6) |
| `6773f722f` | **Fix C** Windows 跨盘符/UNC 绝对路径喂 ignore@7 抛 RangeError 被吞 → 降级不忽略 → `.git`/`node_modules` 泄漏进文件树 | `opencode` `ignore-path.ts`(`safeIgnores` 绝对路径退 basename) | ignore-path +4(跨盘.git/node_modules/UNC/普通文件) |

**验收**:新增/改 9 单测全绿(ignore-path 12 / selfheal 6 / fs-probe 10 / startup-precheck 12)+ 回归 project.test+project-rebind 45 全绿 + app/desktop/opencode typecheck 全绿。
ignore-path 偶发 `(unnamed)` afterAll hook 超时 = 全局 `test/preload.ts` 在 Windows 上 SQLite WAL EBUSY 重试清理 flaky,`--timeout 60000` 重跑 12 pass / 0 fail,与本批改的纯函数无关。

**⚠️ 有意行为变更(Fix D)**:可移动盘拔出/盘符未映射从 `missing`(forget)改判 `unreachable`(保留 lastProject)——
**修订《版本计划》「迁移发现 §④」原「盘符未映射 = missing」决策**。理由:USB 拔出→盘符 ENOENT→旧逻辑永久遗忘合法项目、
用户重连后项目从最近列表消失;非破坏性方向取 unreachable 更安全。已在 `fs-probe.ts` 代码注释标注,版本计划待同步。

**R4 override(本批,本季第 4 笔)**:`6773f722f` 触动 `packages/opencode/` 路径黑名单(2 改 fork-only helper + 2 fork-only 测试),user 2026-06-28 审复核报告后批准,`--no-verify` 提交。
- wrapper 不可行性:`ignore-path.ts` / `project-update-selfheal.ts` 是 **100% fork-only helper(0 上游逻辑)**,放 `packages/opencode/` 仅为 import 就近其服务的上游 handler;本批**未碰任何上游代码**;移出会造 opencode-core → fork 包反向依赖更糟(同批次1/原 feature 路径黑名单误伤 precedent)。
- 风险:B 让真实错误浮现(原被吞成误导 404)、C 让跨盘 `.git` 被忽略(原泄漏)且不再依赖异常被抛;无新增对外面;9 新测+45 回归+typecheck 全绿;diff 87 行 < 500。
- ⚠️ **配额提示**:本季 override 累计达 **4 笔**(v2026.8.3 / stale-path 批次1 两笔 / 本批),已超 ≤2/季健康软目标 2 笔 —— 季度自查重点项。
- 回退:`git revert 6773f722f`(各修复带 FORK marker、相互独立)。

未修(超本批范围,留待后续):review 命中的 PLAUSIBLE `selfheal fromDirectory 抛 defect→500`、`openSession 守 worktree 导航 session.directory 错位`、`server.tsx forget 写 undefined 进 typed Record`,及 3 条清理类(forget+toast 三处复制抽 helper / 自愈用重量级 fromDirectory / fs-probe 超时孤儿 stat 未取消)。

## 追加批次:发版前 code-review 修复(`feat/stale-path-review-fixes`,2026-06-27)

`/ship prod` 步骤 1 的 high-effort code-review(多 agent finder + 独立 verify)命中本 feature 待发内容若干确认项;
user 拍板「全部修完再发」。本批在 `feat/stale-path-review-fixes`(从 `main/89e966b19`)修掉,每条配复现测试。

| commit | 修复 | 文件 | 测试 |
|---|---|---|---|
| `c92abc535` | **Fix A** fs-probe stat 无超时 → 离线网络盘/UNC 启动卡死 | `desktop/src/main/fs-probe.ts`(抽 `probeWithStat`+超时竞速) | fs-probe.test.ts +5(超时/errno) |
| `f9ef806ca` | **Fix D** 首页最近列表/会话手点死路径仍进 openProject → 白屏+/file 500 | `app` `startup-precheck.ts`(+`checkProjectAvailable`)/`layout.tsx`/`home.tsx` | startup-precheck.test.ts +5 |
| `3275f542e` | **Fix E/G** media-gen 增量重建纳入 package.json+`-lt`;PathProbeResult 双向契约注释 | `branding` ps1 / `platform.tsx` / `fs-probe.ts` | 构建脚本免测 |
| `b007a90ba` | **Fix C/B/F** 沙箱 `orDie`→保守保留(离线盘不再崩 500)、update 自愈错误映射回**原始 id** 干净 404(不升级 500/不报 resolved 新 id)、list `path.resolve` 提一次 | `opencode` `project.ts`/`project-rebind.ts`/`handlers/project.ts`/`project-update-selfheal.ts`(新)/`file.ts` | project-rebind +4、selfheal +5(新) |

**验收**:新增/扩展 21 单测全绿 + monorepo typecheck 全绿(opencode/app/desktop 强制无缓存验证)。
预存失败 `httpapi-file「serves search endpoints」503` 经 stash 对比确认 HEAD 同样失败(环境性、属 search 端点非本次所改 list),非本批回归。

**R4 override(本批,本季第 3 笔)**:`b007a90ba` 触动 `packages/opencode/` 路径黑名单(3 改核心 + 1 既有测试 + 2 fork-only 新文件被路径误伤),user 2026-06-27 审复核报告后批准。
- wrapper 不可行性:崩点在 opencode 核心 Effect service(`fromDirectory` 沙箱循环)/ HTTP handler(update catch 链)内联,无注入缝;判定/编排已按 R1 抽到 fork-only `project-rebind.ts`(`keepSandboxUnlessConfirmedGone`)/`project-update-selfheal.ts`(`selfHealUpdate`),核心仅 1 行调 helper;`file.ts` 为纯微重构(提 `path.resolve`)。新 helper 因放 `packages/opencode/` 被路径黑名单误伤(同原 feature precedent)。
- 风险:全部严格更安全(崩→优雅降级、行为不变重构),无新增对外面;21 单测 + typecheck 全绿;diff 127 行 < 500。
- ⚠️ **配额提示**:本季 override 累计达 **3 笔**(v2026.8.3 / stale-path-hardening / 本批),超 ≤2/季健康软目标 1 笔 —— 季度自查需留意。
- 回退:`git revert b007a90ba`(各修复带 FORK marker、相互独立)。

## 改动文件

### 新 fork-only 文件(核心逻辑 + 单测)

| 文件 | 作用 |
|---|---|
| `packages/opencode/src/server/routes/instance/httpapi/handlers/ignore-path.ts` | REQ-067:`ignoreRelativePath` 大小写归一 + `safeIgnores` 防 `..` 抛错 |
| `packages/opencode/test/server/ignore-path.test.ts` | REQ-067 单测(8 测) |
| `packages/opencode/src/project/project-rebind.ts` | REQ-061:`isWorktreeConfirmedMissing` 三态判定 |
| `packages/opencode/test/project/project-rebind.test.ts` | REQ-061 三态单测(4 测) |
| `packages/desktop/src/main/fs-probe.ts` | REQ-068:`probePath` 路径存在性/可达性 + errno 分类 |
| `packages/desktop/src/main/fs-probe.test.ts` | REQ-068 probePath 单测(3 测) |
| `packages/app/src/pages/layout/startup-precheck.ts` | REQ-068:`decideStartupProject` 纯决策 |
| `packages/app/src/pages/layout/startup-precheck.test.ts` | REQ-068 决策单测(5 测) |

### 改上游(均带 FORK marker)

| 文件 | REQ | 改动 |
|---|---|---|
| `packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts` | 067 | list handler `ignored` 改 `safeIgnores(ignoreRelativePath(...))` + import |
| `packages/opencode/src/project/project.ts` | 061 | `existingWorktreeMissing` 改用 `isWorktreeConfirmedMissing`(三态)+ import |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/project.ts` | 064 | update handler NotFound 时 `fromDirectory` 重解析现行 id 重试(自愈) |
| `packages/opencode/test/project/project.test.ts` | 064 | 加身份迁移 stale id 自愈集成测试 |
| `packages/app/src/pages/layout.tsx` | 068 | autoselecting 两条 openProject 前插 `ensureProjectAvailable` pre-check + import |
| `packages/app/src/context/platform.tsx` | 068 | `Platform.pathExists?` + `PathProbeResult` 类型 |
| `packages/app/src/context/server.tsx` | 068 | projects 加 `forget(directory)` |
| `packages/app/src/i18n/{en,zh,zht}.ts` | 068 | `project.path.{missing,unreachable}.{title,description}` |
| `packages/desktop/src/main/index.ts` | 068 | deps `pathExists` + import probePath |
| `packages/desktop/src/main/ipc.ts` | 068 | Deps 类型 + `ipcMain.handle("path-exists")` + 类型 import |
| `packages/desktop/src/preload/{index,types}.ts` | 068 | `pathExists` api 实现 + ElectronAPI 类型 + 类型 re-export |
| `packages/desktop/src/renderer/index.tsx` | 068 | platform `pathExists` 接线到 `window.api.pathExists` |

### 搭车修复(构建脚本,fork-only)

| 文件 | 改动 |
|---|---|
| `packages/branding/scripts/build-media-gen-plugin.ps1` | 补时间戳跳过(原与 feishu 不对称、每次重建)+ `bun run --silent` 避免 PS5.1 把 bun banner stderr 误判 NativeCommandError 中断打包。惠及所有 Windows 构建。 |

## 回归测试

- opencode:`ignore-path`(8)/`project-rebind`(4)/`project.test`(37,含 064 自愈)/`project-worktree-rebind`(2)全绿;typecheck 0 错。
- app:`startup-precheck`(5)/`i18n parity`/`rebrand` 全绿;typecheck 0 错。
- desktop:`fs-probe`(3)+ 全量 91 pass(1 既有失败 = Windows 跑 Linux electron-builder 配置断言,与本版无关);typecheck 0 错。
- 既有 `httpapi-file` 的 "serves search endpoints" 503 失败 = 本机 workspace-routing 既有环境性失败(stash 改动后仍失败),非本版引入。

## 集成验证(2026-06-25,local 版 win-unpacked + CDP 9223)

- **集成构建绿**:`OPENCODE_CHANNEL=local bun run build`(electron-vite,`out/main`+`out/preload`+`out/renderer` 含 IPC/layout 改动)+ `electron-builder --dir` 出 `DeskFox 本地版.exe`(231MB)全 exit 0。
- **冷启动健康检查绿**(CDP 探):readyState complete / 主 UI 渲染(9 body children,4 chrome 标记)/ **0 error toast** / **0 JS 异常** → main/preload IPC + layout pre-check 改动不破坏启动。
- **REQ-068 `pathExists` IPC 全链路真机验证绿**:`window.api.pathExists` 函数贯通(preload→ipc→main→fs-probe);存在目录→`{ok:true}`;不存在→`{ok:false,reason:"missing",code:"ENOENT"}`;**未映射盘符 `Z:\`→ENOENT/missing**(实证坐实版本计划迁移发现 §④「盘符未映射」模态 = ENOENT → 归 missing 分类)。
- 验证用 local 第 4 档(`ai.deskfox.app.local` + `opencode-local.db` 数据隔离),全程不碰 user 运行中的正式版。

### 真机 QA 通过(2026-06-25,local 版,CDP + sidecar HTTP)

- **REQ-068 目录删/改名模态 端到端 ✅**:注入失效 lastProject(`D:/__req068_missing_default_project__`)入 electron store → 冷重载 → 弹 error toast **「项目目录不存在 "…" 已被删除、改名或移动,请重新选择项目目录。」**(i18n + 路径插值正确)、失效项目**未被打开**(URL 停根路径,无静默空白/无 500)、lastProject **被 forget 清空**(`{}`)→ 下次启动不再自动加载死路径。
- **REQ-061 改名重绑 端到端 ✅**(对运行中打包 sidecar HTTP):打开 git 项目 A(worktree=`req061_A`)→ 磁盘改名 A→B → 用 B 路径打开 → **同一 project id `6149b5c3`,worktree 重绑 `req061_A`→`req061_B`**(M5 三态:旧 worktree ENOENT 判 missing → 重绑),`/session` + `/file/list` 均 **200(非 500)**,git id 保留记录跟随。
- **REQ-061 UI 侧栏显示新名 端到端 ✅**(CDP 读真实渲染层 DOM):项目 A 在侧栏时显示名 `req061_A`(基线)→ 杀 app 释放 A → 磁盘改名 A→B → 改 electron store 指向 B → 重启 → 侧栏 `data-project` 解码=`D:/tmp/req061_B`、aria-label/文本节点=**`req061_B`(新名)**、**无残留 `req061_A` 旧名** —— 直接证「侧栏显示旧名」症状根治。

## 待办(交接 macOS 端,见 [`mac-qa-handoff.md`](./mac-qa-handoff.md) 精确步骤+验收)

> 2026-06-25 user 拍板:剩余 2 项 Windows 本机做不了(物理硬件 / mac-only),交接 mac 端 —— 代码已随分支上传,
> mac 端拉 `feat/stale-path-hardening` 打 local 版照 `mac-qa-handoff.md` 验,结果回填该文件。

- **待办 1**:REQ-067 **mac 大小写不敏感卷 500→200**(无 mac 验收机;纯字符串逻辑已平台无关单测全覆盖,差最后 HTTP 往返)。
- **待办 2**:REQ-068 unreachable 分支(盘掉线提示重连不清记录)+ REQ-061 盘 offline 不误重绑 —— 需**物理可插拔盘**(网络盘/U盘/外置盘),本 Win 机当下无;missing 分支 + UI 显示新名已端到端验通。

## R4 黑名单 override(本季第 2 笔,user 2026-06-25 审批)

`packages/opencode/` 是上游核心包,整目录黑名单。本版 8 个文件命中(3 改上游 + 1 改既有测试 + 4 fork-only 新文件被路径误伤)。`[override-blacklist: REQ-067/061/064 修的是 opencode 核心内部逻辑(file.ts list handler 内联 ignored 计算 / project.ts 重绑守卫 / update handler 自愈),崩点均在上游内部无 wrapper 注入点;核心逻辑已最大化抽到 fork-only 新文件,新文件因放 packages/opencode/ 目录被路径黑名单误伤]`

逐文件 wrapper 不可行性:

| 文件 | wrapper 为何不可行 |
|---|---|
| `handlers/file.ts` | 崩点是 list handler 内联表达式 `ignored: ignored.ignores(path.relative(...))`,无中间件/注入点;最小改 = 1 import + 换表达式为 `safeIgnores(ignoreRelativePath(...))`,核心逻辑全在 fork-only `ignore-path.ts` |
| `project/project.ts` | 改的是**已有 `// FORK: REQ-061/064` 块**内重绑守卫一行(`orElseSucceed(()=>false)`→`isWorktreeConfirmedMissing`),修该 fork 自身 M5 三态隐患;判定逻辑抽到 fork-only `project-rebind.ts` |
| `handlers/project.ts` | update handler 是 effect 链,`catchTag` 自愈无 wrapper 注入点 |
| `test/project/project.test.ts` | 既有迁移测试旁加 064 自愈集成用例 |
| `ignore-path.ts` / `project-rebind.ts` + 2 `.test.ts` | fork-only 新文件、0 上游逻辑,路径黑名单误伤(同 v2026.8.3 precedent);移出会造 opencode core → fork 包反向依赖,更糟 |

风险低:每处 ≤ 数行、纯增量、均带 FORK marker、可单独 `git revert`;20 单测 + 集成 + 回归 + 冷启动健康 + IPC 真机验证全绿。配额:本季第 2 笔(v2026.8.3 首笔),在 ≤2/季 上限内。

## 回退方法

`git revert` 各 commit;或删 4 个新文件 + 还原 12 个上游文件的 FORK 注入段。各 REQ 改动相互独立、可单独 revert。
