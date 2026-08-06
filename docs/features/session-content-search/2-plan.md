feat-id: session-content-search
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-095 会话记录内容搜索 — 2-plan

## 实施顺序

1. sidecar fork-only 模块 `packages/opencode/src/session/search/`(fts-sql / query / search)
2. 端点:`groups/session-search.ts`(fork-only schema)+ `groups/session.ts` / `handlers/session.ts` FORK block
3. SDK regen(跑 test:ci 时 hey-api 自动从新 OpenAPI spec regen)
4. sidecar 单测(bun:sqlite 裸库跑 DDL/触发器/查询语义)
5. 前端:dialog-select-file.tsx content source + 高亮 helper + i18n(19 语言,parity 测试硬约束)
6. e2e(mock-server 模式)+ R9 全量回归

## 关键决策轨迹

- **D1 触发器 vs Bus writer**:选触发器。核实 `packages/core/src/session/event.ts` 流式 delta 在 `EphemeralDefinitions`(不投影落库),part 行只在 projector upsert 时写(`projector.ts:314`),触发器不会被逐 token 打爆。少一个常驻服务、DB 层强一致。
- **D2 不走 migration**:`migration.ts` 对 fresh DB 只跑 `schema.gen.ts` 后把 migration 全标完成不执行 → FTS 走 migration 新装用户拿不到。幂等 bootstrap(首搜惰性 + 进程闩 + meta 版本表)覆盖新装/升级同一路径。
- **D3 `/session/search` 静态路径安全**:上游已有 `/session/status` 与 `/session/:sessionID` 共存先例,静态段优先。**实施期修正**:router 层确实静态优先,但 `workspace-routing` 中间件在 router 之前自行正则解析 `/session/:id`,须照 status 先例在 `shared/workspace-routing.ts` 显式豁免(+2 行),详见 3-changelog 踩坑 1。
- **D4 handler 直取 Database.Service + InstanceState.context**:`server.ts:214` 提供 Database.defaultLayer,`handlers/file.ts` 有 InstanceState.context 直取先例 → 不新增 Context.Service,不动 layer 组装,fork 模块导出普通 Effect 函数。
- **D5 INSERT OR REPLACE 禁用**:recursive_triggers OFF 时 REPLACE 的隐式 delete 不触发 AD 触发器 → external-content idx 脏。part AU 触发器用显式 DELETE + INSERT。
- **D6 去重**:同一轮次多 part 命中,server 侧按 (session_id, anchor_message_id) 去重取最优(MATCH 按 bm25,LIKE 按 time_updated),超采 3× 后截断 limit。
- **D7 snippet 定界符**:用私用区字符 U+E000/U+E001(正文可能天然含 `<<`/`>>`,如代码)。
- **D8 面板集成**:content entries 走 `skipFilter` 绕过 fuzzysort(服务端已过滤,标题不含关键词会被客户端 filter 误杀);「在所有项目中搜索」行是特殊 entry type,onSelect 不关 dialog、切 scope 信号,List 的 createResource 源响应式自动重查。

- **D9 放弃 200ms 去抖**(实施中推翻原计划):List 的 `items()` 用 `Promise.all` 等全部 source,content 去抖会给整个面板(命令/文件/会话组)加 200ms 延迟地板;现有 `file.searchFiles` 本就每键击打服务端无去抖,内容搜索为本地 SQLite 毫秒级,与其保持同构,改为按 (scope, query) 缓存防重复请求。

## 踩坑记录

见 [3-changelog.md](./3-changelog.md)「踩坑记录」段(7 条:workspace-routing 中间件拦路解析 sessionID / Effect v4 catch 命名 / yield* 三元 / hey-api number 联合 / e2e chord 键与 mock 缺口 / bun test root 防呆 / stash 基线对照法)。
