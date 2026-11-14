# REQ-149 忽略过滤：实际 diff 的 R4 复核

执行：笑南的电脑 / Codex，2026-11-14。基于 `ef9904415f`，用户已明确批准 Large 施工方案「批准两项施工方案，继续并行推进」。此报告请求的是完成实现后的具体黑名单 diff 确认，不代替合 main 或发布。

## 实际行为与改动清单

普通文件事件先按 100ms 合并，最多一条忽略判定 HTTP 在途及一个有界待处理集合。根 HEAD 事件直接走已有 VCS 合并刷新。全部路径经 Git 确认忽略且 HEAD 无对应条目才抑制差异刷新；任何不确定性均保守刷新。保留原 watcher 广播，文件树与打开文件的更新逻辑未修改。

| 文件 | 实际变化 |
| --- | --- |
| `packages/app/src/pages/session.tsx` | +7/-3；三处小注入：import、创建过滤器、区分 HEAD/忽略元数据/普通文件 |
| `packages/app/src/pages/session/vcs-event.ts` | +8/-3；复用原路径归一化，提供事件三类结果，保留原 boolean 导出以覆盖既有测试 |
| `packages/app/src/pages/session/vcs-refresh-filter.ts` | 新增 95 行；单在途、去重、128 路径/64 KiB、1.5 秒超时、切项目与卸载清理 |
| `packages/app/src/pages/session/vcs-refresh-filter.test.ts` | 新增 146 行；6 组异步/错误/溢出/生命周期测试 |
| `packages/app/e2e/regression/vcs-refresh-overload.spec.ts` | +20；忽略事件不刷 diff，HEAD 不调用分类接口，混合事件与已有负载流程 |
| `packages/opencode/src/project/vcs-refresh-required.ts` | 新增 49 行；原生 check-ignore、HEAD ls-tree 保护、路径边界、1 秒 Effect 截止 |
| `packages/opencode/test/project/vcs-refresh-required.test.ts` | 新增 161 行；5 组真实 Git fixture，含真实超时进程终止 |
| `packages/opencode/src/server/routes/instance/httpapi/groups/vcs-refresh.ts` | 新增 26 行；输入 schema、标准鉴权/工作区/实例中间件 |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/vcs-refresh.ts` | 新增 18 行；复用 Git.Service，目录由请求实例上下文提供 |
| `packages/opencode/test/server/httpapi-vcs-refresh.test.ts` | 新增 66 行；真实生产 HTTP handler 的鉴权、目录路由与异常输入 |
| `packages/opencode/src/server/routes/instance/httpapi/api.ts` | +3；标准 API group 注册，含 FORK marker |
| `packages/opencode/src/server/routes/instance/httpapi/server.ts` | +3；标准 handler layer 注册，含 FORK marker |
| `packages/sdk/js/src/v2/gen/sdk.gen.ts` | +44；自动生成新 endpoint 方法与访问器 |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | +32；自动生成请求/响应类型 |

产品及测试共 14 文件、+678/-6；其中 7 文件为新增。无无关修复、无新增依赖、未改不理解的代码、未使用全仓替换。`session.tsx` 全文存在两块基线格式差异，本次未顺手格式化它们；新增文件已格式化。

## R4 四文件逐项复核

四文件均存在于 `upstream-base`，不能用 fork-only 豁免。其余新增文件在上游基准不存在。

| 黑名单文件 | 为什么 wrapper 不能替代 | 风险与控制 |
| --- | --- | --- |
| `httpapi/api.ts` | 封闭的 HttpApi 注册树必须显式加入新 group，否则接口不在标准合同中；逻辑 wrapper 无法自行注册。 | 仅 additive 注册，不改原 API；生成与真实 HTTP schema/鉴权测试通过 |
| `httpapi/server.ts` | 声明接口不自动发现 handler，需在既有实例服务层注册一次。 | 不重建服务图、不改其他中间件顺序，真实实例路由与完整类型检查通过 |
| `sdk.gen.ts` | 前端需要现有授权/目录/AbortSignal 传输行为；应使用自动生成 SDK，不能手写修改生成物或另开无鉴权 fetch 路径。 | 由官方仓内生成脚本得到，仅追加新方法/访问器 44 行，无其他接口变化 |
| `types.gen.ts` | 类型与生成的方法必须来自同一 OpenAPI；手工 wrapper 类型会形成另一套合同。 | 同一生成脚本追加请求/响应类型 32 行，生成审计无无关变化 |

生成审计：在 `packages/client` 执行 `bun run generate`，无差异；在 `packages/sdk/js` 执行 `bun ./script/build.ts`，仅上述两个 legacy SDK 文件增加 76 行。没有手编生成文件。标准 OpenAPI 能列出新 endpoint；客户端继续沿用已有 credentials 和目录查询。

## 已运行验证

- Bun 1.3.14。Git fixture：5 pass、66 断言；隔离 global Git 配置，覆盖根/嵌套/全局/info excludes、否定规则、`.ignore` 区别、强制跟踪与 staged deletion、目录保护、特殊文件名、越界/尺寸/HEAD 缺失。真实 Git 阻塞于 FIFO，1 秒超时返回 true，并验证对应 PID 已退出；该 FIFO 用例仅 Mac/Linux，Windows 标为平台 skip，不冒充 Windows 证据。
- HTTP：1 pass、14 断言；生产路由 handler，未授权 401，合法 200，目录 query 正确选择实例，非法/过量输入 400，项目外路径保守返回 true。
- 前端异步过滤：6 pass、26 断言；无忽略请求积压、混合变化、错误回退、路径/字节上限、取消/卸载、超时与迟到结果。
- Playwright：`vcs-refresh-overload.spec.ts` 1 pass（8.7 秒），Chromium、独立 loopback 4337、retries=0。模拟 HTTP/SSE，不能代替真实 socket pool 负载或 native 桌面 QA。
- app 与 e2e、opencode 包级类型检查通过。
- 完整 `.husky/pre-push` 退出 0：29 个 typecheck 任务；app 1228 单元 + 41 浏览器、media 140、飞书 792、branding 82 pass / 8 既有 skip、desktop 176、session-ui 125，全部 0 fail。日志 `/tmp/vcs-ignore-pre-push.log`。
- `git diff --check` 通过。父 agent 与 MCP 子 agent 独立复核未发现阻断问题。

## 风险、剩余与提交方式

判定是保守优化：HEAD 缺失/非 Git 仓/超时/异常会恢复刷新；多个窗口仍各有自己的分类器，本次不是全应用限流。额外 HTTP 请求最多一条分类请求加一条 diff 请求；不把它称为总连接只有一条。

原 T8/T9 两端 local 验收仍未完成，不标 done、不发版。Windows FIFO 替代验证和标准发布门照旧。

用户于 2026-11-14 明确批准「批准三组提交与推送」，包括本报告的 14 文件冻结补丁。提交前重新导出 cached binary diff，SHA-256 与批准对象完全一致：`478c31c05c1ec8bb1e430ee1a12d8e45961840800ae96d9ca2ef18560b650b93`。本次 R4 实际 diff 与 Large 提交审签完成，产品代码不再改动。

按批准范围将 Git helper、标准 API/生成 SDK、前端过滤及对应测试同笔交付，以保留端到端修复的可回退性。提交信息同时记录 `override-blacklist`、`large-diff`、`feat` 与 `bug-repro`；仅按规范使用 `--no-verify` 跳过已批准的提交守卫，正常 push 仍执行完整 pre-push，不合 main、不发布。代码 commit 与推送回执回填 `3-changelog.md`。

执行回执：代码提交 `6271ed9d02`，正常 push 完整 pre-push 退出 0 后已推送原 feature 分支。产品 patch 与获批冻结对象一致；提交内另含本次授权文档记录。日志 `/tmp/vcs-ignore-approved-push.log`，剩余验收与回退方式见 `3-changelog.md`。
