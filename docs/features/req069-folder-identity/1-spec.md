feat-id: req069-folder-identity
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-069 非 git 文件夹稳定项目身份(v2026.6.25,Large)

> 需求权威源:OPENCODE-PLAN `需求池/非git文件夹项目稳定身份.md`(ADR,2026-07-04 修订版:复制对齐 git、M7 作废)+ `版本计划/v2026.6.25.md`。
> 本 spec 由 phase1 拆解工单 rev2(`OPENCODE-PLAN/scripts/workflows/v2026.6.25-breakdown-rev2.json`,22 争议 5 blocker 已裁决)转写,是 R8 动工前审签文档。**user 审签后锁版,只补不改。**

## 一、需求(一句话)

给非 git 的普通文件夹放隐藏锚文件 `<dir>/.deskfox/id`,使其改名/挪位后仍被识别为同一项目(现状:无 `.git` 的文件夹身份一律 `global`,一改名会话历史即失联)。

## 二、范围

**IN SCOPE**
- 锚文件读写:resolve 纯读,写锚统一走 fork-only 新模块 `anchor.ts`,由 `fromDirectory` 编排
- 连续性令牌,身份优先级全序:`remote > .git/opencode > 锚id > root`
- 复制行为对齐 git:副本共享身份,**不做副本检测**(M7 已作废)
- M6 锚丢失软恢复:mint 前反查 `ProjectDirectoryTable`,命中沿用 id + 重写锚
- M8 灰度:feature flag 默认关;锚存在时 resolve 返回真实目录(非盘根)
- git 项目防污染:`.git/info/exclude` 追加 `.deskfox/`
- 阶段一仅 macOS 平台无关核心;平台差异项(隐藏属性/只读卷)留薄层接口

**OUT SCOPE**
- v2026.6.21 stale hotfix 批(REQ-061/064/067/068)、跨机带历史、Windows 差异项实现(阶段二)、副本检测/M7、M4/M5 新三态分支、`ProjectV2.commit` 签名改动(rev2 裁决弃用)

## 三、架构选型(R1 三级跳论证)

| 单元 | 级别 | 论证 |
|---|---|---|
| U1/U2 `anchor.ts` | Level 1(纯新文件) | 锚契约常量 + 读写 + 平台 stub 全部 fork-only;但落在 `packages/core`(黑名单包),纯新增也触发 R4,见 §六 |
| U6 flag 注册 | Level 2(≤5 行注入) | RuntimeFlags 集中式 Service,flag 注册无法外置;1 行定义 + 单点 FORK marker |
| U3 `core/project.ts` resolve | Level 3(深改,已论证) | 身份优先级链是 resolve 内在职责,无法外置;读锚主体委托 anchor.ts,resolve 内仅加读锚调用 + 两分支 + 全序;FORK-BEGIN/END |
| U4/U5 `opencode/project/project.ts` fromDirectory | Level 3(深改,已论证) | fromDirectory 是唯一「显式打开项目」编排点(migrate/DB 持久化在此层),铸造触发与 flag 门控必须在此;session.ts/move-session.ts 等 resolve 直接调用方**不得**触发铸造;FORK-BEGIN/END |

**rev2 五项关键裁决**(细节与理由见 2-plan 决策轨迹):
1. `ProjectV2.commit` 签名零改动,写锚全走 anchor.ts 由 fromDirectory 编排(resolve 纯读、显式打开才写)
2. 真实目录修复**绑定锚存在**:无锚路径与现状 bit-identical(三个非 fromDirectory 调用方存量零行为变化)
3. flag 门控收口 U4 编排层,core 不下沉 RuntimeFlags
4. U2/U3/U6 fileScope 互不相交(hideAnchorDir 并入 U1)
5. M8 析出行建行即真实 worktree(`worktree = data.directory`),不依赖盘根重绑机制

**磁盘契约(R3 收口,发布后不可改)**:`ANCHOR_DIR=".deskfox"`、`ANCHOR_FILE="id"` 单点常量导出,别处不散写字符串。

## 四、单元分解(6 单元,依赖序)

| 单元 | 标题 | fileScope | deps | 难度 |
|---|---|---|---|---|
| U1 | 锚契约常量 + 纯读 + 平台 stub | core `project/anchor.ts`(新)+ 测试 | — | 低 |
| U2 | 锚写侧 writeAnchor + info/exclude 防污染 | 同 U1 文件 | U1 | 低 |
| U3 | resolve 读锚 + previous 全序 | core `project.ts` + 测试 | U1 | **高** |
| U6 | M8 灰度 flag 注册(默认关) | opencode `runtime-flags.ts` + 测试 | — | 低 |
| U4 | fromDirectory 编排:门控/铸锚/两路写锚/副本预期 | opencode `project/project.ts` + 测试 | U2,U3,U6 | **高** |
| U5 | M8 存量析出回归 + M6 软恢复 | 同 U4 包 + 2 测试文件 | U4 | **高** |

完整 acceptance 逐条见工单 rev2 JSON(权威),本 spec 不复制全文。

## 五、R8 测试用例清单(动工前钉死,逐条可勾选)

> 层级:**unit** = 纯逻辑单测(Logic 清单,行覆盖 ≥80%);**integ** = 服务端集成测(真 tmpdir + 真 git 二进制,core/opencode 现有 harness 惯例)。本 feat 无渲染层改动,不适用 View 清单 L2 e2e。

**U1 `core/test/project-anchor.test.ts`(unit)**
- [ ] T1 readAnchor 有锚 → 返回锚 id
- [ ] T2 readAnchor 文件不存在 → undefined,不抛错
- [ ] T3 readAnchor 空内容 → undefined
- [ ] T4 readAnchor 读失败(权限)→ undefined,不抛错、不写盘
- [ ] T5 mintId 纯函数,形态符合现有项目 id 惯例
- [ ] T6 hideAnchorDir macOS no-op(平台薄层签名占位)

**U2 同文件扩展(unit + 1 条 integ)**
- [ ] T7 writeAnchor 成功写 `<dir>/.deskfox/id`
- [ ] T8 writeAnchor 只读/权限失败 → 降级不抛错
- [ ] T9 writeAnchor 覆盖已有锚
- [ ] T10 appendToInfoExclude 追加条目
- [ ] T11 appendToInfoExclude 幂等(已含不重复追加)
- [ ] T12 exclude 文件缺失时创建
- [ ] T13 追加失败 → 降级不抛错
- [ ] T14 (integ) 真 git init → writeAnchor + appendToInfoExclude → `git status --porcelain` 不出现 `.deskfox`

**U3 `core/test/project.test.ts`(integ)**
- [ ] T15 **回归**:现有「returns global for non-git directory」盘根断言**原样通过,不改断言**(无锚 bit-identical 的回归证明)
- [ ] T16 非 git 有锚 → id=锚id、previous=锚id、directory=真实打开目录
- [ ] T17 git 无 remote 无 cached 有锚 → id=锚id
- [ ] T18 cached(`.git/opencode`)与锚不一致 → cached 优先(钉死3)
- [ ] T19 git init 未 commit 有锚 → 不掉 global
- [ ] T20 有 remote 有锚 → remote 胜出

**U6 `opencode/test/project/project-nongit-flag.test.ts`(unit)**
- [ ] T21 flag 默认关
- [ ] T22 env `OPENCODE_EXPERIMENTAL_NONGIT_IDENTITY` 开
- [ ] T23 RuntimeFlags.layer override 可在测试中显式注入开/关

**U4 `opencode/test/project/project-nongit-identity.test.ts`(integ,复用 migrate-global/worktree-rebind harness)**
- [ ] T24 flag 关 + 磁盘已有锚 → 项目仍按 global 打开(忽略锚,不写锚不铸 id)
- [ ] T25 flag 开 + 无锚非 git 首开 → mint + 建行 `worktree=真实目录` + 写锚落盘
- [ ] T26 git init 未 commit 目录(`data.vcs` 有值)绝不触发 mint
- [ ] T27 副本:同锚 id 共享 session;worktree 保持首开路径不重绑;副本路径进 sandboxes(与 git 双 clone 一致,三者具体断言)
- [ ] T28 改名/挪位:锚 id 不变 → 命中既有行 → REQ-061 三态重绑 → worktree 跟随新路径
- [ ] T29 非 git → git init+commit:同项目身份连续
- [ ] T30 git → 删 `.git`:同项目身份连续
- [ ] T31 git 项目打开(flag 开)→ `.deskfox/id` 存在、内容=id、`git status --porcelain` 干净

**U5 `project-global-carveout.test.ts` + `project-anchor-recovery.test.ts`(integ)**
- [ ] T32 M8 析出:seed 存量 global session → flag 开首开 → session 自动重挂新 id(经现有 `:347-354` UPDATE)+ worktree=真实目录 + saveProjectDirectory 落行;**其他目录的 global session 不受影响**
- [ ] T33 global 行保留:析出后 global project 行仍在(migrateProjectId `oldID===global` 守卫)
- [ ] T34 flag 往返三段:开(析出)→ 关(按 global 打开,已迁 session 不回迁=历史暂不可见)→ 再开(锚 id 生效,历史回来);三段各断言 project id 与 session 归属
- [ ] T35 M6 删锚重开 → 反查 ProjectDirectoryTable 命中 → 沿用原 id + 重写锚 + 恢复日志;session 不失联
- [ ] T36 M6 反查未命中 → 正常 mint 新 id

**运行时·native 风险点(R8 显式列,对照「CDP 自测 ≠ 真桌面 QA」)**
- 集成测依赖真 git 二进制 + 真实 tmpdir 磁盘 IO(信封已允许测试调 git)
- 只读卷/权限降级用 chmod 模拟;真·离线外置卷/受控目录的 native 行为发布前真桌面抽验
- `.deskfox` 点目录 Finder 天然隐藏,macOS 无需 native 验;Windows `attrib +h` 属阶段二
- 无渲染层改动,合 main 前跑 fork 范围 typecheck + 三包单测(pre-push 对齐);发版前建议真桌面冷启动 smoke

## 六、治理与验收门

- **R4 黑名单**:全部单元命中 `packages/core` + `packages/opencode`(含纯新增测试文件,REQ-048 教训)。执行 **R4 squash 配额变体**(2026-07-04 user 拍板):feat 分支内逐单元 commit、每笔带 `[override-blacklist: <理由>] [feat: req069-folder-identity]` 标;合 main 前 squash 成 1-2 笔 + 主控出 R4 复核报告(wrapper 不可行性/风险/论证)交 user 审;配额按 squash 后笔数记。
- **R2**:改上游处 FORK/FORK-BEGIN-END marker;fork-only 新文件加 `// FORK-ONLY:` 文件头。
- **R9 验收闸**:全部 T1-T36 + 存量测试(core/opencode 相关组)全绿 + fork 范围 typecheck,问题分支内解决干净,才向 user 提 merge。
- **分支**:`feat/v2026.6.25-folder-identity`(已基于最新 main 建出);铁律②③照守。

## 七、验收标准(用户视角六场景,flag 开启下)

1. 非 git 文件夹改名/挪位 → 会话历史跟随,不失联
2. 复制文件夹 → 副本与原文件夹共享同一项目身份(对齐 git clone 语义)
3. 非 git → `git init` + commit → 同一项目连续
4. git → 删 `.git` → 同一项目连续
5. 删除 `.deskfox/id` 后重开 → 软恢复沿用原身份,历史不失联
6. flag 关闭(默认)→ 一切行为与现状完全一致

---
**审签记录**:2026-07-04 user 审签通过(连同 phase2 额度报备一并确认),spec 锁版,进入实施。
