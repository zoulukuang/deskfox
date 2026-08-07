feat-id: session-list-ux
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-096 会话列表操作体验 — 3-changelog

> 开发完成 2026-08-07,user 审批放行(Q3 override 第 7 笔口径)。
> commit 列表:笔 1(override,opencode+core)`d47b30849e`;笔 2(app+docs)`333be8b75b`。

## 实际改动

### 新增文件(fork-only)

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/app/src/pages/layout/session-row-menu.tsx` | ~210 | 会话行右键菜单(重命名/分享/归档/删除,Kobalte ContextMenu,i18n 跟随)+ 目录感知删除确认框 + share+复制链接 |
| `packages/app/src/pages/layout/inline-editor.test.ts` | ~90 | 提交语义 8 用例 |
| `packages/opencode/test/server/session-update-unarchive.test.ts` | ~35 | UpdatePayload null 解码 5 用例 |
| `packages/core/test/session-unarchive-projection.test.ts` | ~70 | 投影层取消归档落 NULL 回归(真 projector + :memory: DB)|
| `packages/app/e2e/smoke/session-list-ux.spec.ts` | ~150 | 6 条 e2e(E1–E6)|

### 改上游文件(全部带 FORK marker)

| 文件 | 内容 |
|---|---|
| `packages/app/src/pages/session/message-timeline.tsx` | 标题编辑 blur 保存(+editing 守卫,防 Chromium 对被移除聚焦元素补发 blur 把 Esc 已放弃的草稿存回)|
| `packages/app/src/pages/layout/inline-editor.tsx` | 通用 inline 编辑器:blur 提交 + commitEditor(空/未改恢复原值)|
| `packages/app/src/pages/layout/sidebar-items.tsx` | 行右键菜单挂载 + 行内重命名 + 归档 hover 图标移除 |
| `packages/app/src/pages/layout.tsx` | archiveSession 撤销 toast + undoArchiveSession(archived:null,SDK 类型窄处 cast)|
| `packages/app/src/i18n/*.ts`(19 语言)| 3 键:common.undo / session.archive.toast.title / .description |
| `packages/opencode/.../groups/session.ts` | UpdatePayload time.archived 收 NullOr(HTTP 取消归档补齐)|
| `packages/opencode/.../handlers/session.ts` | null 透传 setArchived 清除路径(`?? undefined`)|
| `packages/core/src/session/projector.ts` | **time_archived ?? null**(取消归档 DB 落 NULL;见下)|

SDK regen 无 diff(Effect OpenAPI 生成器把 NullOr 折叠为 number,服务端运行时校验用 UpdatePayload 本体照收 null;前端窄处 cast 并注释)。

## 真机实测抓到的隐藏 bug(本 feat 最有价值的发现)

撤销归档链路 UI 全通过后,**DB 校验发现 `time_archived` 没清掉**(重启后会话又消失):core 投影层 `sessionRow` 把清除后的 `undefined` 交给 drizzle `.set()`,而 **drizzle 跳过 undefined 列** → 取消归档在持久层静默丢失。三层 undefined/null 语义(HTTP null → 服务层 undefined 清除 → DB 需显式 null)每层都对、拼起来漏——修 `time_archived: info.time.archived ?? null` 1 行 + 真 projector 回归测试。教训:**涉及"清除"语义的链路必须验到持久层,UI 恢复不算数**。

## 回归测试(2026-08-07)

- 单测:inline-editor 8 + UpdatePayload 5 + 投影回归 1 + projector 原有 10 全绿;app 579(0 fail)
- e2e:本 feat 6 条 + 全量 26/26 全绿(含 REQ-095 的 3 条)
- typecheck fork 范围 22 包全绿;media-gen 140 / feishu 792 全绿
- 真机 CDP(Mac 本地版):标题 blur 保存 / Esc 放弃 / 右键菜单 zh 四项 / inline 重命名(Enter+blur 双路径)/ hover 无归档图标 / 归档→撤销 全 10 项 PASS;修复后二轮复验:归档→撤销 UI 3 项 PASS + **DB `time_archived = NULL` 实测断言通过**(持久层真清除)

## e2e/真机踩坑(同步 2-plan)

1. Chromium 对被移除的聚焦元素**补发 blur**:Esc 关闭编辑器 → unmount → blur → 无守卫时把已放弃草稿存回。守卫 editing 状态。
2. 悬浮式侧栏行被主内容遮挡,e2e 需先点「Toggle sidebar」展开(mod+b 会被聚焦输入框吞)。
3. Playwright `page.route` glob 要考虑 query string(`**/share` 不匹配 `share?directory=...`,须 `share*`)。
4. 同文案多元素撞 strict mode("Delete session" = 标题+正文+按钮),用 role 定位。
5. **drizzle `.set()` 跳过 undefined 列**(见上节)。

## Follow-up:复制链接补回(2026-08-07,user 反馈)

右键菜单接管后原生 "Copy Link" 消失,user 要求补回:菜单加「复制链接」项(重命名/分享/**复制链接**/归档/删除),复制 `oc://renderer/<b64dir>/session/<id>` 同格式内部链接(dump-session 等工作流以此引用会话),成功 toast「已复制」。文案复用现有 `session.share.copy.copyLink` / `.copied` 键(19 语言零新增)。e2e E5 补剪贴板内容断言。fix 分支 `fix/session-row-copy-link`,commit hash 回填:(待)。

## 回退方法

`git revert` 两笔 commit;无 DB schema 变化、无数据迁移,回退即恢复原行为(已取消归档的行保持 NULL,无害)。

## R4 override 复核报告(user 审批依据)

**拟议 commit 切分**(两笔):

1. **笔 1(override)**:`packages/opencode`(groups/handlers 各 1 处 FORK + 测试)+ `packages/core`(projector 1 行 FORK + 回归测试)→ `[override-blacklist]` 一笔收口
2. **笔 2(常规)**:`packages/app` 全部(白名单)+ docs 三文档 + 索引

**wrapper 不可行性论证**:
- HTTP 取消归档缺口只能在 UpdatePayload schema 与 update handler 原位补(2 行);服务层 setArchived 清除语义现成,无新逻辑可外置。
- 投影层 `?? null` 修的是上游隐性 bug(undefined 列被 drizzle 跳过),崩点在 core 投影函数内部,无任何注入点;1 行最小侵入 + fork-only 回归测试钉死。
- 测试文件落 core/test、opencode/test 属黑名单目录误伤(REQ-048 已知模式)。

**风险评估**:上游侵入合计 ~8 行(schema 1 + handler 1 + projector 1 + FORK 注释);全部有单测/投影回归/E4 e2e/真机 DB 断言四层覆盖;行为面仅「取消归档」——此前该操作在 HTTP 层根本不存在,无既有依赖可破坏。

**配额口径**:Q3 已 6 笔(含 REQ-095),本笔第 7 笔。REQ-095 时已按修正口径向 user 报备;本笔性质同类(fork-only 主体 + 黑名单误伤 + 上游 bug 一行修)。
