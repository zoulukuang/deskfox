feat-id: win-anchor-hide-case-fold
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# Windows 适配:.deskfox 锚目录隐藏 + 路径大小写折叠(承接 REQ-069/072)

> **需求源**:Mac 同事合并批(`221f956e3..ca57a1909`,REQ-069 非 git 稳定身份 / REQ-072 改名 relocate)
> 的 Windows 平台差异项。REQ-069 spec §二明确「阶段一仅 macOS 平台无关核心;平台差异项(隐藏属性/
> 只读卷)留薄层接口」「Windows 差异项实现(阶段二)」——本 feat 即兑现阶段二 Windows 部分。
> 依据:2026-07-07 主仓 Win clone 实读 + Windows 兼容性审计报告。

## 规模分级

**Medium**(两个平台差异缺口、单一主题「REQ-069/072 的 Windows 适配」)。
触 1 个黑名单文件 `packages/core/src/project/anchor.ts` → **R4 override**(该文件 100% fork-only,
`hideAnchorDir` 是 REQ-069 spec 明列的平台薄层扩展点,wrapper 不可行论证见 3-changelog R4 段)。

## 背景:两个「Mac 上看不见、Windows 上必现」的缺口

flag `OPENCODE_EXPERIMENTAL_NONGIT_IDENTITY` 已在 `sidecar.ts` **默认 `"1"` 开启**,故两缺口在
Windows 桌面版**默认路径上必然暴露**,非灰度关闭态。

### 缺口 1(🔴):`.deskfox` 锚目录在 Windows 上不隐藏
- REQ-069 在用户每个打开过的文件夹放 `<dir>/.deskfox/id` 记住项目身份。
- macOS 点开头目录 Finder 天然隐藏;**Windows 资源管理器不隐藏点目录** → 用户每个文件夹里多出可见
  `.deskfox` 文件夹,困惑/误删(注释自陈「锚丢失 = 旧会话失联」)。
- 根因:`anchor.ts:115` `hideAnchorDir` 是 `Effect.void` 空实现,且**全仓零调用点**。

### 缺口 2(🔴):路径大小写不敏感 → relocate/身份匹配漏判
- Windows 文件系统大小写不敏感(`C:\Foo` == `c:\foo`),但 JS 字符串 `===` 敏感。
- `server.tsx` 的 fork 新增 `setId`/`relocate`/`forget` 与 relocate 链上取 id 处(`home.tsx`/`layout.tsx`)
  用裸 `project.worktree === directory` 比较。当持久化 `StoredProject.worktree`(不受控大小写:历史值/
  深链/用户手输)与后端 realpath 规范化的 worktree 大小写差一位 → `findIndex` = -1 → relocate 静默失效
  → 退回「打不开 + forget」。

## 落点(核对代码后收敛)

| 缺口 | 落点 | 级别(R1) |
|---|---|---|
| 1 | `core/project/anchor.ts`:`hideAnchorDir` win32 分支(`attrib +h`)+ 在 `writeAnchor` 写成功后调用。**单点收口**:writeAnchor 是全仓唯一建 `.deskfox` 处(`project.ts:476` 唯一调用,git/非 git 共用),故隐藏收在 writeAnchor 内 → project.ts(opencode 黑名单)**不碰** | L1 纯 fork-only 文件内 |
| 2 | 新 fork-only helper `app/utils/same-directory.ts`(win 上大小写折叠比较);应用到 `server.tsx`(setId/relocate/forget/openProject 去重)+ `home.tsx`/`layout.tsx` relocate 取 id 处。**不动上游 `pathKey`**(其输出经 `sdkFor→createClient({directory})` 发后端,小写化会改线上协议) | L1 新文件 + L2 注入 |

## 别做(硬约束)
- ❌ 改上游 `pathKey`(feeds 后端线协议,blast radius 大)——大小写折叠只做本地身份匹配层
- ❌ 缺口 3(UNC/网络盘 `mountRootOf` Win 加固)——本 feat 不做,记 backlog(边缘场景,REQ-070 mac
  已修本地盘符 `D:\` 正确;UNC 断连对称风险单列)
- ❌ 对所有 `worktree ===` 无脑替换——只改 relocate/身份持久化链(纯本地匹配),不碰后端来源两两比较

## R8 测试用例清单(动工前锁,Medium ≥1 e2e 或 3 unit)

### 缺口 1 · `core/test/project-anchor.test.ts`(unit)
- [ ] TC-H1:win32 平台 writeAnchor 成功 → hideAnchorDir 被调用(注入 spy 验证)
- [ ] TC-H2:非 win32 平台 → hideAnchorDir no-op(不调 attrib,签名兼容)
- [ ] TC-H3:hideAnchorDir 执行失败(attrib 不存在/权限)→ 降级不抛错、不影响 writeAnchor 成功返回
- [ ] TC-H4:writeAnchor 本体写失败(只读卷)→ 不调 hideAnchorDir(无锚可隐藏),仍不抛错

### 缺口 2 · `app/src/utils/same-directory.test.ts`(unit)
- [ ] TC-C1:win 路径大小写不同(`D:\Foo` vs `d:\foo`)→ sameDirectory 判等
- [ ] TC-C2:win 路径分隔符不同(`D:\Foo\Bar` vs `D:/Foo/Bar`)→ 判等(复用 pathKey 归一)
- [ ] TC-C3:POSIX 路径大小写不同(`/Foo` vs `/foo`)→ **不判等**(仅 win 风格折叠,不误伤大小写敏感 FS)
- [ ] TC-C4:真不同目录(`D:\Foo` vs `D:\Bar`)→ 不判等
- [ ] TC-C5:UNC 路径大小写(`\\Srv\Share` vs `\\srv\share`)→ 判等

### 缺口 2 · relocate 链集成(unit,复用 server.tsx 现有 test harness)
- [ ] TC-R1:persisted worktree `D:\Proj` + relocate(`d:\proj` → `D:\Proj2`)→ 命中旧条目、改成新路径(不再静默失效)
- [ ] TC-R2:setId 大小写差异仍能回写 id
- [ ] TC-R3:不同 server scope 隔离正确(不跨 server 误匹配)

## 验收门槛(R9 分支内)
- 全部 TC + `core`/`app` 现有相关测试全绿 + fork 范围 typecheck 通过
- Windows 真桌面 QA(合并前人工):打开非 git 文件夹 → 资源管理器确认 `.deskfox` 隐藏;改名/挪位/复制
  会话跟随;盘符大小写差异可正常打开
- 问题分支内解决干净,才向 user 提 merge(铁律②③)

## 审签
2026-07-07 动工前锁版(承接已审签的 REQ-069/072,平台薄层兑现,无新架构决策)。
