feat-id: attachment-cost-guard
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划与 C0 决策记录

## 基线与隔离

2026-10-12 fetch origin 后实际 fork 仅有 main/origin/main，均为 b2162c0c7d，未发现 dev。以该 SHA 创建 managed worktree，分支 attachment-guard；未改 main。原工作区 deskfox-wordmark 与 tray-icons README 未提交修改保留。

worktree：`/Users/openclaw/.codex/worktrees/attachment-guard/opencode-fork`。锁定依赖安装使用 frozen-lockfile/ignore-scripts，未修改 lockfile。所有测试内存数据库、临时文件及假模型；未读取用户数据库。

## 阶段与改动预清单

| 阶段 | 拟改文件/区域 | 交付门 |
|---|---|---|
| C0 | opencode/test/session/prompt.test.ts、test/tool/read.test.ts；Core/app 两个 baseline 测试；feat 三文档与索引 | 当前实现证据、规格待审，不把 baseline pass 当修复成功 |
| C1 | Core 新纯限额 util；legacy tool/read.ts 与 session/prompt.ts；相关回归测试 | A01-A05；新附件真实请求限额，旧历史残余说明 |
| C2 | app prompt-input attachments/external-drop；prompt-input 连接身份注入；路由/浏览器测试 | A06-A07、A11 系统抽查；不引入新 IPC |
| C3 | app submit、成本纯判定、context metrics/状态 UI、i18n；测试 | A08-A10，改前后 benchmark；先统一输入语义再接 UI |
| C4 | 各包回归/产品本地版与证据 | A11-A12、分支验收全部完成后提合并 |

实现预计触及上游文件 ≥5、700–1200 行，按 Large；本稿先完成可审结果，再请 user 审签。C0 两个既有测试文件存在 upstream-base，且命中 packages/opencode 黑名单；提交前 R4 需报告。现阶段不绕过 hook、不提交产品改动。

## C0 决策订正

- D-H：legacy 新输入与后续重放实证。没有可靠附件强关联的旧 synthetic 不启发式截断。C1 新准入修复，历史仍需新会话/显式压缩。
- V2：canonical projection 完整媒体不等于最终发出；OpenAI Chat 编码器实际拒绝 text/plain。C1 不新增该能力，避免把成本保护扩成 V2 附件实现。
- read：legacy 每次分页，V2 小文件 bypass；共享限额模块仅对需要对齐的 legacy 路径抽取，不强改 V2 read。
- D-I：PDF inline，未知二进制拒绝；本机路径只在内置 base sidecar 确认同文件系统时引用，localhost 本身不是证据。
- D-J：200KiB 与 100000/3 倍为首版建议，需规格签署和后续真机文案抽查，不宣称已经用户认可。
- D-K：发送确认先于任何创建/乐观副作用，取消保留草稿；路径转换遵守 D-I。

## 验证命令

均从指定包目录执行：

```sh
# packages/opencode
bun test test/session/prompt.test.ts -t 'C0 baseline'
bun test test/tool/read.test.ts -t 'C0 baseline'
# packages/core
bun test test/attachment-cost-baseline.test.ts
# packages/app
bun test --conditions=browser --preload ./happydom.ts ./src/components/prompt-input/attachment-cost-baseline.test.ts
```

baseline 测试显式断言当前缺陷，是调查探针，C1/C2 必须替换成保护断言或归档证据后移除，不能留为阻止修复的长期规范。保留 V2 拒绝与小文件行为的回归断言。
