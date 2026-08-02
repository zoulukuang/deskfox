feat-id: renderer-snapshot-oom
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-087 renderer 状态快照 OOM + 磁盘写入超限 — spec

> 来源:OPENCODE-PLAN 需求计划/2026-08-02.md(稳定性专项)+ 需求池/renderer状态快照OOM-磁盘写入超限崩溃.md。
> 证据:Crashpad dump ×2(V8 堆 3.9GB,`stringify` 栈顶,29s 连环崩)+ macOS 磁盘写入超限 .diag ×2。
> user 2026-08-02 授权「规划好之后直接进入开发」,按批次评估中的推荐方案施工。

## 根因(主仓实读坐实,2026-08-02)

1. **写入频率**:renderer 任意状态变更 → `makePersisted` 全量 `JSON.stringify` → IPC `store-set`(`desktop/src/main/ipc.ts:103`)→ electron-store **整文件同步重写**,无任何防抖。打字每个键都重写 workspace .dat。
2. **体积根子**:`ImageAttachmentPart.dataUrl`(base64)进 persisted prompt store;**prompt-history(global .dat)最多 100 条、每条完整克隆含 dataUrl 的 prompt**(`history.ts:34-44`)→ 含截图历史可达 GB 级,长跑后 stringify 顶破 V8 4GB。
3. **连环崩**:启动恢复 `normalize()` parse + merge 后再 stringify 一次(`persist.ts:206-212`),超大快照一开就炸。

## 方案(四件套)

| # | 措施 | 落点 | 治什么 |
|---|---|---|---|
| A | 桌面端 .dat 写入节流(trailing throttle ~800ms,窗口关闭/隐藏时 flush) | `packages/app/src/utils/persist.ts`(FORK 标记) | 磁盘写入超限 |
| B | prompt-history 不再存图片 part(prepend 时剥离;存量 migrate 清洗缩容) | `packages/app/src/components/prompt-input/history.ts` + `prompt-input.tsx`(FORK 标记) | 堆 OOM 大头 + global.dat 体积 |
| C | 单条快照体积熔断(>16M chars 拒写 + warn,内存态不受影响) | `persist.ts` | 防单会话把 .dat 撑到百 MB 级 |
| D | 主进程连环崩自愈:窗口期内重复 renderer 崩溃 → 隔离(改名 .bak-时间戳)快照 .dat → reload | fork-only `packages/desktop/src/main/deskfox/renderer-crash-guard.ts` + `index.ts` ≤5 行注入 | 「一开就崩」死循环 |

**显式取舍**:draft(单会话草稿)图片暂**不**外置——history 剥离已除掉无界累积源,draft 体积有界(单会话少量附件),外置改动面大风险高,记 follow-up。history 剥离图片的行为变化:历史回填(↑键)不再带回图片附件、纯图片 prompt 不入历史。

## 验收标准(对照需求计划门槛)

- .dat 写入速率降一个数量级(单测程序化验:突发 N 次 set → 底层写 ≤1 次);
- 人为放入超大/损坏快照 → 重启不连环崩(quarantine 单测 + 真机抽查);
- 24h 长跑 heap 不顶 4GB(🟡 长期人工抽查,不阻断本批);
- 存量含图 history 首次加载即缩容(migrate 单测)。

## R8 测试用例清单(动工前定)

- [x] persist:突发 10 次 setItem → 底层 write 恰 1 次、值为最后一次(unit)
- [x] persist:flush 触发 → 未到期 pending 立即落盘(unit)
- [x] persist:removeItem 取消同 key pending 写(unit)
- [x] persist:超限值拒写 + 不进 pending(unit)
- [x] history:prepend 剥离 image part,text/comment 保留(unit)
- [x] history:纯图片 prompt 不产生新 entry(unit)
- [x] history:migrate 清洗存量含 dataUrl entry、空壳 entry 丢弃(unit)
- [x] crash-guard:窗口内第 2 次可数崩溃判定 loop;窗口外/不可数 reason 不判(unit)
- [x] crash-guard:quarantine 只动 opencode.global/workspace/draft/default .dat,settings 不动,改名保留原件(unit,tmp 目录)
- [x] 运行时·native 风险点:electron-store 写盘行为无法在单测覆盖 → 打 local 包冷启动健康检查 + CDP 冒烟兜底(批次统一 e2e)
