feat-id: stuck-working-indicator-fix
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# stuck-working-indicator-fix — spec

## 一句话

会话列表"运行中"旋转图标永久卡死:某 session 被硬杀(SIGKILL/崩溃/休眠断电)时,正在生成的 assistant 消息没来得及盖 `time.completed`,留下永久"未完成"残骸消息 → 前端 `isWorking()` 把任何缺 `completed` 的 assistant 消息判为运行中 → 图标永久转、杀进程重开仍在、点"停止"无效(后端根本没有活跃任务)。双层修复:① 前端 `isWorking()` 只看最后一条消息;② 后端 `messages` handler 在 session idle 时给残骸补盖 `time.completed`(自愈现有坏数据 + 防复发)。

## 现象(user 报告)

1. DeskFox 两个"运行中"任务点停止无效。
2. 彻底杀 DeskFox 重开后,两个 claude 子进程都没了,但 OPENCODE-PLAN 下某 session 的"运行中"图标仍在转。
3. 该图标应消失。

## 根因(诊断已确认,证据见 2-plan.md)

- claude-code provider 一轮生成被**硬中断**(进程被 OS 杀,Effect `Effect.ensuring(cleanup())` finalizer 来不及跑),assistant 消息 `time.completed` 永久缺失,parts 停在 `step-start,text,tool`(无 `step-finish`)。
- 前端 `packages/app/src/pages/layout/sidebar-items.tsx:159 isWorking()`:
  ```ts
  const pending = messages.findLast(m => m.role === "assistant" && typeof m.time?.completed !== "number")
  return pending !== undefined || status?.type === "busy" || ...
  ```
  `findLast` 扫到**任何**(含埋在历史里的)残骸 → 永久 working。
- 残骸消息持久化在后端 DB,所以全杀重开照样转。别的 claude-code 会话正常盖了 `completed` → 不转,印证只跟残骸数据有关,非单纯 finish 缺失。
- 全库审计(2026-06-06):活跃 `opencode.db` 有 **7 个** session 带残骸消息(2 个埋历史里=永久转,5 个最后一条=多为飞书桥接 session)。→ 反复积累的稳定性问题,provider 无关。

## 层级结论

**DeskFox 机制问题,不改 claude-code 插件。** 残骸源于硬杀时通用收尾缺口(飞书桥接 session 也中招),呈现完全在自己掌控的两层(opencode sidecar 后端 + DeskFox 前端)。

## 修复方案

### L1 前端(packages/app/src/pages/layout/sidebar-items.tsx)
`isWorking()` 的 `pending` 信号改为**只判最后一条消息是不是未完成的 assistant**(直播流式中在途消息恒为最后一条,语义不变;埋在历史里的残骸不再触发)。`session_status` 分支保持不变。

### L2 后端自愈(新 fork-only 文件 + handler 注入)
- 新文件 `packages/opencode/src/session/heal-interrupted.ts`:
  - 纯函数 `findInterrupted(messages): MessageV2.Info[]` — 返回 `role==="assistant" && typeof time.completed !== "number"` 的消息(Logic 清单,单测覆盖 ≥80%)。
  - Effect `healInterrupted({ sessionID, messages, session, status })` — 仅当 `status.get(sessionID).type === "idle"`(无活跃 runner)时,对每条残骸 `time.completed = time.created` 并 `session.updateMessage` 持久化(发 Updated 事件,连着的 UI 自动刷新);返回修正后的消息数组。
- 注入点 `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` 的 `messages` handler(line ~116,无 limit 分支 = 前端展示用):返回前调 `healInterrupted`。busy 守卫保证直播流式中(session busy)不误伤在途消息。

### 不在本次范围(单独 follow-up)
- claude-code **持久子进程不回收**(孤儿 claude 进程)— 插件层 provider 生命周期问题,另开。
- **真实活跃任务点停止杀不掉子进程**(abort 未接 `proc.kill`)— 另开。
  > 本次只治"残骸导致的假运行中图标";上面两条是独立链路,不与本次混用一笔 commit(P4 可逆)。

## 验收标准 / 测试用例清单(R8,动工前锁定)

| # | 验什么 | 层级 | 预期 |
|---|---|---|---|
| 1 | `findInterrupted` 识别残骸 | unit(Logic) | 含 1 条无 completed 的 assistant + 若干正常 → 只返回那 1 条 |
| 2 | `findInterrupted` 不误判 | unit(Logic) | 全部有 completed / 纯 user 消息 → 返回空 |
| 3 | `findInterrupted` 多条残骸 | unit(Logic) | 2 条无 completed → 返回 2 条 |
| 4 | `healInterrupted` idle 时补盖 | unit | status=idle + 1 残骸 → updateMessage 被调,completed=created |
| 5 | `healInterrupted` busy 时跳过 | unit | status=busy → updateMessage 不被调(不误伤在途) | 
| 6 | 前端 `isWorking` 埋历史残骸不转 | unit/逻辑 | 末条已完成、历史有残骸 → false |
| 7 | 前端 `isWorking` 在途仍转 | unit/逻辑 | 末条是未完成 assistant → true |
| 8 | 前端 `isWorking` busy 状态仍转 | unit/逻辑 | session_status=busy → true |
| 9 | 回归:正常一轮对话结束图标收口 | 真桌面手测 | claude-code 跑完一轮,图标还原(user 验) |
| 10 | 自愈现有坏 session | 真桌面手测 | build 新 sidecar + 重开,打开卡住 session,图标消失(user 验) |

> 运行时·native 风险点:L2 改动须进 **sidecar binary**(`build-deskfox.sh` 仅在 sidecar 不存在时 build,见 memory sidecar 过期陷阱)→ 验证前确认 sidecar 时间戳已更新。L1 是前端,走 app build。

## 影响范围 / 回退

- 上游文件改 2 个(sidebar-items.tsx 已有 1 FORK marker;handlers/session.ts 新增 FORK 块),均非黑名单,加 FORK marker 即可(R2),无需 R4。
- 新增 fork-only 文件 1 个(纯隔离,P1)。
- 回退:`git revert` 本 feat commit;残骸补盖是幂等数据修复,无破坏性(只把缺失的 completed 补上)。
