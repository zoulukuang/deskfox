feat-id: deskfox-vcs-refresh-overload
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-149 恢复实施

2026-11-14 用户授权按六项迭代计划开工。唯一执行会话为笑南的电脑 / Codex，分支继续 `fix/deskfox-vcs-refresh-overload`。接手记录已先推送。

## 基线与顺序

- 原分支头 `da1afba056`，主干 `fc96b0b5b5` 合入本分支为 `8d3d1c5cc7`。保留两端引用过的既有提交；唯一冲突为 features INDEX 同一插入点，保留双方条目。
- 第一笔：查询键按 TanStack 的内容哈希比较。先在真实 QueryClient / Solid 响应式环境复现同值新数组误丢刷新；再修正。新增不同目录、分支、默认分支、debounce 期间切换与合并事件用例。
- 第二笔：完成绝对路径 `.git/` 过滤。将旧谓词提到 fork helper，先复现 Mac / Windows 绝对路径漏拦截；修复后再验证相似目录、含字面百分号及 `#` 的路径不误判。仅在 `session.tsx` 增加导入与替换谓词（R1 第二级）；使用原始 OS 路径，不套用 URL 解码函数。
- 第三笔：完成 Git 忽略判定。先核对语义，不能仅拿文件树 ignored 字段过滤。
- 后续：app 回归与完整 pre-push，Mac local 对照；Windows 新代码验收独立交接。

## R1 与改前预清单

第一笔只改 fork 文件 `packages/app/src/pages/session/vcs-refresh.ts`，新增同目录 `vcs-refresh.test.ts`，以及本 feat 文档；无新依赖、无黑名单、无新增上游侵入。复用 TanStack `hashKey`，确保与查询缓存使用同一键相等语义。代码及测试预计不超过 150 行。

第一笔验收对应 1-spec T1/T6：相同内容的新数组仍补刷一次；真实切换丢弃旧待刷新；多事件合并；debounce 期间切换不刷新旧查询。测试层级为单元集成，不等同 Mac local 验收。

## 忽略判定调查

文件列表的 ignored 字段由 `handlers/file.ts` 读取项目根 `.gitignore` 和 `.ignore` 后计算，不检查 Git index，也未覆盖嵌套 `.gitignore`、全局 excludes 或 `.git/info/exclude`。用它直接抑制刷新会漏掉已跟踪文件，也会把仅被 `.ignore` 排除的有效 Git 变化漏掉。未知节点保守刷新也不能覆盖未展开的忽略目录。

因此该字段不能作为完整 Git 忽略判定依据。下一步评估 Git 原生批量判定的最小接入点；保留已跟踪文件、失败保守刷新、限制并发与请求规模，避免过滤本身制造新的积压。具体接口及 R4 影响评审后再落地。

## Large 审签与实现（2026-11-14）

整体前后端与测试超过 500 行，先停止过滤施工，整理 `4-ignore-design.md` 后由用户明确「批准两项施工方案，继续并行推进」。之后由笑南的电脑 / Codex 子 agent `vcs_ignore_design` 接手剩余过滤，父 agent 独立审核；此分工获用户明确允许并行 agent。

实际方案采用标准实例 HttpApi `POST /deskfox/vcs/refresh-required`，返回 `shouldRefresh`。Git helper 复用既有 Git.Service 与 Effect，前端经自动生成的 SDK 调用。无隐藏接口、无 Office 入口借用、无新依赖。

实际新增 7 个文件，修改 7 个产品/测试文件，共 +678/-6 行；比预计 625–820 行范围一致。HEAD 保留例外已经由 `ef9904415f` 先行修正；本次只扩为事件分类以便 HEAD 直接刷新、普通文件进入忽略判定。已有 `.git/` 断言未弱化成跳过用例，改为真正区分 HEAD 与无关元数据。

完整实现与自动化已通过，父 agent 与 MCP 子 agent 独立复核未见阻断。四个黑名单文件及生成审计见 `6-ignore-r4-review.md`。R4 实际 diff 未获批准前不提交产品代码；两端 local、真实负载对照和最终发布均仍待完成。
