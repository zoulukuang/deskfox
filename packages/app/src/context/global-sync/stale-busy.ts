// FORK-ONLY: REQ-100 ②③ 残留 busy 判定(纯逻辑)
// [feat: release-closeout-2026-09] 2026-09-17 · 2026-09-18 修正目录作用域
//
// 从 server-sync.tsx 的忙闲对账里抽出的决策部分,便于单测(R5 双清单:Logic 清单)。
//
// 背景 —— 为什么需要它:
//   2026-08-18 真机,后端 respawn 后前端重连并重跑了 6 个目录的 bootstrap,但出事的那个目录
//   被 child store 的 eviction 挤掉了,而重连对账的循环有 `if (!children.active(dir)) continue`,
//   于是它永远拿不到对账,名下会话的残留 busy 永不清除(实测卡 ≥38 分钟)。
//
// 🔴 2026-09-18 修正(发版前 code-review 抓出,首版是**更糟的回归**):
//   首版基于一个**错误前提** —— 「后端 SessionStatus 是一张全局表」。它不是:
//     · `packages/opencode/src/effect/instance-state.ts:47` 的 `InstanceState.get` =
//       `ScopedCache.get(cache, yield* directory)` → **按 directory 分桶**
//     · `packages/opencode/src/session/status.ts` 的表就建在 `InstanceState` 上 → 每个目录一张
//     · `/session/status` 挂在 `routes/instance/` 下,不带 directory 就只命中服务端默认 cwd 那个 instance
//   而前端的 `session_status` 是**跨目录共享的单表**(证据:`global-sync/bootstrap.ts:410` 那段
//   既有清理特意写了 `if (session.get(id)?.directory === input.directory)` 守卫)。
//   首版丢掉了这道守卫 → 拿 A 目录的表去清 B 目录的 busy → **把别的项目里正在生成的会话打成 idle**
//   (spinner 与停止按钮当场消失,模型还在跑);默认目录下若无会话,则所有目录每 60 秒被清一次。
//   比它要修的原 bug 更糟:原 bug 是"该清的没清",首版成了"不该清的也清"。
//
//   教训:一个语义在单个目录内成立,不等于它全局成立。前人加守卫是有理由的,
//   看不出理由时先照做,别先重构。
//
// 现在的语义:调用方按「本地 busy 会话所属的目录」逐个查 status(evict 过的目录也照查,
// 因为目录是从会话本身推出来的、不依赖 child store),然后**只清本次真的查过的那些目录**名下的会话。

export type LocalSessionStatus = { type: string } | undefined

export type StaleBusyInput = {
  /** 本地缓存的会话忙闲表(跨目录共享的单表) */
  local: Record<string, LocalSessionStatus>
  /** 后端权威表(已按目录查完并合并):sessionID → 是否非 idle。缺席即 idle */
  remote: Record<string, boolean>
  /** 该会话是否有未确认的乐观消息(刚发出、后端还没登记) */
  pending: (sessionID: string) => boolean
  /**
   * 该会话属于哪个目录。拿不到(会话未加载)返回 undefined。
   * 与 `bootstrap.ts` 既有清理同一判据:`session.get(id)?.directory`。
   */
  directoryOf: (sessionID: string) => string | undefined
  /**
   * 本次**真的查过** status 的目录集合。只有落在这里面的会话才允许被清 ——
   * 没查过的目录不能拿别处的表去判它空闲。
   */
  coveredDirectories: ReadonlySet<string>
}

/**
 * 挑出「本地显示忙、后端说不忙」的会话 —— 这些就是要被清成 idle 的残留。
 *
 * 五条不清的情形:
 *   ① 本地本来就不是 busy —— 没什么可清
 *   ② 后端也说忙 —— 人家真在跑
 *   ③ 有未确认的乐观消息 —— 这一发还在飞。前端已乐观置 busy、后端还没登记进 status 表,
 *      此刻清理会把正在发送的会话错误清掉转圈
 *   ④ **查不出它属于哪个目录** —— 无法确认它在本次覆盖范围内,一律不动(fail-safe)
 *   ⑤ **它的目录本次没查过** —— 别拿 A 目录的表去判 B 目录的会话空闲(🔴 首版就栽在这)
 */
export function collectStaleBusySessions(input: StaleBusyInput): string[] {
  const stale: string[] = []
  for (const [sessionID, status] of Object.entries(input.local)) {
    if (status?.type !== "busy") continue
    if (input.remote[sessionID]) continue
    if (input.pending(sessionID)) continue
    const directory = input.directoryOf(sessionID)
    if (!directory) continue
    if (!input.coveredDirectories.has(directory)) continue
    stale.push(sessionID)
  }
  return stale
}

/**
 * 反向:挑出「后端说忙、本地却不忙」的会话 —— 这些要被恢复成 busy。
 *
 * FORK 2026-09-18 —— 对账必须是**双向**的。
 * [bug-repro: REQ-100 ① 的停止键兜底在 4s 后把 session_status 写成 idle,注释写「重连/周期对账会把
 *  真实状态盖回来」,但当时对账只有上面那个单向函数(busy→idle),`seedActiveSessionStatuses` 又
 *  显式跳过**已定义**的键(`if (... !== undefined) continue`),后端也只在状态**跃迁**时推事件 ——
 *  三条路都不会把 busy 写回来。于是后端还在跑(interrupt 响应 >4s)时前端已自认 idle,
 *  `session.tsx` 的 `queueEnabled` 读同一个 store 判为不忙 → 用户下一条消息**绕过队列直接 prompt**,
 *  与仍在运行的那一轮并发。]
 *
 * 🔴 2026-09-18 第三轮 code-review 修正 —— 首版这两道守卫都不够:
 *
 *   (a) 只跳过 `type === "busy"`,于是把 **retry** 也当成「本地不忙」补成 busy。
 *       `SessionStatus` 是三态,`retry` 还带 `attempt` / `message` / `action` / `next` 负载,
 *       被倒计时横幅、配额超限升级 CTA、时间线 retry 行消费;调用方是 `{type:"busy"}` **整体覆盖**,
 *       一补就把负载抹光 → 限流提示与升级入口当场消失,退化成普通转圈。
 *       退避常达数分钟而对账 60 秒一轮 —— 几乎必中。
 *       改为判「本地已非 idle」:语义是「本地已经显示它在动」,**不枚举具体状态**,
 *       将来新增第四态自动受保护。`seedActiveSessionStatuses` 早有同款不变量
 *       (跳过一切已定义的键),这里补齐到同一水位。
 *
 *   (b) 对**前端不认识**的会话(CLI 起的 / 子 agent 的 / 尚未加载 info)也照补 busy,
 *       而正向清理第一道守卫就是 `if (!directory) continue` —— 正向永远够不着它。
 *       后端转 idle 后这条 busy 再也清不掉,还因非 idle 被 `server-session.ts` 的 LRU
 *       `preserve` 永久钉住:**反向方向自己造出了 REQ-100 要消灭的那种幻影 busy**。
 *       改为要求 `directoryOf` 能定位 —— 两个方向的可达性必须对称:
 *       **凡是补得进来的,就必须清得掉**。不认识的会话本来也不渲染在任何界面上,补了无收益、只有风险。
 *
 * 三条不恢复的情形:
 *   ① 本地已经不是 idle —— 已经在显示"它在动"了,别拿粗状态去覆盖细状态
 *   ② 有未确认的乐观消息 —— 与上面同一道竞态护栏,该会话状态正在飞,别插手
 *   ③ 查不出它属于哪个目录 —— 补进来就再也清不掉(见上 (b))
 *
 * 注:这里**不**需要 `coveredDirectories` 守卫,那是正向专属的。
 * `remote` 条目本就只来自查成功的目录,「后端说它忙」是正面证据;
 * 正向是从本地表反推「后端没说它忙」,缺席才存在「没查过」的歧义。
 */
export function collectMissingBusySessions(input: StaleBusyInput): string[] {
  const missing: string[] = []
  for (const [sessionID, isBusy] of Object.entries(input.remote)) {
    if (!isBusy) continue
    const local = input.local[sessionID]?.type
    if (local && local !== "idle") continue
    if (input.pending(sessionID)) continue
    if (!input.directoryOf(sessionID)) continue
    missing.push(sessionID)
  }
  return missing
}
