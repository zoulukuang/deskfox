feat-id: req-119-chat-selection-pseudo-path
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-119 · 聊天引用伪路径泄漏进后端 — 需求 + 验收

> 需求池原文:`OPENCODE-PLAN/需求池/聊天引用伪路径泄漏-注入假Read失败.md`(2026-08-18 立项,P2)
> 实施:2026-08-19

## 一、问题(一句话)

在对话区选中文字「加入聊天」发出去时,前端把一个**故意的占位符路径** `<chat selection>` 当普通文件附件一起发给后端;后端不认识这个约定,把它拼到 cwd 后面**当真文件去 Read**,于是每条引用都往模型上下文注入一对假的 Read 调用 + 失败结果,并推一条会话 Error 事件。

实测本机 `opencode.db`:**294 次引用命中 275 次(93.5%)**,最早 2026-06-14,已持续两个多月。

## 二、根因

`CHAT_SELECTION_PATH = "<chat selection>"` 这条「它不是文件,别当路径用」的约定,此前**只写在 app 侧的注释里**,后端收不到:

| 位置 | 角色 |
|---|---|
| `packages/app/src/utils/context-menu-host/dom-provider.ts` | 定义伪路径,注释声明「LLM 端不会用它」 |
| `packages/app/src/components/prompt-input/build-request-parts.ts` | 引用卡照发 text part(引文)**+ file part(伪路径)** ← 泄漏点 |
| `packages/opencode/src/session/prompt.ts` | 展开 file part → `execRead` → 失败 → 注入 synthetic Read 记录 + publish Error |

2026-08-12 修过同一伪路径漏进**文件预览 tab**(开空白 tab)。那次是逐点堵,没把伪路径变成"不可能被当文件用"。本次一并治源头。

## 三、修法

**双层**(源头 + 兜底),外加一层跨端契约:

1. **契约上提**:常量 + 判定函数从 app 私有注释,提升为 core 共享模块 `@opencode-ai/core/util/chat-selection`(`CHAT_SELECTION_PATH` / `isChatSelectionPath`),前后端引用同一份定义。
2. **源头(前端)**:`build-request-parts.ts` 对 `kind === "chat"`(或 path 命中伪路径)的引用卡**只发引文 text part,不再发 file part**。引文内容本来就在 text part 里(`formatCommentNote` 的 chat 模板 + preview),file part 对聊天引用零价值。
3. **兜底(后端)**:`prompt.ts` 展开 `file:` 附件时,若路径命中伪路径 → 直接丢弃该 part:不读盘、不 `logError`、不 publish `Session.Event.Error`、不注入 synthetic piece。覆盖老客户端与历史消息重放。

## 四、测试用例清单(R8)

> 如实记录:本条按需求池已有的详细根因分析直接动工,清单在实施中同步补全,非动工前先签。

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| 1 | 裸伪路径 / posix 拼 cwd / Windows 反斜杠 / Windows 正斜杠 四种形态 | Logic 单测(core) | 全部判为伪路径 |
| 2 | 真实文件路径、伪路径作为**目录名**的下级文件、`<chat selection>.ts` | Logic 单测(core) | 全部**不**判为伪路径(不误伤) |
| 3 | 空值 / 空串 / 纯空白 | Logic 单测(core) | 安全返回 false |
| 4 | 聊天引用(kind=chat + preview + comment)构造请求 parts | Logic 单测(app) | 0 个 file part、无 `chat%20selection` URL;引文 text part 仍在且 metadata.kind=chat |
| 5 | 无正文无 preview 的聊天引用 | Logic 单测(app) | 仍不产 file part |
| 6 | 文件引用(kind=file)构造请求 parts | Logic 单测(app) | file part 照发(不被误伤) |
| 7 | 后端收到伪路径 file part(老客户端 / 历史重放) | 集成单测(opencode) | 无 `Called the Read tool` / `Read tool failed to read` synthetic part、无 file part 落库、无 `Session.Event.Error`、普通 text part 不受影响 |
| 8 | 既有回归护栏:伪路径不进预览 tab | 既有 Logic 单测(app) | 保持绿 |

## 五、验收(需求池口径:🟢 全自动)

- 上表 1-8 全绿
- `packages/app` 全量单测(pre-push 口径 `bun run test`)、`packages/opencode` `test/session/prompt.test.ts` 全量、fork 范围 typecheck、desktop build 全绿
- e2e 全套无新增红

## 六、影响面

- **用户可见**:引用消息不再触发会话错误提示;模型不再收到"我读文件失败过"的假记录。
- **数据**:新发的引用消息不再落 file part(历史消息不动,不做数据迁移 —— 只影响新消息)。
- **不改**:引用卡的渲染、撤回、metadata 结构,均只依赖 synthetic text part(`timeline/rows.ts` 的 `MessageComment.fromPart`),与本次改动正交(与 REQ-123 同片代码但互不冲突)。
