feat-id: req069-folder-identity
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-069 非 git 文件夹稳定项目身份 — 实际改动

> 状态:feat 分支验收全绿,待 user 批准合 main + push(铁律②③)。合 main 后回填 merge hash 并改 status: done。

## commit 列表(feat/v2026.6.25-folder-identity)

| commit | 内容 |
|---|---|
| `c82ece01e3` | docs:1-spec 审签稿 + 2-plan 决策轨迹 + INDEX 登记 |
| `a3dbc84d65` | docs:1-spec user 审签 → in-progress |
| `75ca4f573d` | **代码主体(R4 squash 后单笔,配额记 1 笔)**:U1-U6 六单元,原逐单元 commit 见该 commit message(备份指针 `req069-presquash-backup`,合 main 后删) |
| (本笔) | docs:3-changelog + 改动日志索引 + R4 逐文件论证 |

## 改动明细(+1409 −14,10 文件)

**fork-only 新文件(6 个,~1282 行)**
- `packages/core/src/project/anchor.ts`(115 行)— 锚契约核心:`ANCHOR_DIR=".deskfox"`/`ANCHOR_FILE="id"` 常量单点收口(R3,发布后不可改)、`readAnchor`(纯读,四态容错)、`mintId`、`writeAnchor`(失败降级)、`appendToInfoExclude`(幂等)、`hideAnchorDir` 平台薄层 stub(Windows 阶段二)
- `packages/core/test/project-anchor.test.ts`(360 行,T1-T14)
- `packages/opencode/test/project/project-nongit-flag.test.ts`(61 行,T21-T23)
- `packages/opencode/test/project/project-nongit-identity.test.ts`(263 行,T24-T31)
- `packages/opencode/test/project/project-global-carveout.test.ts`(237 行,T32-T34)
- `packages/opencode/test/project/project-anchor-recovery.test.ts`(155 行,T35-T36)

**上游文件注入(3 个,~127 行,全部 FORK marker)**
- `packages/core/src/project.ts`(+25 −14)— resolve `!repo` 分支读锚:有锚返锚id+真实目录,**无锚 bit-identical 现状**(三个非 fromDirectory 调用方存量零行为变化);git 分支 previous 全序 `remote > .git/opencode > 锚id > root`
- `packages/opencode/src/project/project.ts`(+100)— fromDirectory 编排:flag 门控(关=强制 global)、铸锚判定(flag开 && !vcs && global)、M6 mint 前反查 ProjectDirectoryTable 软恢复、两路写锚 + `.git/info/exclude` 防污染、析出行 worktree=真实目录
- `packages/opencode/src/effect/runtime-flags.ts`(+2)— `nonGitFolderIdentity` flag,env `OPENCODE_EXPERIMENTAL_NONGIT_IDENTITY`,**默认关**

**测试文件扩展**:`packages/core/test/project.test.ts`(+105,T15-T20;现有盘根断言原样未动)

## 影响范围

- **flag 默认关 → 发布行为零变化**(M8 灰度);flag 开后非 git 文件夹析出独立身份、git 项目工作区多一个 `.deskfox/id`(已进 info/exclude 不污染 status)
- 触 `packages/core` + `packages/opencode` 黑名单:**1 笔 R4 override**(squash 变体,2026-07-04 user 拍板),逐文件论证见 `改动日志.md`

## 回归测试

- 交付测试 102/102(core 40 + opencode 62),流水线对抗验收 + 主控独立复跑双确认
- 双包 tsgo 干净;turbo fork 范围 typecheck 22 包绿;pre-push backstop 三包绿(media-gen 140 / adapter-feishu-lark 740 / app 471)
- 真实触发(真磁盘、真 git 二进制、非 mock)PASS;全包 bun test 失败项逐一甄别为已知环境型假失败(main 上复现,memory「本地测试环境型假失败速查」在册)
- 无渲染层改动,L2 e2e 不适用

## 回退方法

- 合 main 前:直接删 feat 分支
- 合 main 后:`git revert <squash commit>` 单笔可逆(P4);磁盘上已写出的 `.deskfox/` 目录无害残留,flag 关闭后不被读取
