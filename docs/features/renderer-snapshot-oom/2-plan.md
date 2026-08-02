feat-id: renderer-snapshot-oom
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 步骤

1. `persist.ts`:桌面 async 路径 setItem 加 trailing-throttle(首写延后 800ms、期间只更新 latest,到点写最新值 → 打字期写速 ≤1.25/s);flush 钩子挂 `pagehide` / `visibilitychange(hidden)` / native `deskfox-flush-before-close`;removeItem 取消 pending;>16M chars 熔断拒写(warn 一次)。web/localStorage 同步路径不动(问题只在桌面落盘,且既有单测依赖同步语义)。
2. `history.ts`:`prependHistoryEntry` 过滤 image part;`normalizePromptHistoryEntry` 防御性过滤(兜历史脏数据);新增 `migrateStoredHistory` 纯函数供 persisted migrate 用。
3. `prompt-input.tsx`:两个 history persisted() 挂 migrate(读时清洗 + `readCurrent` 发现变化即回写 → 存量 1.4MB global.dat 首启缩容)。
4. `renderer-crash-guard.ts`(fork-only 新文件):崩溃循环检测(120s 窗口 ≥2 次可数 reason)+ 快照文件隔离(rename `.bak-<ts>`)+ reload;`index.ts` render-process-gone 处一行接入(R1 二级)。

## 决策轨迹

- **draft 图片外置 deferred**(2026-08-02):评估批次报告原推荐外置;实施时复核——OOM live-set 大头是 history(100 条累积),draft 单会话有界;外置需改 `context/prompt.tsx` 双 store 拆装(~80 行,current()/ready/恢复路径全要动),稳定 > 简洁,本批不做,记 follow-up(需求池 REQ-087 详情 doc)。
- **节流语义选 trailing-throttle 非 debounce**(2026-08-02):纯 debounce 连续打字期间 0 落盘,崩溃丢失窗口无上界;throttle 保证 ≤800ms 丢失窗口 + 稳定写速。
- **quarantine 不动 `opencode.settings`**:窗口尺寸/基础设置与崩溃无关且丢了烦人;只隔离 renderer 快照四族(global/workspace/draft/default .dat)。
- **熔断阈值 16M chars(≈32MB UTF-16)**:现网 global.dat 1.4MB,正常快照余量 >20×;百 MB 级病态快照被拦。
