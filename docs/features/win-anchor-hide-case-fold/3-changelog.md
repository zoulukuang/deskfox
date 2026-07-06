feat-id: win-anchor-hide-case-fold
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实际改动 + 回归 + R4 复核报告

## 概述
兑现 REQ-069 spec 明列的 Windows 阶段二两缺口。合入 Mac 同事批(`221f956e3..ca57a1909`)后,在
Windows clone 实读 + 兼容性审计发现:REQ-069/072 的 flag 已在 `sidecar.ts` 默认开启,故两缺口在 Win
桌面版默认路径必现。分支 `feat/win-anchor-hide-case-fold`(基于 `ca57a1909`)。

## 改动文件(源码 ~215 行,+测试)
| 文件 | 改动 | 黑名单 |
|---|---|---|
| `packages/core/src/project/anchor.ts` | hideAnchorDir win32(`attrib +h`,双注入)+ writeAnchor 写成功布尔捕获后调 hide | 是(core)→ R4 |
| `packages/core/test/project-anchor.test.ts` | +TC-H1~H4;2 个既有 chmod 测试改可移植失败注入(EISDIR/ENOTDIR) | 是(core)→ R4 |
| `packages/app/src/utils/same-directory.ts`(新) | sameDirectory / sameDirectoryKey(Win 折叠小写,POSIX 原样) | 否(fork-only) |
| `packages/app/src/utils/same-directory.test.ts`(新) | TC-C1~C5 + 回归 8 测 | 否 |
| `packages/app/src/context/server.tsx` | 持久化匹配层统一 sameDirectory + relocate index 修正(纯大小写改名不误删) | 否(R2 marker) |
| `packages/app/src/context/server.test.ts` | +TC-R1/R1b/R2/R3 + POSIX 回归 | 否 |
| `packages/app/src/pages/home.tsx` / `layout.tsx` | relocate 取 id 处 sameDirectory | 否(R2 marker) |
| `docs/features/win-anchor-hide-case-fold/*` + `INDEX.md` | 三文档 + 索引 | 否 |

## commit(待填 hash)
- 待 user 审 R4 复核后 commit(feat 分支内),标 `[override-blacklist: <理由>] [feat: win-anchor-hide-case-fold]`

## 回归测试(Windows 本机实跑)
- **typecheck**:fork 范围 22 包全绿(`bun turbo typecheck --filter='!./packages/console/*'`)
- **core anchor**:`project-anchor.test.ts` 27 pass / 0 fail(含 2 个原 Win 假失败测试可移植化后转绿)
- **app same-directory + server**:20 pass / 0 fail(TC-C*/TC-R* 全绿)
- **app 全量单测**:501 pass / 0 fail(74 文件,无回归)
- **opencode project/session 集成回归**:30 pass / 0 fail(REQ-069/072 新测在 writeAnchor 签名变更 +
  win32 真跑 attrib 下无回归)
- **native 验证**:真 Windows 机 `attrib +h <.deskfox>` 后属性显示 `H` 标志 = 目录确实隐藏(单测用注入
  spy 不碰真 attrib,故补此真机验证)
- **已知无关红**:`packages/core` 全量另有 8 个失败(ReadTool/Ripgrep/native OpenCode API/SessionRunnerLLM)
  —— 均 Windows 环境既有问题(rg 二进制 / native fs location),已证零 import 关联本改动,非本 feat 引入。

## 回退方法
- 缺口1:`git revert` 本 feat 的 anchor.ts commit → hideAnchorDir 回落 no-op(`.deskfox` 恢复可见,不影响
  身份逻辑本身)。
- 缺口2:删 `same-directory.ts` + `git revert` server.tsx/home.tsx/layout.tsx 段 → 回落裸 `===`(POSIX
  行为本就 bit-identical,回退对 Mac 无感)。
- 两缺口正交,可独立回退。

## 影响范围
- macOS/Linux:**零行为变化**——hideAnchorDir 非 win32 即 return;sameDirectory 对 POSIX 路径 = 裸 pathKey。
- Windows:`.deskfox` 隐藏;relocate/身份匹配大小写不敏感,改名/挪位不再因盘符大小写差异静默失效。
- 后端线上协议:**不变**(未动 pathKey,directory 仍原样发后端)。

---

# Windows 真桌面 QA(local 本地版,CDP 驱动)

> 2026-07-07 打 local 本地版(`DeskFox 本地版.exe`,独立身份 `ai.deskfox.app.local` + 隔离
> `opencode-local.db`),用 `opencode://open-project` 深链(绕原生对话框)+ 直接编辑 `opencode.global.dat`
> seed 持久化态 + CDP 读 DOM 驱动真机验收。

## 缺口1 真机验证(✅ 全过)
| 场景 | `.deskfox` 隐藏属性 | 锚身份 | git status |
|---|---|---|---|
| proj-a(非 git) | `attrib` 含 `H` ✓ | `fld_6d4ae6…` | — |
| git-proj | `attrib` 含 `H` ✓ | git commit sha ✓ | 干净 ✓(`.deskfox/` 进 info/exclude)|
- 对照:普通文件 `note.txt` 仅 `A` 无 `H` → hideAnchorDir 精准只隐藏 `.deskfox`,不误伤。

## 缺口2 真机验证
- **Test 2A(同大小写改名 relocate)✅**:proj-a 改名 proj-a-renamed → 冷启动 autoselect stale lastProject
  → tryRelocate 锚扫描命中 → 打开 proj-a-renamed(非「打不开」)、持久化条目就地更新、id 保持。
- **Test 2B(大小写失配 relocate)**:lastProject 小写盘符 `d:\…` vs StoredProject 大写 `D:\…`。
  - **首轮暴露真 bug**:app 误开 `git-proj`(而非 relocate proj-a)。定位 = **boot autoselect
    `layout.tsx:605` `list.find(worktree === last)` 仍用裸 `===`**,大小写失配落空 → `?? list[0]`。
    这是上一轮 gap2 修复**漏网**的同类点(只改了 relocate 取 id 处,漏了 autoselect + home newSessionProject)。
  - **修复**:`layout.tsx:605` + `home.tsx:165`(newSessionProject 回退找 lastProject)改 `sameDirectory`;
    加复现单测(same-directory.test.ts「boot autoselect …case mismatch」)。
  - **重打包 local 版复验 ✅**:同场景 app 正确 relocate 打开 `proj-a-final`(修复前 git-proj)、
    持久化 relocate 到位、id 保持。

## QA 追加修复(commit 2,feat 分支内)
- `packages/app/src/pages/layout.tsx`:boot autoselect `worktree === last` → `sameDirectory`
- `packages/app/src/pages/home.tsx`:newSessionProject 回退 `worktree === last()` → `sameDirectory`
- `packages/app/src/utils/same-directory.test.ts`:+1 复现测试(app 全量 501→502 pass)
- **非黑名单文件,无新 R4**;`[bug-repro]` = 真机 2B + 新复现单测。

## QA 结论
两缺口在真 Windows 桌面端到端验证通过;QA 过程额外抓到并修复一个单测未覆盖的 boot-autoselect 大小写
漏网点(真桌面 QA ≠ CDP 自测/单测的价值实证)。

---

# R4 黑名单 override 复核报告

> 触发文件:`packages/core/src/project/anchor.ts` + `packages/core/test/project-anchor.test.ts`
> (`.husky/pre-commit` BLACKLIST_REGEX 含 `packages/core/`)。配额:本 feat 记 **1 笔**(squash 后单 commit)。

## ① wrapper 替代不可行性论证
- **anchor.ts 是 100% fork-only 文件**(`// FORK-ONLY:` 头,REQ-069 建),0 上游逻辑;`hideAnchorDir`
  是该文件里 REQ-069 spec §三**明列的平台薄层扩展点**(「hideAnchorDir 并入 U1」),本就是为「阶段二补
  Windows 隐藏」而预留的 stub。此次是**填充既有 fork stub**,不是侵入上游。
- **wrapper 外置为何不可行**:隐藏必须在「锚目录刚写出」那一刻做,唯一建锚点是 anchor.ts 的 `writeAnchor`。
  若在外层(`opencode/project.ts` fromDirectory)另起一遍 hide,则 ① 要对 core 内部写锚时序做二次
  path 计算(重复磁盘契约常量,违 R3 单点收口)② `project.ts` 属 `packages/opencode` **也是黑名单**,
  外置不减 override 反增一笔、且更差(跨包重复逻辑)。收在 writeAnchor 内 = 侵入面最小(1 文件)、
  契约不散写。
- **测试文件同触黑名单**:REQ-048 教训——core 新增/改测试文件亦命中 regex。TC-H* 必须测 anchor.ts 的
  新逻辑,无法外置到非黑名单包(被测对象在 core)。

## ② 风险评估
- **改动性质**:纯新增能力(Win 隐藏)+ 精确化既有降级(写失败布尔),非改上游算法。
- **失败模式**:hideAnchorDir 全链路降级(attrib 缺失/权限/受控目录静默 resolve),最坏 = 隐藏没生效
  (退化为当前 Mac 已发布行为:`.deskfox` 可见),**绝不阻塞写锚 / 不抛错 / 不影响身份**。
- **回归面**:writeAnchor 签名新增可选第 3 参(默认 hideAnchorDir),既有唯一调用方 `project.ts:476`
  两参调用不受影响;opencode 30 集成测 + core 27 anchor 测全绿佐证。
- **可逆**:P4 单 revert 即回 no-op stub,与身份逻辑正交。

## ③ 改动日志论证
- 见本文件「改动文件」「回归测试」「回退方法」段:逐文件列改动 + Win 本机全绿实跑 + attrib 真机验证 +
  8 个无关红已证非本 feat。

## 待 user 审
- 三项(wrapper 不可行性 / 风险评估 / 改动日志)已备。**未 commit、未 merge、未 push**;待 user 点头后
  在 feat 分支内 commit(标 override + feat tag),merge/push 再各自单独请示(铁律②③)。
