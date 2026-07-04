feat-id: req069-folder-identity
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-069 实施计划 + 决策轨迹

> 实施走模块交付流水线 phase2(逐单元:实现 → 对抗审 → 修复 → 集成关),工单权威源 `OPENCODE-PLAN/scripts/workflows/v2026.6.25-breakdown-rev2.json`。本文档记录开发中的决策与踩坑,实时追加。

## 实施顺序

U1(锚契约)→ U2(写侧)‖ U6(flag)→ U3(resolve)→ U4(编排)→ U5(析出+恢复)。
U1/U6 无依赖可并行;U4 汇聚 U2/U3/U6;U5 收尾。

## 决策轨迹

### 2026-07-04 phase1 rev2 主控裁决(22 争议,5 blocker)

1. **B1 弃 `ProjectV2.commit` 签名扩展**:core `commit(:150-152)` 与 Interface 零改动;写锚全走 `anchor.ts` 的 `writeAnchor`/`appendToInfoExclude`,由 fromDirectory 编排层调用。保住「resolve 纯读、显式打开才写」不变量,同时避免上游活跃重构文件的接口漂移冲突。
2. **B2 真实目录修复绑定锚存在**:resolve `!repo` 分支无锚时返回值与现状 bit-identical(`{id: global, directory: 盘根}`);仅有锚才返锚 id + 真实目录。保证 `session.ts:204` / `location.ts:37` / `move-session.ts:81-82` 三个非 fromDirectory 调用方在存量环境零行为变化,现有盘根断言测试保持通过即回归证明。
3. **B4 flag 门控收口 U4 编排层**:core 不下沉 RuntimeFlags(core 无法访问 opencode 的 flag Service)。resolve 无条件读锚;「flag 关时身份仍按 global」由 fromDirectory 强制。**文档化可接受边界**:有锚 + flag 关时,resolve 直接调用方(location/session.path)会见锚 id + 真实目录 —— 锚仅在 flag 开过后才存在,该窗口只出现在「开过又关」的回退场景,属可接受降级。
4. **B3 fileScope 重切互不相交**:hideAnchorDir 并入 U1;U2 只碰 anchor.ts 写侧,U3 只碰 core/project.ts,U6 只碰 runtime-flags。消除并行实现时的文件争用。
5. **B5 析出行直接真实 worktree**:mint 铸 id 建行时 `worktree = data.directory`,不沿用 global 的盘根、不依赖 REQ-061 重绑机制兜底。
6. **mint 判定钉死**:`flag 开 && data.vcs === undefined && data.id === global`(git init 未 commit 有 vcs,绝不触发 mint)。
7. **M6 软恢复钉死**:mint 前反查 `ProjectDirectoryTable`(directory=opened,type=main 优先;小表全扫,不改 schema 不加索引);命中且 project 行存在 → 沿用 + 重写锚 + logInfo;未命中 → mint。**文档化可接受边界**:「同路径已被无关新文件夹替换」时错误复用旧身份,与 git previous 缓存语义一致。
8. **副本预期钉死**:副本(原路径仍在,非 ENOENT)不重绑 worktree,副本路径进 sandboxes,同 git 双 clone。
9. **flag 往返**:关闭后已迁 session 不回迁(历史暂不可见),不做反向迁移 —— 可接受降级;再开即恢复。

### 前置调查结论(2026-07-04,施工前唯一待验点)

**`migrateProjectId` 幂等 ✅**(`packages/opencode/src/project/project.ts:177-218`):三道早退守卫(!oldID / oldID===global / oldID===newID)+ 事务内迁移;固定 (oldID,newID) 二次调用为干净 no-op → git⇄非git 桥接**存量无需一次性对齐 migrate**(需求 doc §三bis 取「可省」分支)。

## 踩坑记录

(开发中追加)
