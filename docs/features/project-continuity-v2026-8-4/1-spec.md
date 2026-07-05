feat-id: project-continuity-v2026-8-4
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 切项目/改名连续性 + stale-path 簇收官(v2026.8.4)

> **需求源 = 版本计划**:[`OPENCODE-PLAN/版本计划/v2026-07-05.md`](../../../../OPENCODE-PLAN/版本计划/v2026-07-05.md)(兼任本版架构定调)。
> 逐条根因/修法源:
> - REQ-071 [`输入框草稿切换项目丢失.md`](../../../../OPENCODE-PLAN/需求池/输入框草稿切换项目丢失.md)
> - REQ-072 [`会话侧栏改项目维度.md`](../../../../OPENCODE-PLAN/需求池/会话侧栏改项目维度.md)
> - REQ-070 [`stale-path-mac-物理盘QA.md`](../../../../OPENCODE-PLAN/需求池/stale-path-mac-物理盘QA.md)
>
> 本 spec 只做**动工前锁版**:落点收敛 + R8 逐条测试用例。深层根因见上述 doc,不复述。

## 规模分级

**Medium**(50–500 行、单一主题「切项目/改名视图连续性」)。触 1 个上游黑名单文件 `packages/opencode/src/session/session.ts` → **R4 override**(query 身份逻辑内在,wrapper 不可行,详见 3-changelog R4 复核段)。

## IN SCOPE

| REQ | 标题 | 落点(核对代码后收敛) |
|---|---|---|
| REQ-072 | 会话侧栏改项目维度(改名/挪位/复制后旧会话跟随) | 后端 `session.ts` `list` 单文件加 global 门控(FORK marker);前端 `session-load.ts` 传 `scope:"project"` + `types.ts` `RootLoadArgs` 补 scope;`tabs.tsx` `sessionHasOpenTab` 去重改 server+session.id |
| REQ-071 | 输入框草稿切项目后丢失 | 定点修再水合时序(`prompt-input.tsx` / `prompt.tsx`),CDP 复现验证后择候选;不动 keyed、不改持久化格式;回贡上游 |
| REQ-070 | stale-path mac 物理盘掉线 QA(承接 068 unreachable + 061 M5) | **纯 QA 无代码**:U 盘造 offline 跑 2a/2b,回填 `stale-path-hardening/mac-qa-handoff.md` |

## 落点核对结论(动工前,2026-07-05 主仓 mac clone 实读)

- **REQ-072 后端 scope=project plumbing 全是上游原生**(ListQuery `scope` = #24853;handler drop directory = #25215;listByProject scope 分支 = #30804,均 in `upstream/dev`)。**唯一缺 = global 门控**:现 scope=project+global 会列全部 global 会话 = 大杂烩。
- **门控落点收敛到单文件**:handler 拿不到 resolve 后 projectID(在 `session.list` 内经 `InstanceState.context` 才 resolve),故门控放 `session.ts` `list`;`InstanceContext` 自带 `directory`+`project.id` → 可在此判 global 并回填 directory,**handler / listByProject 均不动**,上游侵入最小(1 文件)。
- **REQ-072 A 类残留(tabs 重复 tab)= 小 UX,顺手收**:`sessionHasOpenTab` 用 `session.directory`(旧路径)去重 → 改名项目开重复 tab。改按 `session.id`(id 全局唯一,server 限定)。非 stale-path 500(打开走当前有效目录 slug)。
- **REQ-071 = 上游自带、至今未修的再水合时序 bug**(merge-base `be227503af` vs `upstream/dev` 逐点核对上游未修);静态分析「理论应重跑」但实测失效 → 需 CDP 复现区分 read-race vs reconcile-fail 再定点修。

## R8 测试用例清单(动工前锁,Medium ≥1 e2e 或 3 unit)

### REQ-072 后端门控(Logic 清单 · 单元)
- [ ] TC-B1:`scope=project` + 真实 projectID(非 global)→ 只按 `project_id` 过滤,**忽略 directory**(改名/挪位旧 directory 会话仍列出)
- [ ] TC-B2:`scope=project` + `projectID===ID.global` → **降级保留 directory 过滤**(只列当前目录会话,守大杂烩反例)
- [ ] TC-B3:**不传 scope**(其它 caller)→ 行为完全不变(directory 过滤照旧)
- [ ] TC-B4:`scope=project` + global + handler drop 掉 directory(undefined)→ `list` 回填 `ctx.directory` 后仍能 directory 过滤(不因 handler drop 而退化成大杂烩)

### REQ-072 前端 scope 传参(Logic 清单 · 单元)
- [ ] TC-F1:`loadRootSessionsWithFallback` 主路径(带 limit)向 `list` 传 `scope:"project"`
- [ ] TC-F2:`loadRootSessionsWithFallback` fallback 路径(catch,无 limit)也传 `scope:"project"`
- [ ] TC-F3:`estimateRootSessionTotal` 行为无回归(纯计算,既有测试保持绿)

### REQ-072 tabs 去重(Logic 清单 · 单元)
- [ ] TC-T1:改名项目会话(`session.directory`=旧路径,当前打开=新路径)+ 已有该 session 的 open tab → `sessionHasOpenTab` 返回 **true**(不再因目录失配开重复 tab)
- [ ] TC-T2:不同 session.id 不误判为已开;跨 server 隔离正确

### REQ-072 真机验收(View 清单 · e2e/CDP,不变量 2×2 全绿)
- [ ] 非 git 锚项目(flag 开)· 改名 → 重开默认侧栏仍见旧会话
- [ ] 非 git 锚项目 · 挪位 → 重开仍见旧会话
- [ ] git 项目 · 改名 → 重开仍见旧会话
- [ ] git 项目 · 挪位 → 重开仍见旧会话
- [ ] 复制副本(原件在)→ 打开副本侧栏见原件全部会话、双向共享
- [ ] **反例**:global 项目侧栏不退化成全局大杂烩
- [ ] 普通(未改名/未挪位)项目侧栏无回归

### REQ-071 再水合(View 清单 · e2e/CDP)
- [ ] 项目 A 键入未发送 → 切 B → 切回 A → 草稿仍在(与 2026-07-04 复现路径对齐)
- [ ] 冷启动读回草稿不回归
- [ ] 切项目其余 keyed 子树销毁/重建行为无回归

### REQ-070 物理盘 QA(纯真机,U 盘)
- [ ] 2a REQ-068 unreachable:U 盘项目 → 推出 U 盘冷启动 → unreachable 引导 toast、lastProject 不清、记 errno
- [ ] 2b REQ-061 M5:U 盘 git 项目 → 拔盘再解析 → worktree 不误重绑、插回正常;记 errno

## 验收门槛

见版本计划 §「验收门槛」(REQ-071 草稿连续性 / REQ-072 会话侧栏项目维度四格不变量 + 反例 / stale-path 物理盘 2a·2b / 共用一套操作脚本)。

## 别做(硬约束)

- ❌ REQ-071:上提 PromptProvider / 去 keyed / 改持久化格式(均偏离上游、已否)
- ❌ REQ-072:改写 `session.directory`;对所有 caller 无脑切 project 维度(门控只在显式 scope=project 生效);多目录来源标注(v1 不做)
- ❌ REQ-070:改代码(068/061 代码已发版,仅补 QA)
