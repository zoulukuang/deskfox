feat-id: session-content-search
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-095 会话记录内容搜索 — 3-changelog

> 开发完成 2026-08-07,user 审批放行(Q3 override 第 6 笔口径)。
> commit 列表:笔 1(override,opencode+sdk)`e71b0ba156`;笔 2(app+docs)`5efb6855a5`。

## 实际改动

### 新增文件(fork-only,~1126 行含测试)

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/opencode/src/session/search/fts-sql.ts` | 134 | FTS5 DDL/触发器/backfill SQL 集中区(trigram + external-content + part 表触发器)|
| `packages/opencode/src/session/search/query.ts` | 73 | 查询规划纯函数(分词/MATCH vs LIKE 路由/LIKE 转义/TS 侧 snippet)|
| `packages/opencode/src/session/search/search.ts` | 216 | 幂等 bootstrap(探测/版本重建/backfill,进程闩)+ 查询执行 + 去重 + 项目名补齐 + 全链路降级 |
| `packages/opencode/src/server/routes/instance/httpapi/groups/session-search.ts` | 38 | `/session/search` 端点 schema(照 file-office.ts 先例)|
| `packages/app/src/utils/session-search-snippet.ts` | 47 | snippet 高亮定界符(U+E000/E001)解析,嵌套容错 |
| `packages/opencode/test/session/search/{query,search}.test.ts` | 458 | 28 用例:纯函数 + 真 SQLite 集成(触发器/anchor/scope/幂等/版本重建/降级/万级性能)|
| `packages/app/src/utils/session-search-snippet.test.ts` | 40 | 6 用例 |
| `packages/app/e2e/smoke/session-content-search.spec.ts` | 120 | 3 条 e2e:happy path 跳转定位 / 全局切换 / 降级隐藏 |

### 改上游文件(全部带 FORK marker)

| 文件 | 行数 | 内容 |
|---|---|---|
| `packages/opencode/.../groups/session.ts` | +17 | search 路径 + 端点注册(FORK block)|
| `packages/opencode/.../handlers/session.ts` | +23 | search handler(直取 Database.Service + InstanceState.context,D4)|
| `packages/opencode/src/server/shared/workspace-routing.ts` | +2 | `/session/search` 静态段豁免(同 `/session/status` 先例;真 server 抓到的必修点,见踩坑)|
| `packages/app/src/components/dialog-select-file.tsx` | +150 | 「会话内容」分组:content source/高亮渲染/#message- 锚点跳转/scope 切换行 |
| `packages/app/src/i18n/*.ts`(19 语言) | +57 | 3 键:分组名/在所有项目中搜索/只搜当前项目 |
| `packages/app/e2e/utils/mock-server.ts` | +15 | mock `/session/search` + `/find*` 空数组兜底(修 mock 缺口崩 ErrorBoundary)|
| `packages/sdk/js/src/v2/gen/{sdk,types}.gen.ts` | +92/-6 | SDK regen(hey-api 自动生成 `client.session.search`)|

## 影响范围

- 后端:新端点 + part 表 3 触发器(仅 text part 写入时多一次轻量 SQL;流式 delta 不落库不受影响)。FTS 对象由首次搜索惰性创建,不搜索则 DB 无任何变化。
- 前端:仅 ⌘K 面板;输入 <2 字符或 FTS 不可用时行为与改动前完全一致。
- 上游 merge 风险点:workspace-routing 豁免行 / session group 端点块;`part.data` JSON 路径若上游改名,search 全链路 catchCause 降级为 unavailable 不崩(2-plan 风险表)。

## 回归测试(2026-08-06/07)

- 本 feat:sidecar 28 pass / snippet 6 pass / parity pass / e2e 3 pass;真 server curl 全链路(MATCH 中文子串 + LIKE 双字 + 运行中触发器增量)验证通过;万级消息 MATCH/LIKE 均 <1s(P1)
- 全量:`bun turbo typecheck --filter='!./packages/console/*'` 22/22 ✅;app 571(569 pass + **2 预存 fail**:project-restore,基线 stash 对照证实与本 feat 无关);opencode test/session 411(4 fail = llm.stream flaky,基线 1-2 fail 同波动区间);opencode test/server 302(清代理后 291+ pass,超时类失败随机漂移、`httpapi-instance` 404 用例**基线同样失败**=预存);media-gen 140 ✅;adapter-feishu-lark 792 ✅;Playwright e2e 全量 20/20 ✅
- 预存失败清单(非本 feat 回归,建议另立 fix):① `project-restore.test.ts` 2 用例(REQ-072 补回逻辑)② `httpapi-instance.test.ts` PATCH missing project 期望 404 得 200

## 真机实测(2026-08-07,Mac 本地版,M1 项闭环)

`build-deskfox-electron.sh -Env local --no-bundle` 打包(产物字节 grep 确认 sidecar bundle 含 `session_fts`、renderer 含新面板 chunk),CDP(:9333)+ playwright-core 驱动真桌面 app,种子数据直插 `opencode-local.db`:

- **冷启动 + 首搜 bootstrap**:FTS 对象惰性创建,backfill 索引全库 183 行(种子 + 用户真实历史),首屏无卡顿
- **触发器增量**:app 运行中外部连接插入 part,立即出现在 `session_fts`(免重启即可搜)
- **项目内命中**:「编译报错」→「Session content」分组 + 加粗高亮片段 + 时间戳(截图 real-1)
- **决定性跨会话跳转**:会话 A 内搜索只存在于从未打开过的会话 B 的词 → 点击 → 面板关闭、切到会话 B、`#message-` 锚点元素与消息文本可见(截图 real-4)
- **全局切换**:当前项目 0 命中 → 固定行「Search in all projects」→ 跨项目命中(带项目上下文)+ 反向切换行(截图 real-5)
- 8/8 断言 PASS;两处 URL 断言不适用(Electron 桌面路由不写 frame URL,以锚点元素可见性为准)

实测中发现并确认的**非产品问题**:种子 message 行 JSON 过简会让 `/message` 端点 schema 解码 500(schema-valid 种子后消失)——提示日后手工造数须以真实行为模板。

## 回退方法

1. `git revert` 两笔 commit(sidecar override 笔 + app 笔),互不依赖可单独回退。
2. 已运行过的用户 DB 中残留 FTS 对象(纯派生数据,不影响上游任何读写路径);彻底清除可执行 `fts-sql.ts` 的 `DROP_STATEMENTS`(9 条 DROP)。不清除也无害,触发器在旧代码下继续维护索引或随 part 表操作静默工作。

## 踩坑记录(同步 2-plan)

1. **workspace-routing 中间件自行解析 `/session/:id`**:静态路由优先只保证了 router 层;`getWorkspaceRouteSessionID` 用正则把 `search` 当 sessionID → SessionID schema 校验 500。集成测试(直调 search 函数)和 mock e2e 都测不到,**真 server curl 才抓到**。修:同 `/session/status` 显式豁免。教训:加静态 `/session/*` 端点必查该文件。
2. Effect v4 beta 无 `Effect.catchAll` → 用 `Effect.catch` / `Effect.catchCause`(本仓 110 处 catch 惯例)。
3. `yield*` 放三元分支里 tsgo 解析成 never → 改 if/else。
4. hey-api 生成的 number 类型是 `number | "-Infinity" | "Infinity" | "NaN"` 联合,前端要 `typeof === "number"` 收窄。
5. e2e:`mod+k,mod+p` 是 chord 键,面板改由标题栏「Search files」按钮打开;mock-server 缺 `/find/file` 时兜底返回 `{}` 会让 `file.tsx` `.map` 崩全屏 ErrorBoundary(已在 mock 补 `/find*` 空数组)。
6. bun test 不能在 repo root 跑(`do-not-run-tests-from-root` 防呆),必须 cd 进包目录。
7. 本地测试环境假失败对照法:`git stash push -- packages/<pkg>` 跑基线再 pop,5 分钟内确认"预存 vs 本 feat 回归"。

## R4 override 复核报告(user 审批依据)

**拟议 commit 切分**(两笔,先 override 笔后 app 笔):

- 笔 1(override):`packages/opencode/*`(4 新文件 + 3 上游文件 FORK block + 测试)+ `packages/sdk/js/src/v2/gen/*.gen.ts`(regen)→ commit message 挂 `[override-blacklist: ...]`,黑名单文件一笔收口
- 笔 2(常规):`packages/app/*`(面板/i18n/e2e/helper,全白名单)+ docs 三文档 + INDEX + 改动日志

**wrapper 不可行性论证**:
- 搜索服务必须在 sidecar 进程内直连 opencode.db(查询 + 触发器 DDL),无进程外注入点;fork-only 新文件落 `packages/opencode/` 也触发黑名单(REQ-048 已知误伤模式,同 REQ-079)。
- 端点必须挂进 Effect HttpApi 的 session group(SDK 生成、鉴权、instance 路由都由该体系提供),照 office-routes 先例以 FORK block 注入,fork-only schema 文件收走主体。
- `workspace-routing.ts` 豁免行:该中间件在 router 之前拦路解析 sessionID,不改则端点必 500,2 行与上游 `/session/status` 处理完全同构。
- SDK `.gen.ts`:机械 regen 产物,与 office 先例同类(彼时已识别 R4 规则与 codegen 工作流错配,豁免机制 backlog 未落地)。

**风险评估**:上游侵入合计 42 行(17+23+2),全部 FORK 标记;触发器挂上游表但 DDL 全在 fork-only 文件、可整体 DROP;查询/启动全链路 catchCause 降级,最坏情况 = 内容搜索分组消失,不影响任何既有功能。

**⚠️ 配额修正**:1-spec 阶段估算"本笔为 Q3 第 2 笔"**不准确**。实际 `git log --since=2026-07-01 --grep=override-blacklist` 显示 Q3 已有 **5 笔**(REQ-069 / REQ-069-072-Win / v2026.8.4 squash / REQ-081 / REQ-079),其中 REQ-081 时已就"超基线 ≤2"向 user 专门报备。本笔将是 **Q3 第 6 笔**,请 user 在此口径下重新确认。
