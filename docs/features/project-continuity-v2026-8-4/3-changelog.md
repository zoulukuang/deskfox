feat-id: project-continuity-v2026-8-4
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog 实际改动

> commit 后填 hash / 行数 / 影响范围 / 回归测试 / 回退方法。

## 改动清单(开发中,待补 hash)

### REQ-072 会话侧栏项目维度 ✅ 代码+测试完成(待 commit / R4 复核 / 真机 e2e)

**改动文件(7,全 typecheck 绿):**
- 后端 `packages/opencode/src/session/session.ts` — 抽 `export function gateProjectScope(input, {projectID, directory})` 纯函数(FORK-BEGIN/END)+ `list` 调用它(FORK 单行)。global 哨兵→降级 scope=undefined+回填 ctx.directory 守大杂烩;真实身份→原样按 project_id。**上游侵入压到 1 文件**(handler/listByProject 零改;scope=project plumbing 全上游原生 #24853/#25215/#30804)。**黑名单文件 → R4**。
- 前端 `packages/app/src/context/global-sync/session-load.ts` — 两处 `input.list({...})` 传 `scope:"project"`。
- 前端 `packages/app/src/context/global-sync/types.ts` — `RootLoadArgs.list` query 补 `scope?:"project"`。
- 前端 `packages/app/src/context/tabs.tsx` — `sessionHasOpenTab` 抽到 `tabs-dedup.ts` 并 re-export(FORK);删孤儿 `Session` 导入。
- 前端 **新文件** `packages/app/src/context/tabs-dedup.ts`(fork-only)— `sessionHasOpenTab` 改按 server+session.id 去重(去 `base64Encode(session.directory)`);全 `import type` 零 runtime 依赖(绕 tabs.tsx transitive @solidjs/router client-only,方可单测)。

**测试(全绿):**
- 后端 `test/session/gate-project-scope.test.ts`(新,6 pass)— TC-B1/B1b/B2/B3/B3b/B4 穷尽门控纯函数。
- 后端 `test/server/session-list.test.ts`(+1 集成,12 pass)— scope=project 真实身份跨目录返回(list→gate→listByProject wiring)。
- 前端 `src/context/server-sync.test.ts`(更新 2,8 pass)— TC-F1/F2 断言 scope=project 传参。
- 前端 `src/context/tabs.test.ts`(新,4 pass)— TC-T1/T2/T2b + draft 隔离。

**回归:** typecheck app+opencode 2/2 绿。**待:** R4 复核报告 + 真机 e2e(改名/挪位 × git/非git 四格 + 复制 + global 反例)。

### REQ-071 草稿再水合 ✅ 代码+自动化测试完成

**根因(CDP 实测定案)**:上游自带、至今未修的再水合时序 bug(merge-base `be227503af` vs `upstream/dev` 逐点核对上游未修)。切项目时 keyed `<Show>` 拆整棵子树 → `PromptProvider` 重挂 → 新 `PromptSession` 走 `makePersisted` 异步读盘水合 store,但编辑器 reconcile 效应初次跑在 ready resolve 前拿 DEFAULT(空),store 随后被水合成草稿时 **reconcile 效应没重跑** → 草稿不回填编辑器 DOM(冷启动同值却能灌回 → remount 特有的响应式失效)。CDP 实测**排除 read-race**、定案 **reconcile-fail**。

**改动(1 文件,fork-only 非黑名单,FORK marker)**:
- `packages/app/src/components/prompt-input.tsx:828` reconcile 效应依赖 `() => prompt.current()` → `() => (prompt.ready()(), prompt.current())`。把 ready 布尔纳入依赖 → ready false→true(水合完成)强制再 reconcile 一次用已水合 current 灌回,与冷启动路径统一。**不动 keyed 结构、不改持久化格式**。拟提 PR 回贡上游。

**自动化测试(fork-only,`packages/branding/smoke/`)**:
- `req071_draft_test.py` — 打开 A 键入草稿 → 切 B → 切回 A → 断言草稿仍在 → **✅ PASS**(修复前=空=BUG)。
- `req071_coldstart_check.py` — kill+relaunch 后开 A 断言草稿从盘读回 → **✅ PASS**(新依赖不回归冷启动)。
- `req072_wiring_check.py` — CDP Network 抓侧栏 `/session?roots` 请求带 `scope=project` → **✅ 4/4 PASS**(REQ-072 前端 wiring 实时验证)。
- `smoke.py` 全量渲染冒烟 → **✅ 全 PASS**(boot/providers/panels/settings,无回归)。

**构建**:全新 local 版 `OPENCODE_CHANNEL=local`(renderer 含 REQ-071 修 + sidecar 重建含 REQ-072 后端),产物 `dist-deskfox/mac-arm64/DeskFox 本地版.app`。

### REQ-072 真机验收暴露的两个更底层 bug + 修复(2026-07-05,user "深度复查+继续改")

真机测试(全新 local 版 CDP)发现 REQ-072 数据层虽对(单元/集成/wiring 已证),但**改名重开在 GUI 层不通**,根因两条(均非 REQ-072 session 维度引入,属 REQ-061/069 家族):

**根因1 · 非 git session 丢 = REQ-069 flag 没开** → **Fix1**:`packages/desktop/src/main/sidecar.ts` spawn env 注入 `OPENCODE_EXPERIMENTAL_NONGIT_IDENTITY=1`(用户显式设则尊重)。开启后 git+非git 项目打开都写 `.deskfox/id` 锚 → 非git 稳定身份、session 按 project_id 跟随。版本计划 D 决策。

**根因2 · git 改名"打不开" = 前端项目列表与后端两套真相源脱节** → **Fix2 锚扫描 relocate**(纯 fork-only/desktop-main + 前端,无后端端点/SDK 重生成):
- 后端 `packages/opencode/src/project/project.ts`(**黑名单 → R4**):加 `openDirMissing` 守卫 —— 目录确切 ENOENT 时**不 mint/writeAnchor**,根治 flag-on 后 childStoreManager bootstrap stale 条目会「重建已删文件夹」→ 掩盖 missing、relocate 失效、开空项目丢会话(自测实锤)。gate `shouldMint` + writeAnchor 于 `!openDirMissing`。
- desktop-main `fs-probe.ts`:新 `findRelocatedWithFs`/`findRelocatedProject` —— 扫 stale 路径**同父目录**兄弟读 `.deskfox/id` 锚匹配项目 id,返回改名后新位置。纯 fs、注入可测。经 `ipc.ts`/`preload`/`index.ts`/`renderer` 全链路 + `platform.tsx` 暴露。
- 前端 relocate 集成:`layout.tsx` `ensureProjectAvailable`/`tryRelocate`(autoselect 主路径)+ `navigateToProject`(项目切换,静默 relocate 不 forget/toast)+ `home.tsx` `openProject`(点击 stale 条目)。**id 来源 = 后端权威 `serverSync.data.project`**(worktree=旧路径、id=真实身份,与磁盘锚一致),回退持久化 `server.tsx` `StoredProject.id`(新增 `setId`/`relocate` + `layout.tsx` best-effort 回写 effect)。relocate 命中后就地把旧路径条目改新路径 + 更新 lastProject(消 stale「打不开」+ 反复 503)。

**测试(全绿):**
- 单元:`fs-probe.test.ts` +6(锚扫描:同父改名命中/git 同理/无匹配 null/id 空 null/跳过同名/readdir 出错 null)= 16 pass。
- 真机自动化(fork-only `packages/branding/smoke/`):`req072_relocate_selftest.py` **11/11**(flag→git+非git 稳定身份锚 / git 改名 autoselect relocate 开新路径 / 非git 同理 / stale 旧条目 relocate + lastProject 更新);`req072_git_minimal.py`(git/非git 各 3/3 隔离稳定);`req072_repro_driver.py`/`req072_console_debug.py`(根因诊断)。
- 回归:opencode 项目族 141 pass/1 skip + fs-probe 16 + app server-sync/tabs 12 + typecheck app/desktop/opencode 3/3。

**关键调试轨迹**(供复现):flaky 根因 = 测试同路径跨运行**陈旧 project 身份缓存**污染(前端曾用 `StoredProject.id` 脆弱 effect → 捕获到陈旧/错 id 与磁盘锚失配);改「后端权威 id + 唯一路径 hermetic」定论。

### 追加 · 切到缺失目录项目的冗余 503 toast 抑制(2026-07-05,user 反馈)

真机切项目时右下角每次弹「列出文件失败 · Server returned 503 with empty body: /file?directory=<缺失目录>」——切到目录已被删除/改名走(且无法 relocate)的项目时,后端为该缺失目录 boot 实例失败返 503 空 body。文件树已就地显「加载文件树失败 · 重试」占位,右下角再弹原始 503 toast = **冗余噪音**(每次切都弹)。
- **修**:`server-errors.ts` 新 `isUnservableDirError`(匹配 "returned 503 with empty body" 缺失目录签名,**非可重试**——目录真没了重试无用,独立于 `isRetryableListError`);在三处项目载入 toast 站点 suppress:`file.tsx` 文件树 onError、`bootstrap.ts` providers 重载(catch + slowErrs)、`server-sync.tsx` MCP 重载。占位保留、console 仍记录。真实业务 5xx(带具体信息)不命中、照常 surface。
- **测试**:`server-errors.test.ts` +5(503 空 body true / 纯字符串 / 真实 5xx false / 非可重试 / 空 null)= 19 pass;真机 `req072_toast_verify.py`(切目录已删项目 → 无 503 toast)✅;relocate 自测 11/11 无回归。全 **fork-only packages/app,非黑名单,0 R4**。

### 追加 · git 项目彻底改名后旧会话不可见 — session.directory 数据自愈(2026-07-05,user 真机复报;commit `234ae3acc3`)

**真机复报**:rtgit- 项目把名称彻底改掉再打开,看不到之前的 session。深度复查 ground truth(直打运行中 sidecar + CDP 查 DOM):后端身份保持(git-id 同行)、worktree 重绑成功、`scope=project` 查询**正确返回**该 session —— 但侧栏渲染 0 条 + 悬空「加载更多」。

**根因(渲染层孪生过滤)**:`packages/app/src/pages/layout/helpers.ts` `isRootVisibleSession` 按 `pathKey(session.directory) === pathKey(当前目录)` 精确匹配过滤;session 行的 `directory` 是改名前死路径 → 渲染被滤掉;改回原名才匹配「回来」。REQ-072 修了**查询层**的 directory 过滤,漏了**数据本身**(memory 预警的「同根因不同 path 必复发」实锤:消费点还有 latestRootSession/预览面板/首页最近会话等多处)。

**修法 = 数据单点自愈**(不碰渲染层各消费点,守「绝对单一」),两级 + 两个调用点:
- 纯逻辑 `project-rebind.ts`:`isUnderWorktree`(live 树内快路径,不触碰上游子目录语义)+ `prefixRebindTarget`(旧树→新树前缀映射,保子目录结构)。
- 编排 `src/project/session-dir-heal.ts`(**fork-only 新文件**):`healStaleSessionDirectories` —— ① 重绑时旧树下 directory 前缀重写(旧树已被三态判定确切不存在,免查盘)② 孤儿清扫:存量死目录(**确切 ENOENT**;检查出错/离线盘/U盘暂拔按三态**保守不动**)扁平到当前 live worktree。`confirmedMissing` 判定可注入(project.ts 传 `fs.exists` 三态,list 路径默认 node fs 实现,避免给 session 层加 fs layer 依赖)。幂等收敛。
- 调用点1 `project.ts` fromDirectory(实例 boot 主路径,携带 oldWorktree;global 项目不清扫——directory 维度正是其身份):**黑名单,归本 feat 同 1 笔 R4**(squash 变体;heal 需要 fromDirectory 内的 existingWorktreeMissing/existing.worktree/openDirMissing 编排态,与 REQ-069/072 override 同源不可外置;改动=1 个函数调用 + FORK 注释,逻辑全在 fork-only 文件)。
- 调用点2 `session.ts` `Session.list` scope=project 兜底(**黑名单,同上归并**;实测同一进程内实例被缓存时改名往返不再走 fromDirectory → 仅 boot 路径会漏;gated.scope==="project" 即非 global;收敛后成本 ≈ 一次 groupBy,live 树内目录快路径跳过;改动=2 行调用 + import)。

**测试(全绿)**:
- 纯函数:`project-rebind.test.ts` +2(D1 isUnderWorktree 含 Windows 分隔符/前缀相似不误伤;D2 prefixRebindTarget 根/子路径/不误伤)= 10 pass。
- 集成:`project-session-dir-heal.test.ts` 新文件 6 pass —— git 彻底改名前缀重写(根+子目录)/ 存量孤儿打开即自愈 / 保守不动(仍存在目录 + global 邻居不波及)/ 非git flag-on 跟随 / 改回原名往返 / heal 函数直测(注入判定,list 兜底契约)。
- 回归:project 组 130 pass 0 fail + session 组 383 tests 0 fail + typecheck 绿。
- **真机(local 版 CDP + sidecar 直查)**:① 用户实际受害 session「开源ASR模型推荐」(`ses_0ce4a4778f`,directory 指向已死的 `rtgit-1783244530-renamed`)→ 重建后打开 `rtgit-标题彻底改掉` **侧栏可见** + DB directory 已愈合;② 全流程脚本(新建 git 项目+API 建 session→彻底改中文名→重开):身份同行 + worktree 重绑 + directory 重写 + scope=project 可见;③ 同一运行内改名往返(实例缓存场景,list 兜底)。

**边界(记录)**:跨卷工作区目录被拔盘时若 OS 返回 ENOENT(挂载点整个消失),session 会被扁平到主 worktree(可见可用,但不再归属拔掉的卷)——三态判定对 EACCES/超时类检查出错已保守不动;此为「可见性 > 卷归属」的取舍,REQ-070 U 盘 QA 时留意。

### 追加 · 复制项目独立展示 + 共享会话可见(2026-07-05,user 真机复报三段)

**真机复报(三段递进)**:① 目录 A 复制为 B,在 DeskFox 打开 B **整体跳回 A**(位置被抢走);② 修跳转后 B **停在 B** 但侧栏**看不到与 A 共享的 session**;③ 复报确认「B 的 session 应与 A 共享,只是位置留在 B」。

**根因(两层,身份共享正确、展示层双漏)**:
- 后端契约本正确:副本与原件同锚(非git)/ 同 git 首 commit → `fromDirectory(B)` resolve 到**同 project_id**,`scope=project` 查询正确返回原件会话。**问题不在数据/查询层**。
- **漏点1(跳回 A)** `project.ts`:上游把 `effectiveDir ≠ 行 worktree` 的目录一律登记进 `sandboxes` → 前端 reconciler 按 sandbox→root 折叠掉 B 条目 → 整体跳回 A。
- **漏点2(共享会话不可见)** `sidebar-workspace.tsx`:`LocalWorkspace`(非 workspace 模式渲染,副本走这条)自算 `sortedRootSessions(child(worktree))`,`roots` 按 `session.directory === 当前目录` 精确过滤;副本 store 里共享会话的 directory 指向**原件**,被全部滤掉 → 侧栏 0 条。**前一轮把 orphan 逻辑接进了 `currentSessions`(仅喂键盘导航 navList),没接进真正的可见列表** → 症状未消。

**修法**:
- 后端 `packages/opencode/src/project/project.ts`(**黑名单,归本 feat 同 1 笔 R4 squash 变体**):判「独立根」——git → `effectiveDir/.git/HEAD` 真实可达(链接 git worktree 的 `.git` 是文件,不命中 → 保持上游折叠不回归);非 git → 锚在目录内恒独立。独立根**不登记 sandbox** 且**清掉旧版误登记**(历史污染自愈)。不走 `FSUtil.resolve`(realpathSync 对「.git 是文件」的穿透路径抛 ENOTDIR),直接拼路径 + Effect 错误通道兜为 false。
- 前端 `packages/app/src/pages/layout/helpers.ts`(**fork-only 非黑名单**):新 `projectForDirectory`(自身 worktree 条目**优先于** sandbox 归属,副本目录留在自己)+ `orphanRootSessions`(认领可见分节都认领不了的项目会话)+ `projectForSession` 复用。
- 前端 `packages/app/src/pages/layout.tsx`:`currentProject`/`projectRoot`/折叠 reconciler/`currentSessions` 五站点统一走 `projectForDirectory`;`currentSessions` 补 `orphanRootSessions`(键盘导航一致)。
- 前端 `packages/app/src/pages/layout/sidebar-workspace.tsx`(**本轮关键修复**):`LocalWorkspace.sessions` 补 `orphanRootSessions(store, [worktree])` —— 副本目录 store 经 scope=project 持有的共享会话(directory=原件)被 `sortedRootSessions` 滤掉,补 orphan 认领后**副本/原件双向共享会话都可见**。

**测试(全绿)**:
- 单元 `helpers.test.ts`:`projectForDirectory` 5 例(自身优先/sandbox 兜底/原件不受影响/未命中/projectForSession 兜底)+ `orphanRootSessions` 3 例(共享认领/不重复/子会话+归档排除)= app 包 **488 pass 0 fail**;typecheck 绿。
- 集成 `project-copy-standalone.test.ts`(**新文件**,fork-only 测试)4 例:git 副本同身份不登记 sandbox / 历史污染打开即自愈 / 非git 锚副本同 id 不登记 / 链接 git worktree 仍登记(上游折叠不回归)。
- **真机 e2e(local 版 CDP,读侧栏实际渲染 [data-session-id])** `req072_copy_share_e2e.py`:① 非git 副本 `W-标题也改了_副本` 显示原件 R 的 2 条(当前模型查询/天津中考出分时间)② git 副本 `W-标题彻底改掉_副本` 显示原件 S 的 1 条(开源ASR模型推荐)③ 原件 R 不回归 ④ 原件 S 不回归 —— **4/4 PASS**;`req072_copy_stay_check.py`:打开副本 `data-project` = 副本 worktree、原件不在列 → **停在副本不跳回 PASS**。

### 追加 · REQ-070 物理盘 QA 实测抓出 macOS 外置盘误 forget bug + 修复(2026-07-06,真机 U 盘)

**QA 实测发现(不是推断)**:在真实外置盘 `/Volumes/WININSTALL`(ExFAT,一 git `UvxyOptionPrice` + 一非 git `养老`)上 `diskutil unmount force`(= 模拟拔盘),直调生产 `probePath` 实测:**卸载后两项目都被判 `missing`(→ forget 遗忘)**,而正确应为 `unreachable`(→ 保留 lastProject、提示重连)。

**根因(平台差异,REQ-068 v2 的 mac 盲区)**:`fs-probe.ts` v2「根可达性」判据默认用 `path.parse(target).root`。Windows 上 `D:\项目` 的 root=`D:\`,拔盘后探根失败 → 正确 `unreachable`;但 **macOS 上 `/Volumes/WININSTALL/养老` 的 `path.parse().root` 恒为 `/`(文件系统根,永远可达)** → 探根必 ok → ENOENT 无条件归 `missing` → **拔 U 盘后合法项目被永久遗忘**(从最近列表消失)。mac 外置/网络盘挂在 `/Volumes/<name>`,拔盘后消失的是这个挂载点,不是 `/`。

**修法**(`packages/desktop/src/main/fs-probe.ts`,**fork-only 非黑名单,0 R4**):新增 `mountRootOf(target)` —— darwin 下 `/Volumes/<name>/…` 取挂载点 `/Volumes/<name>`(拔盘随卷消失 → 探它不可达 → 正确 `unreachable`);Windows/其它路径回落 `path.parse().root`,行为完全不变(regex 不匹配非 `/Volumes` 路径 + 仅 darwin 生效)。`probeWithStat` 默认 `rootOf` 由 `path.parse().root` 换成 `mountRootOf`。

**测试(全绿)**:
- 单元 `fs-probe.test.ts` 20 pass:新增 A2e(mac 外置盘卸载 ENOENT+挂载点 ENOENT → unreachable,bug-repro)/ A2f(盘在线目录被删 ENOENT+挂载点 ok → missing)+ `mountRootOf` darwin 门控直测(`/Volumes/<盘>/子` → 挂载点、系统盘 → `/`)。既有 Windows/UNC 分类断言不回归。
- **真机(local 版,真实 U 盘 `/Volumes/WININSTALL`)**:
  - `req070_probe_truth.ts` 直调生产 `probePath`:修前两项目 `missing` ❌ → 修后 `unreachable`+`code:ENOENT` ✅。
  - `req070_offline_app_e2e.py`(卸载→冷启动→重挂全流程):**2a** lastProject 不被清(仍=养老)✅ / projects.local 保留两个外置项目 ✅ / **2b** git worktree 不被误重绑 ✅ / 重挂后恢复正常 ✅。
  - `req070_toast_poll.py`(轮询捕捉,toast 会自动淡出):unreachable 引导 toast「项目磁盘暂不可达」出现 ✅。
- errno:probe 结果携带 `code:"ENOENT"`(bun 实测证),供诊断;probe 在 desktop-main 进程,不写 sidecar log。

**边界**:仅覆盖 macOS `/Volumes/<name>` 挂载约定(U盘/移动盘/网络盘的常规挂载点);Linux `/media`、`/mnt` 未特化(项目主力 mac+win,回落 path 根行为),需要时再补。

### REQ-070 物理盘 QA(原始 2a/2b handoff)

## R4 override 复核报告(session.ts,commit 前待 user 审)

**触动黑名单文件**:`packages/opencode/src/session/session.ts`(pre-commit 路径黑名单覆盖整个 `packages/opencode/`)。**1 笔 commit / 1 个黑名单文件**。

### ① wrapper 不可行论证
- REQ-072 门控 = 「按项目身份(project_id vs global 哨兵)决定 session 查询维度」,是 `Session.list` 的**查询语义内核**,发生在 `listByProject` 组装 SQL conditions 的那一步。
- 判据 `ctx.project.id === ProjectV2.ID.global` 依赖 `InstanceState.context`,该 context **只在 opencode 实例运行时**(Effect layer 内)可得;handler 层(`handlers/session.ts`)拿到的是**未 resolve** 的 HTTP query,`projectID` 尚未从 directory 解析出来 → **门控无法上移到 handler,更无法在 fork-only 外部文件 wrapper**。
- 已把上游侵入**压到极致**:门控逻辑抽成 fork-only 纯函数思路本可外置,但它必须在 `list` 内被调用(需 ctx),故 `list` 的 1 行调用 + 纯函数定义都留在 `session.ts`;`handlers/session.ts`、`listByProject`、HTTP schema **全部零改**(scope=project 的 plumbing 是上游原生)。R1 三级跳走到第 3 级但改动面最小(1 文件、+21 行含注释、FORK-BEGIN/END 包裹)。

### ② 风险评估
- **blast radius 受控**:`gateProjectScope` 只在 `input.scope==="project"` 时改变行为;不传 scope 的**所有既有 caller 零影响**(TC-B3 专验)。前端仅 sidebar 显式传 scope=project。
- **global 反例守住**:global 哨兵强制降级 directory 过滤(TC-B2/B4),不会退化成「全局大杂烩」。
- **回归覆盖**:纯函数 6 单测穷尽分支 + 1 集成测试证 list→gate→listByProject wiring + 既有 session-list 11 测试全绿(directory/path/workspace/roots/start 维度无回归)。
- **可逆**:纯 FORK-BEGIN/END 包裹 + 单行调用,`git revert` 或删分支即回退;不改持久化格式/DB schema/HTTP 契约。

### ③ 改动日志逐文件论证
- `session.ts`:唯一黑名单触动,论证同上。前端 4 文件(session-load/types/tabs/tabs-dedup)+ 4 测试文件均 **fork-only 或非黑名单**,不计入 R4。

**配额**:本 feat 计 **1 笔 R4**(季度 ≤2 基线内)。走 R4 squash 变体:feat 分支逐单元 commit 带 `[override-blacklist]` 标,合 main 前 squash,配额按 squash 后 1 笔记。

### R4 补充(真机修复,project.ts 重建守卫,2026-07-05)

**新增触动黑名单文件**:`packages/opencode/src/project/project.ts`(REQ-072 真机修复的 `openDirMissing` 守卫)。仍归**本 feat 同 1 笔 R4**(squash 变体,与 session.ts 同版合并计 1 笔)。
- **wrapper 不可行论证**:守卫作用于 `fromDirectory` 的 mint/writeAnchor 判定(REQ-069 锚铸造编排),内在于「显式打开项目」编排点,与 REQ-069 override 同源不可外置(见 REQ-069 R4 论证)。改动 = 早期 1 行 `fs.exists` 探测 + `shouldMint`/writeAnchor 两处 `&& !openDirMissing` 门控,FORK marker。
- **风险**:低。只在**目录确切 ENOENT**时改变行为(不 mint/不写锚 → 不重建已删文件夹);正常打开、离线盘保守当存在均不受影响(复用 `isWorktreeConfirmedMissing` 三态判定)。REQ-069 项目族 141 测试无回归。
- **必要性**:flag-on(Fix1)后若无此守卫,bootstrap stale 条目会重建已删文件夹 → relocate 失效 + 开空项目丢会话(真机自测实锤);属「安全放开 flag」的必配守卫。

### R4 补充(复制项目独立展示,project.ts sandbox 登记,2026-07-05)

**触动黑名单文件**:`packages/opencode/src/project/project.ts`(REQ-072 复制独立展示的 sandbox 登记逻辑)。仍归**本 feat 同 1 笔 R4**(squash 变体,与 session.ts / project.ts openDirMissing 守卫同版合并计 1 笔)。
- **wrapper 不可行论证**:sandbox 登记发生在 `fromDirectory` 组装 `result.sandboxes` 的那一步(拿到 `effectiveDir`/`result.worktree`/`data.vcs` 的实例编排态);「是否登记为 sandbox」是 project 身份解析的**内核语义**,决定前端 sandbox→root 折叠。判据需 `effectiveDir` 与行 worktree 的关系 + git/非git 独立根判定,全部只在 `fromDirectory` Effect 内可得 → **无法外置到 fork-only wrapper**。改动 = 替换上游 4 行 push 逻辑为 FORK-BEGIN/END 块(独立根判定 + 不登记/清污染 + 保留上游链接 worktree 折叠),FORK marker 包裹。
- **风险**:低。只在 `effectiveDir ≠ 行 worktree`(即打开的不是主位置,复制/链接场景)时改变行为;正常打开原件(effectiveDir === worktree)零影响。独立根判定对「.git 是文件」的链接 git worktree **不命中** → 上游折叠行为不回归(TC 专验)。存在性检查错误(ENOTDIR 等)由 Effect 错误通道兜为 false = 保守走上游行为。可逆(FORK-BEGIN/END + `git revert`)。
- **必要性**:不修则复制目录打开整体跳回原件(真机实锤),REQ-072「复制项目独立展示」不变量不成立。

## 回归测试(R9 合 main 前最终验收,2026-07-06 全绿)

**单元 / typecheck**:
- typecheck 22/22(fork 全范围,排 console)。
- app 488 pass 0 fail(含 helpers projectForDirectory/orphanRootSessions/tabs-dedup)。
- desktop 109 pass 0 fail(含 fs-probe 20:REQ-070 mountRootOf + A2e/A2f bug-repro)。
- opencode project 136 pass(1 skip)0 fail、session 383 pass(1 todo)0 fail。
- fork backstop:media-gen 140 pass、adapter-feishu-lark 740 pass,0 fail。

**真机 e2e(local 版 CDP + 真实外置盘)**:
- REQ-072 复制副本共享会话 4/4 PASS + 停在副本不跳回 PASS + 改名自愈 + 切缺失目录无 503 toast。
- REQ-072 会话隔离 A1/A2 PASS(普通项目无回归 + 不泄漏 global/跨项目)。
- REQ-071 草稿:切项目往返(user 真机)+ 冷启动草稿不丢(自动)PASS。
- REQ-070 物理盘(真实 U 盘 `/Volumes/WININSTALL` diskutil unmount):probe missing→unreachable、冷启动 lastProject 不清 + projects 保留 + unreachable toast、git worktree 不误重绑、重挂恢复 —— 全 PASS。

## 回退方法

- feat 分支合 main 走 **squash-merge**(整版 1 笔),`git revert <squash-commit>` 即整体回退;或 merge 前直接弃 feat 分支。
- 分模块回退指引(供 revert 后精准重做):REQ-070 修复独立在 `packages/desktop/src/main/fs-probe.ts`(删 `mountRootOf` + `rootOf` 默认改回 `path.parse().root` 即回退,不影响 REQ-071/072);REQ-072 前端展示层在 `packages/app/src/pages/layout/{helpers,sidebar-workspace,layout}`,后端身份在 `project.ts`/`session.ts` FORK-BEGIN/END 块;REQ-071 在 `prompt-input.tsx` 单点。各 FORK marker 包裹,可定位单独还原。

## 状态

R9 最终验收全绿(2026-07-06),feat 分支就绪、未 push、未合 main。等 user 点头走 squash-merge → main。
