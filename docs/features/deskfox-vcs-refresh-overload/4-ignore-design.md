# REQ-149 Git 忽略判定实施建议

记录：笑南的电脑 / Codex 子 agent，2026-11-14。只读源码与临时 Git 仓实验；本文件是待主 agent 复核的方案，不表示接口已实现或 R4 已获批准。

施工批准（2026-11-14）：用户明确「批准两项施工方案，继续并行推进」。接手中（笑南的电脑，Codex 子 agent `vcs_ignore_design`，2026-11-14）：在原 `fix/deskfox-vcs-refresh-overload`、HEAD 例外修正 `ef9904415f` 之上完成剩余忽略过滤。下文方案已获施工批准；R4 实际 diff 待测试与独立复核后提交用户确认。

## 整体规模与施工闸

进一步拆解后，完整 Git 忽略过滤很可能令本 feat 超过原 spec 的 Medium 预估。不能按“先做独立 helper”拆阶段规避 Large 审签；本轮因此未新增产品模块或持久化测试文件，仅保留此设计与临时 Git 实验。

| 本轮完整交付构成 | 预计代码及测试行数 |
| --- | --- |
| 主 agent 已完成的查询键 / `.git/` 过滤与 21 条测试 | 约 130 |
| Git 判定 helper（边界、原生命令、HEAD 保护、超时与失败回退） | 80–110 |
| 配套真实 Git fixture 测试 | 150–200 |
| group + handler + 两处注册 | 65–90 |
| 前端有界批处理与生命周期处理 | 70–100 |
| 前端异步/溢出/错误/切换测试 | 90–130 |
| e2e 忽略与混合事件回归 | 40–60 |
| **合计** | **约 625–820** |

这还不包含既有 `8d979a0a9b` 的实现及文档。应将 `1-spec.md` 的规模调整为 Large，按 CLAUDE.md 在新增过滤实现前交用户审签；R4 的具体 diff 复核另在测试完成、提交前执行。上表是完整需求估算，不以单笔 commit 低于 500 行替代规模判断。

拟议文件预清单（尚未创建）：`packages/opencode/src/project/vcs-refresh-required.ts`、`packages/opencode/test/project/vcs-refresh-required.test.ts`、同级 HTTP `groups/vcs-refresh.ts` / `handlers/vcs-refresh.ts`；前端新增 `vcs-refresh-filter.ts` 与测试。现有上游注入点为 `api.ts`、`server.ts`、`packages/app/src/pages/session.tsx`。原 e2e 文件补用例；若最终新增文件与此不同，应先回填理由。

供审签的具体决策：采用下述标准实例 API、Git 原生忽略 + HEAD 保护、失败保守刷新与有界前端合并；保留所有原 watcher 事件；不提前移植批量 Git diff 或通用队列；验收覆盖本文清单和原 T1–T10，两端 local 验收仍是完成条件。审签并不表示允许合 main 或发布。

## 结论与入口

建议保留现有文件事件，前端在触发 VCS 刷新前将路径合并成小批次，由后台用 Git 原生命令返回 `{ shouldRefresh: boolean }`。只在全部路径确定为无关时抑制刷新。后台判定失败、输入异常、前端请求失败均回退到现有 `createVcsRefresh`，不丢变化。

- `packages/core/src/filesystem/watcher.ts:86` 的 callback 将 Parcel 更新发布为 `file.watcher.updated`。不能在这里直接丢 Git 忽略事件：文件树与已打开文件预览也依赖它们，Git 忽略不表示用户不需要看文件更新。
- `packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts:81` 的 ignored 标记只合并项目根 `.gitignore` 与 `.ignore`，缺嵌套规则、Git index、全局 excludes 与 `.git/info/exclude`，不可用作“无需刷新”的证明。
- `packages/opencode/src/server/routes/instance/httpapi/api.ts:61` 的 `InstanceHttpApi` 是现有实例接口注册点；`server.ts:154` 的 `instanceApiRoutes` 是对应 handler 注册点。两者在 `upstream-base` 均存在，属于 R4 黑名单文件。
- 没有找到语义合适的现成 fork-only 路由注册入口。不要把此功能挂入 Office 路由以回避 R4。

## 最小接口建议

`POST /deskfox/vcs/refresh-required`，请求 JSON `{ paths: string[] }`，响应 JSON `{ shouldRefresh: boolean }`。

1. 使用新的 fork-only `groups/vcs-refresh.ts` 声明 `HttpApi` / `HttpApiGroup` / endpoint，新的 `handlers/vcs-refresh.ts` 实现 `HttpApiBuilder.group(...)`；Git 判定可以放在 fork-only `project/vcs-refresh-required.ts`。
2. group 复用 `WorkspaceRoutingQuery`、`InstanceContextMiddleware`、`WorkspaceRoutingMiddleware`、`Authorization`，与同级实例 API 一致。工作目录来自 `InstanceState.context.directory`，不接受客户端任意指定命令 cwd。远程实例由原工作区路由处理，不在客户端本机执行 Git。
3. 在 `api.ts` 增加 import + `.addHttpApi(VcsRefreshApi)`；在 `server.ts` 增加 import + handler layer 注册。两处各约 2 行代码，另加 FORK marker。逻辑全部在新文件，属于 R1 第 2 级。
4. 输入最多 128 个去重路径；单路径最多 4096 字节，总路径字节最多 64 KiB。超限的前端批次直接合并刷新一次，后台超限/格式异常报参数错误并由前端保守刷新。schema 声明边界，不能仅依赖前端校验。
5. 路径是 JSON 中的原始文件路径，不能再 URL decode。服务端使用本机路径规则将绝对路径或相对路径归一到实例目录下；拒绝 NUL、目录外路径、空路径，根目录事件直接返回 true。不做全盘搜索，不跟随符号链接读取文件内容。
6. 使用现有 `Git.Service.run`，稳定服务在构建 handler 时获取，实例目录在请求时取；不拼 shell 字符串。路径转实例相对路径后加 `./`，用 NUL 分隔的 stdin 传 `check-ignore`，避免 `-`、冒号、空格和换行的特殊解释。
7. 整次后台判定建议设 1 秒截止；超时要中断子进程，而不只是放弃 await。Git 输出设 128 KiB 上限，任何截断/异常均返回 true。前端 1.5 秒截止，失败走现有合并刷新。用实际 AppProcess/Effect 取消测试确认没有遗留 Git 子进程。

以上选择会将接口加入现有 OpenAPI，不能把它描述为完全没有契约变化。按仓库生成规约运行生成并检查差异；不要手编生成文件。当前 `packages/client/src/contract.ts` 来自 `@opencode-ai/protocol/api`，与这里的 legacy InstanceHttpApi 不是同一棵树；`packages/sdk/js/script/build.ts` 才通过 `bun dev generate` 消费整体 OpenAPI。需分别核实生成结果，避免把“运行了新 client generate”误报为覆盖 legacy 契约。前端如用现成授权 fetch 包装调用，也不能据此省略 API 合同验证。

可选的更小接入是 fork-only 独立 HttpApi layer 加 `server.ts` 两行注入，仅服务私有桌面接口；但这改变了现行“统一 OpenAPI 列举接口”的维护方式。为省一个注册文件而新增隐藏接口不值得，本方案不推荐。

## Git 判定与 HEAD 保护

1. 对去重路径运行 `git check-ignore --stdin -z`，**不加 `--no-index`**。默认行为会保留 index 已跟踪文件，也会保留含已跟踪后代的目录；嵌套 `.gitignore`、全局 excludes 与 `.git/info/exclude` 由 Git 自己处理。
2. 返回码 1 表示没有命中，返回 true。返回码非 0/1、stderr 有错误、输出截断、输出路径异常也返回 true。返回码 0 时，用原样回显路径集合比较；只要有一个输入未出现在 ignored 集合中，返回 true。
3. **全部命中 ignored 仍不能立即返回 false**：文件可能刚由 `git rm` 从 index 移除，但它在 HEAD 中的 staged deletion 仍应显示。继续运行 `git --literal-pathspecs ls-tree -z --name-only HEAD -- <本批相对路径>`，不递归、不读取工作文件内容。任何输出返回 true；成功且无输出才能返回 false。
4. `ls-tree` 对候选目录会输出 HEAD 的目录条目，因此保守保护已跟踪后代，不需要遍历全部文件。它可能让“HEAD 中有其他已跟踪后代的忽略目录事件”多刷一次，这是允许的保守退让。
5. HEAD 不存在、Git 不可用、非 Git 仓、权限/IO/输出错误或路径穿过符号链接等情况返回 true。unborn 仓可能因此仍刷新；这是失败保守刷新边界，不能声称在没有 HEAD 时也做到了零请求。
6. 不缓存 ignored=true：忽略规则与 index/HEAD 随时会变化。`.gitignore` 本身变化需要照常刷新。路径判定只是 VCS 刷新的门，不改变其他事件消费者。

### 已执行的真实 Git fixture

临时仓包含 `.gitignore` 内容 `ignored/` 与 `*.log`，强制跟踪 `ignored/tracked.txt` 与 `tracked.log`，另有 `ignored/untracked.txt`。所有操作均在 `TemporaryDirectory` 中，离开后自动清理，未碰用户项目。

| 状态 | 输入 | 实际结果 |
| --- | --- | --- |
| 已加入 index | `./ignored`、`./ignored/`、`./ignored/tracked.txt`、`./tracked.log` | `check-ignore` 均不输出；已跟踪文件与目录后代受到保护 |
| 未跟踪忽略项 | `./ignored/untracked.txt`、`./absent.log` | 输出这两个路径，NUL 分隔 |
| 仅从磁盘删除，index 仍在 | 已跟踪文件路径 | 仍不输出，普通删除不会漏刷 |
| commit 后 `git rm` 两个已跟踪文件 | `./ignored`、`./ignored/tracked.txt`、`./tracked.log` | 三个都被 `check-ignore` 输出，证明仅查 index 会漏 staged deletion |
| 同一 staged deletion 状态 | `ls-tree -z --name-only HEAD -- ./ignored ./tracked.log` | 输出 `ignored` 与 `tracked.log`，HEAD 保护有效 |

这些是 Git 命令语义实验，不是产品集成测试或两端桌面验收。

## 前端有界合并

- 新 fork-only helper 维护一个路径 Set、一个 100ms 合并定时器和至多一个进行中判定。不得每个文件事件发一个 HTTP 请求。
- 判定期间的新事件合并进下一批；Set 超过 128 路径或 64 KiB 时清空为“需要刷新”标记，不继续保存无限路径，不切成无限待发 HTTP 队列。
- 判定返回 true、溢出或错误时调用现有 `createVcsRefresh`，继续受“一条 diff 在途、结束补刷一次”保护。全部 ignored 返回 false 时不发 diff。
- 每批绑定当前查询键内容与工作目录；查询键变化/组件卸载后，迟到判定不刷新新项目。新项目事件单独建批，旧请求取消与清理要测。
- 保持 `.git/` 过滤 helper 与原文件事件消费者分离。**规范化的根 `.git/HEAD` 事件必须直接进入现有合并刷新，跳过后端忽略判定**：detached HEAD 切换提交时 branch 名仍为 undefined，既有 VCS BranchUpdated 不会发送。不能因 query key 未变就吞掉 HEAD 变化。HEAD 是 Git 元数据而非工作区文件，不送入 `check-ignore`；其余无关 Git 元数据仍过滤。详见 `5-frontend-review.md` 的真实 Git 实验。
- 验证两类并发分别至多 1：忽略判定 HTTP 与 diff HTTP。不能把总数 2 误报成全应用只有 1 个连接；这也不是通用请求队列或跨多窗口的全局限流。

## R1 / R4 逐文件理由

| 文件 | 预计变动 | 为什么不能仅用 wrapper 替代 | 风险与控制 |
| --- | --- | --- | --- |
| `packages/opencode/src/server/routes/instance/httpapi/api.ts` | import + 注册新 group | 类型化 HttpApi 是封闭注册树；外部文件不注册就不会进入现有 API 合同。复用无关 Office group 会破坏归属。 | additive endpoint，原路径/参数不变；检查 OpenAPI、鉴权与实例中间件，生成结果审计 |
| `packages/opencode/src/server/routes/instance/httpapi/server.ts` | import + 注册 handler layer | API 声明不会自动发现实现；不提供 handler layer 无法服务请求。 | 同级注册沿用已有层级，不重建服务图；路由启动与旧 API 冒烟 |

两文件均通过 `git cat-file -e upstream-base:<path>` 证实是上游既有文件，触发 R4。新 helper/group/handler/test 属 fork-only，按现有 hook 动态豁免；`packages/app/src/pages/session.tsx` 为前端注入文件，仍需 R2 marker。提交前出完整 diff 与测试结果，按 CLAUDE.md 的 R4 完成复核与必要签字，不以范围批准冒充具体 override 批准。

## 最低新增测试

- 真实临时 Git 仓：根/嵌套 `.gitignore`、否定规则、`.git/info/exclude`、隔离 HOME 下的 global excludes；仅 `.ignore` 不应抑制。
- force-added 已跟踪文件及其父目录，普通删除与 `git rm` staged deletion，HEAD 目录保护，规则改变后下一批重新判定。
- 空格、中文、换行、冒号开头、字面 `-` 文件名；NUL/越界路径拒绝，非仓库/unborn/超时/输出截断保守返回 true。
- 真实 HTTP：鉴权、实例目录/工作区路由、输入上限、错误合同；不得通过请求 path 访问项目外路径。
- 前端：只有 ignored 事件零 diff；ignored+tracked 混合只补刷一次；慢判定期间密集事件最多一条判定在途；Set 溢出不无限排队；迟到结果不串项目；失败调用合并刷新。
- 保持文件预览刷新回归：ignored 文件已打开时仍收到原事件并更新内容。
- 原 T1/T2 与两端 local 负载对照继续执行；Windows 结果只能由 Windows 电脑记录。
