feat-id: req-119-chat-selection-pseudo-path
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实际改动

> commit: `52e18ca165`(代码与测试单笔自包含;本行 hash 由紧随其后的 docs 笔回填)

## 改了什么

| 文件 | 性质 | 改动 |
|---|---|---|
| `packages/core/src/util/chat-selection.ts` | **新增(fork-only)** | 伪路径常量 `CHAT_SELECTION_PATH` + 判定 `isChatSelectionPath`,前后端共享契约。26 行 |
| `packages/core/test/util/chat-selection.test.ts` | **新增(fork-only)** | 判定函数单测 8 例(四种路径形态 / 不误伤 / 空值)。44 行 |
| `packages/app/src/utils/context-menu-host/dom-provider.ts` | fork-only 文件 | 常量改为从 core re-export,既有 import 全不动。+4/-2 |
| `packages/app/src/components/prompt-input/build-request-parts.ts` | 上游文件(已有 FORK 段) | 聊天引用不再产生伪路径 file part(源头)。+10/-2 |
| `packages/app/src/components/prompt-input/build-request-parts.test.ts` | 上游测试 | 新增 3 例(聊天引用不发 file part / 空引用同样不发 / 文件引用不被误伤)。+76 |
| `packages/opencode/src/session/prompt.ts` | **上游文件(黑名单)** | 展开 `file:` 附件前短路伪路径(兜底)。+7 行(含注释与 import) |
| `packages/opencode/test/session/prompt.test.ts` | **上游测试(黑名单)** | 新增集成用例:伪路径被丢弃、不注入 synthetic Read、不推 Error。+60 |

合计约 200 行(含测试),触动上游文件 3 个。新增:改上游 ≈ 5:1。

## R4 override 复核报告(黑名单:`packages/opencode/`)

### 1. wrapper 不可行性

后端展开附件的逻辑(`resolvePart`)是 `SessionPrompt` service layer 内部的匿名 `Effect.fn`,既不导出、也不接受策略参数;`file:` 分支拿到 `filepath` 后立刻 `execRead`。fork 侧可用的注入点只有 plugin hook `chat.message`,而它在 `resolvedParts` 之后才触发 —— **假 Read 早已注入、Error 早已 publish**,拦不住。要在进程外替代,只能复制整条附件展开链路(数百行,且每次上游 sync 都得跟),得不偿失。

先例同构:`6fe215459f`(OAuth callback 绑 loopback,"listen hostname 在上游函数体内无注入点,3 行就地补 + FORK marker")。

### 2. 风险评估

- 改动是**单条 early-return**,只对命中固定伪路径 `<chat selection>` 的 basename 生效;真实文件路径、伪路径作目录名的下级文件、`<chat selection>.ts` 均已单测证明不误伤。
- 丢弃这条 part 不影响引文送达(引文在同一条消息的 synthetic text part 里)、不影响引用卡渲染与撤回(`timeline/rows.ts` 只读 text part 的 metadata)。
- 历史消息不动,不做数据迁移。
- 上游 merge 冲突面:1 处 5 行 FORK block,位于 `case "file:"` 开头,冲突概率低且易辨认。

### 3. 改动日志论证(逐文件)

- `packages/opencode/src/session/prompt.ts` — 见上,唯一可行注入点即崩点本身。
- `packages/opencode/test/session/prompt.test.ts` — 后端回归用例必须与被测 service 的 fixture 同文件(`noLLMServer.instance` + `TestInstance` harness 均在此文件内声明,未导出),属 REQ-048 路径黑名单误伤模式。

## 回归验证

| 项 | 结果 |
|---|---|
| `packages/core` `test/util/chat-selection.test.ts` | 8 pass / 0 fail |
| `packages/app` `bun run test`(pre-push 口径) | 1054 + 41 pass / 0 fail |
| `packages/opencode` `test/session/prompt.test.ts` 全量 | 45 pass / 14 skip / 0 fail |
| fork 范围 typecheck(`--filter='!./packages/console/*'`) | 29/29 successful |
| `packages/desktop` `bun run build` | ✅ built |
| e2e 全套(`bun run test:e2e`) | 142/142 —— 首轮 109 pass / 33 fail,**33 条全部是资源竞争 flaky**(与 e2e 并发跑了 app 全量单测 + turbo typecheck,失败全是 60s timeout 且集中在 terminal/timeline/find/list-ux 等与本改动无关的用例);单独 `--last-failed` 重跑 **33/33 pass(1.1 分钟)** |

新增测试**红→绿双向验证**:临时禁用前端短路 → app 新增 2 例转红;临时禁用后端短路 → opencode 新增用例转红。

## 回退方法

```
git revert <hash>
```

单笔 commit 自包含。回退后行为回到"每次聊天引用注入一对假 Read + 一条 Error 事件"。
