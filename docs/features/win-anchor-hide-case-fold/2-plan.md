feat-id: win-anchor-hide-case-fold
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 决策轨迹

### D1 — 缺口1 隐藏逻辑收在 writeAnchor 内,不碰 project.ts
- **背景**:`.deskfox` 唯一在 `project.ts:476` `writeAnchor(effectiveDir, projectID)` 一处建(git/非 git 共用)。
- **选择**:把 `hideAnchorDir` 调用放进 `writeAnchor`(anchor.ts,fork-only)本体,写成功后触发。
- **理由**:① 单点收口——所有建锚路径自动隐藏,无遗漏;② `project.ts` 在 `packages/opencode`(黑名单),
  收在 anchor.ts 内则**只触 1 个黑名单文件**(core/anchor.ts),避免第二笔 opencode 侵入;③ writeAnchor
  改为「写成功→隐藏」需知道写是否成功 → 把原 `Effect.ignore` 改成 `Effect.as(true)/orElseSucceed(false)`
  捕获成功布尔,顺带精确化降级(写失败不试图隐藏不存在的锚)。

### D2 — 隐藏执行器 + 平台判定双注入,按路径「形态」而非运行时 OS
- `hideAnchorDir(dir, { platform?, setHidden? })`:平台与 attrib 执行器均可注入。
- **理由**:`process.platform` 在 bun 测试里难 mock;注入让 TC-H1/H2/H3 跨平台稳定跑(darwin/win32 都能在
  任一 CI 验证),生产默认 `process.platform` + 真实 `attrib +h`。
- 降级哲学延续 fork 既有:attrib 不存在/权限/受控目录 → 静默 resolve,绝不抛错阻塞写锚。

### D3 — 缺口2 不动上游 pathKey,新建 same-directory helper
- **关键发现**:`pathKey` 输出经 `sdkFor(directory) → createClient({ directory })` **作为真实目录发后端**
  (server-sync.tsx `agents/mcp/lsp/providers` 查询)。在 pathKey 里小写化会改**线上协议**,blast radius 大。
- **选择**:新 fork-only `same-directory.ts`,复用 pathKey 归一后按「Windows 风格(盘符/UNC)折叠小写、
  POSIX 不折叠」做**纯本地身份匹配**;上游 pathKey 一字不改。
- **理由**:① 只影响本地持久化匹配,不碰后端契约;② POSIX 不折叠 = Mac/Linux 与裸 pathKey bit-identical,
  零回归;③ 按路径形态判定而非运行时 OS → Win 风格路径无论在哪比较都大小写不敏感,单测跨平台稳定。

### D4 — server.tsx 整个持久化匹配层统一折叠,而非只改 relocate
- **背景**:`createServerProjects` 工厂的 open/close/expand/collapse/move/forget/setId/relocate 全用
  `project.worktree === directory` 比对持久化条目。
- **选择**:全部换 `sameDirectory`,而非只改 relocate/setId。
- **理由**:避免「open() 用 === 判不等加了重复条目、relocate() 用折叠又当同一个去重」的自相矛盾;
  POSIX 零回归让全量替换安全。
- **边缘 bug 修正**:relocate 折叠后,纯大小写改名(`D:\Foo`→`D:\foo`)会让旧条目自己命中「新路径已存在」
  分支被误删 → 改按 **index** 判定(新条目须为不同的另一条 `newIndex !== index`)才走去重,否则原地更新。

### D5 — 顺手修 Mac 同事 2 个 Windows-不可移植测试
- **背景**:`project-anchor.test.ts` 里 2 个既有测试用 `chmod 0o000/0o555` 模拟读/写失败,Windows 上
  chmod 对目录/读权限是 no-op → 写/读照样成功 → 测试在 Win **假失败**(合并批带进来的既有 Win 红)。
- **选择**:改用跨平台可移植的失败注入 —— 读失败用「id 路径是目录」(EISDIR)、写失败用「父路径是文件」
  (ENOTDIR),行为断言完全不变。
- **理由**:本 feat 目标即「确保 Win 下 OK」,留着已知 Win 红测试与目标矛盾且修法极廉;TC-H4 亦用同法。

## 落点清单(实际改动文件)
- `packages/core/src/project/anchor.ts`(黑名单,R4):hideAnchorDir win32 实现 + writeAnchor 接入 + 成功布尔捕获
- `packages/core/test/project-anchor.test.ts`(黑名单,R4):TC-H1~H4 + 2 个既有测试可移植化
- `packages/app/src/utils/same-directory.ts`(新,fork-only):sameDirectory / sameDirectoryKey
- `packages/app/src/utils/same-directory.test.ts`(新):TC-C1~C5 + 回归
- `packages/app/src/context/server.tsx`:持久化匹配层统一 sameDirectory + relocate index 修正
- `packages/app/src/context/server.test.ts`:TC-R1/R1b/R2/R3 + POSIX 回归
- `packages/app/src/pages/home.tsx` / `layout.tsx`:relocate 取 id 处 sameDirectory

## 待办
- 缺口3(UNC/映射网络盘 `mountRootOf` Win 加固)→ backlog(边缘场景)
- Windows 真桌面 QA(合并前人工,见 1-spec 验收门槛)
