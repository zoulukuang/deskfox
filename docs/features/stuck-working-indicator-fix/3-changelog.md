feat-id: stuck-working-indicator-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# stuck-working-indicator-fix — changelog

## 一句话

修复会话列表"运行中"旋转图标永久卡死:进程被硬杀(SIGKILL/崩溃/休眠)时正在生成的 assistant 消息漏盖 `time.completed`,留下永久"未完成"残骸消息,前端把它判为运行中。双层修复 —— 后端 `messages` handler idle 时自愈补盖 + 前端 `isWorking` 只看最后一条消息。DeskFox 机制问题,不碰 claude-code 插件。

## commit 列表

| commit | 简述 |
|---|---|
| `c7eb95ce2` | `fix(session): 残骸消息致"运行中"图标永久卡死 — 后端 idle 自愈补盖 time.completed + 前端 isWorking 只看末条 [feat: stuck-working-indicator-fix]` |

## 改动文件

| 文件 | 变更 | 说明 |
|---|---|---|
| `packages/opencode/src/session/heal-interrupted.ts` | 新增 78 行(fork-only) | `findInterrupted` + `planHeal`(纯函数,Logic 清单)+ `healInterrupted`(Effect 壳:idle 时补盖 `completed=created` 并持久化,返回修正数组) |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` | +5 / -1(FORK 块) | `messages` handler 无 limit 分支返回前调 `healInterrupted`(busy 守卫不误伤在途) |
| `packages/app/src/pages/layout/session-working.ts` | 新增 29 行(fork-only) | `deriveSessionWorking` 纯函数:pending 只看最后一条消息 |
| `packages/app/src/pages/layout/sidebar-items.tsx` | ~改 13 行(FORK) | `isWorking` createMemo 改调 `deriveSessionWorking`(原 findLast 扫历史残骸 → 改只看末条) |
| `packages/opencode/test/session/heal-interrupted.test.ts` | 新增 104 行 | 7 个单测(用例 1-5 + 边界) |
| `packages/app/src/pages/layout/session-working.test.ts` | 新增 49 行 | 7 个单测(用例 6-8 + 边界) |
| `docs/features/stuck-working-indicator-fix/{1-spec,2-plan,3-changelog}.md` | 新增 | 三文档 |

## 根因

进程被 OS 硬杀时,`processor.ts:641` 经 `Effect.ensuring(cleanup())` 盖 `time.completed` 的 finalizer 来不及跑 → assistant 消息永久缺 `completed`。前端 `isWorking()` 用 `findLast(任意缺 completed 的 assistant)` 判运行中 → 扫到埋在历史里的残骸 → 图标永久转、杀进程重开仍在(残骸持久化在 DB)、点停止无效(后端无活跃任务)。provider 无关(飞书桥接 session 同样中招),全库审计 7 个残骸 session。详见 1-spec / 2-plan。

## 测试

- 后端 `heal-interrupted.test.ts` 7 pass(findInterrupted 识别/不误判/多条 + planHeal idle 补盖/busy 跳过/无残骸不动/正常消息引用不变)。
- 前端 `session-working.test.ts` 7 pass(历史残骸不转/末条在途转/busy·retry 转/idle 不转/权限优先/空消息)。
- 回归:`test/session/`(302 pass)+ `test/server/session-messages`(4)+ `httpapi-session`(8)全绿,无连带破坏。
- 两端 typecheck 通过。

## 影响范围 / 回退

- 上游文件 2 个改动(sidebar-items.tsx 加 FORK 块;handlers/session.ts 加 FORK 块),均加 FORK marker(R2)。
- **R4 override 1 笔**(commit 标 `[override-blacklist]`,user 复核批准 2026-06-06):pre-commit 路径黑名单覆盖整个 `packages/opencode/` 目录,本笔触动其下 3 文件 → 触发 R4。逐文件论证:
  - `handlers/session.ts` — 真上游改动。`messages` handler 是上游唯一返回完整消息列表给前端的咽喉点,残骸自愈必须卡在「读出→返回」之间,无 append-only 扩展点可走 wrapper(R1 二级标准注入:+2 import +4 调用点,均带 marker,净侵入 ~5 行)。
  - `session/heal-interrupted.ts` / `test/session/heal-interrupted.test.ts` — 纯 fork-only 新文件(P1),不改任何上游逻辑;只因落在 `packages/opencode/` 目录被路径黑名单误伤(hook 无法区分「改上游」vs「上游包内加新文件」)。
- 新增 fork-only 文件 2 个(P1 隔离)。
- 回退:`git revert` 本 commit。残骸补盖是幂等数据修复(只补本该有的 completed),无破坏性。

## 现存 / 衍生 follow-up(不在本次)

- claude-code 持久子进程不回收(孤儿 claude 进程)— 插件层 provider 生命周期。
- 真实活跃任务点停止杀不掉子进程(abort 未接 `proc.kill`)— 独立链路。
- L2 改动须进 sidecar binary 才生效(build-deskfox.sh 时间戳判断会触发重建);user prod 当前卡住图标用同一 heal 逻辑直接补盖 `opencode.db` 残骸即时清除。
