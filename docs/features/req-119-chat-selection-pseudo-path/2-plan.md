feat-id: req-119-chat-selection-pseudo-path
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 步骤

1. 读需求池 + 三处代码(dom-provider / build-request-parts / prompt.ts),确认泄漏链路
2. 新建 core 共享模块 `util/chat-selection.ts`(常量 + `isChatSelectionPath`)
3. app 侧 `dom-provider.ts` 改为 re-export core 常量(既有 import 全不动)
4. `build-request-parts.ts` 源头不发伪路径 file part
5. `prompt.ts` 展开附件时短路伪路径(兜底)
6. 三层测试:core Logic 单测 / app Logic 单测 / opencode 集成单测
7. 回归:app 全量单测、opencode prompt 全量、fork 范围 typecheck、desktop build、e2e 全套

## 决策轨迹

### D1 — 常量放哪(app 私有 vs core 共享)

需求池给了下限(后端硬编码字符串短路)和上限(chat 引用根本不带 path 进附件链路)。选**中间偏上**:常量与判定上提到 `@opencode-ai/core/util/chat-selection`,前后端共享一份。

理由:后端硬编码字符串会让"同一个约定两处各写一遍"再次漂移(这正是本 bug 的成因);而"chat 引用彻底不带 path"要动引用卡的数据结构(`ContextFile.path` / `createCommentMetadata` / `MessageComment` 全链路),牵连 REQ-123 正在改的同一片代码,不划算。**共享契约 + 双层守卫**在成本与治本之间是最优点。

core 侧是**纯新文件、零 import**,浏览器端引用不会带进 node 依赖(app 已有 `@opencode-ai/core/util/path` 同模式先例)。

### D2 — 前端是"不发 file part"还是"发但标记"

选不发。聊天引用的引文本身走 text part(`formatCommentNote` chat 模板 + preview)已完整送达模型,file part 指向的伪路径不存在,**唯一作用就是失败**。且渲染侧(`timeline/rows.ts` 的 `MessageComment.fromPart`)只读 synthetic text part 的 metadata,不碰 file part —— 去掉零影响。

顺带:无 comment 无 preview 的空引用卡此前会退化成"只发一个伪路径 file part",现在直接不发(发出去也只是一次假 Read)。

### D3 — 后端为什么还要兜底

前端已治源头,但:① 老版本客户端仍会发;② 历史消息重放 / 其他 SDK 客户端;③ 这条约定值得在后端边界显式成立,而不是靠"前端保证不发"。短路 1 行 + 注释,成本极低。

丢弃整条 part(`return []`)而不是保留:保留会在消息里落一条指向不存在文件的 file part,前端点它就是 2026-08-12 修过的空白 tab 坑。

### D4 — 后端集成测试的 timeout

新用例带 `30_000` timeout(与同文件既有 interrupt 类用例一致)。实测单跑 3.7s,过滤运行时冷启动会显著变慢,默认 5s 会 flaky。

## 踩坑

- **本机 Bash heredoc 会吞掉一层反斜杠**:用 `<<'EOF'` 写含 `[\/]` 的正则源码,落盘变成 `[\/]`(只匹配正斜杠),Windows 路径判定直接失效;测试里的 `"D:\my-life\\"` 同样被吞。修法:凡含反斜杠字面量的写入,一律 python 用 `chr(92)` 拼接,写完 `grep` 复核落盘内容。此坑先让 core 单测红了一轮才发现 —— 也证明这条单测有效。
- **`packages/app` 裸跑 `bun test` 会假红 14 条**:必须走 pre-push 口径 `bun run test`(带 `--preload ./happydom.ts --conditions=browser`)。裸跑的失败与本改动无关。
