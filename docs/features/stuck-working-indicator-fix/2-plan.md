feat-id: stuck-working-indicator-fix
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# stuck-working-indicator-fix — plan

## 诊断轨迹(证据链)

排查从"DeskFox 两个运行中任务点停止无效"起,逐步收敛到唯一根因:

1. **进程层**:ps/lsof 发现两个 `claude --output-format stream-json` 子进程(DeskFox sidecar `opencode-cli` 拉起),`S` 睡眠、~0% CPU、阻塞在 stdin unix socket。**没在跑**,是 idle 等输入。
2. **会话层**:两进程对应的 claude session jsonl 最后一条 `stop_reason=end_turn`,之后数小时无写入 → 那一轮早正常生成完。
3. **存储层**(决定性):user 彻底杀 DeskFox 重开、子进程全没,但某 session 旋转图标仍在 → 状态不依赖活进程,是从**持久化消息数据**推导。
4. **前端判定**:`sidebar-items.tsx:159 isWorking()` 的 `pending = messages.findLast(m => assistant && time.completed 非 number)`,扫到任何残骸即转圈。
5. **DB 实证**:卡住 session `ses_167cc105` 含一条 assistant 残骸 `msg_e989c84e6001`(00:27:35,parts=`step-start,text,tool`,**无 step-finish、无 time.completed**),且它是历史消息(后面 09:19/09:23 还有正常完成消息)→ `findLast` 永久命中 → 永久转圈。其余 claude-code 会话都正常盖了 completed,故只此 session 转。
6. **机制**:`processor.ts:641` 的 `cleanup()` 经 `Effect.ensuring` 收尾盖 `time.completed`,正常 abort/error 都覆盖;**唯一漏盖 = 进程被 OS 硬杀**(SIGKILL/崩溃/休眠),Effect finalizer 来不及跑。残骸创建于 00:27、孤儿进程 00:29 起,正是硬中断时点。
7. **影响面**:活跃 `opencode.db` 审计出 **7 个** session 带残骸(2 个埋历史=永久转,5 个最后一条=多为飞书桥接 session)→ 反复积累、provider 无关。

## 关键决策

- **层级**:DeskFox 机制问题(sidecar 后端 + 前端),**不改 claude-code 插件**。残骸是硬杀通用缺口,飞书桥接也中招。user 拍板"双层修复"。
- **后端自愈 hook 点**:选前端面向的 `messages` server handler(已持有 `session` + `statusSvc`),不动 `Session.messages`(被 runLoop 内部调用,改它有循环依赖 + 误伤在途风险)。busy 守卫保证直播流式中不补盖在途消息。
- **盖戳值**:`completed = created`(保留原始时序,不用 Date.now() 伪造巨长时长)。
- **返回修正数组**:handler 返回 heal 后的消息,前端本次加载即收口,不必等下次/SSE。
- **纯函数抽离**:`findInterrupted` + `planHeal`(后端)、`deriveSessionWorking`(前端)全做成纯函数进 Logic 清单,Effect/组件壳只剩副作用,单测零接线。
- **不混入本次**:① claude-code 持久子进程不回收 ② 真实活跃任务 abort 未接 `proc.kill` —— 两条独立链路,各自 follow-up(P4 可逆,一笔 commit 一件事)。

## 验证现实约束

- dev installer channel 用 `opencode-dev.db`,user 卡住的 session 在 prod `opencode.db` → dev 包看不到该 session。
- 故:代码正确性靠单测 + 既有 session/server 回归(均绿)保障;user 当前那个 prod 卡住图标,用同一 heal 逻辑直接补盖 `opencode.db` 残骸消息(幂等数据修复)即时清除,不必等 prod 重装。
