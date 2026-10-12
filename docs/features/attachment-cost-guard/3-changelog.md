feat-id: attachment-cost-guard
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# C0 验证记录

2026-10-12，基线 b2162c0c7d，Bun 1.3.14，macOS。新增/扩展 4 处调查测试，共 5 个 C0 用例，28 个断言通过；另一个现有 message-v2 测试通过，确认隔离环境有效。产品运行代码未修改，尚无修复/发布提交。

## 实测结果

| 探针 | 输入 | 结果 |
|---|---|---|
| legacy prompt 与后续请求 | 864000 字节、24000 行 CSV | 一份完整 synthetic；两轮假模型请求都包含全文 |
| V2 canonical projection | 同一附件，data URL 1152023 字节 | 未裁剪媒体；OpenAI Chat prepare 返回不支持 text/plain，未发送 |
| legacy read 行数 | 3000 行、6000 字节 | 仅前 2000 行；offset=2001；含行号/包装输出 15099 字节 |
| legacy read 字节 | 100 行、100100 字节 | 前 51 行；offset=52；含包装输出 51464 字节 |
| legacy read 超长单行 | 60000 字节 | 单行 2000 字符裁剪 suffix；含包装 2217 字节 |
| V2 read 小文件 | 3000 行、6000 字节 | 全文返回，不受 legacy 2000 行规则限制 |
| V2 read PDF | PDF magic 合成临时文件 | ReadTool.BinaryFileError |
| app 类型/路由 | CSV/TXT/PDF/PNG/Office 有无路径 | 文本规范为 text/plain；PDF 可内联却被外拖 path；Office MIME 拒绝却被外拖 path |

## 覆盖限制

legacy 第二轮使用实际已保存临时会话，验证历史重放，无用户数据库。没有验证所有历史版本的布局与来源标记，不能用该测试推断可安全自动识别旧附件。V2 使用真实 canonical projection 和协议 prepare，尚未运行完整 Session drain，也未证明其他 provider 对文本媒体的最终行为；C1 不更改 V2 能力。

路由验证是纯函数和真实 File MIME 检测，未替代 Mac/Win OS 剪贴板/选择器。C3 阈值及交互尚未实现；未跑产品 benchmark，修改 session UI 前执行。未部署、未公开分享、未发真实模型请求。

## 当前交付状态

Core 与 opencode 包的 `bun typecheck` 通过。app 包 `bun typecheck` 未通过：`packages/ui/src/pierre/media.ts:6` 无法解析 `@opencode-ai/core/office-pdf-protocol`；该 import 与目标文件均已存在于基线，本次未修改。新 worktree 使用锁定依赖安装后出现此解析问题，尚未认定主工作区也会复现；不以改依赖或跳过检查掩盖。C2 开工时需先核实依赖声明/解析环境，属于 app 完整验证前置。

`git diff --check` 通过；格式化只作用于本次测试，既有测试文件 diff 仅新增探针。产品代码仍零修改。

C0 技术证据完成，规格待审；D-J 阈值与 Large 审签未关闭，C0 整体门不勾选。C1-C4 未开始。回退 C0 只需移除本分支的调查测试/文档，不涉及用户数据。提交 hash：尚未提交；原因是现有测试涉及黑名单，等待完整复核后按 R4 处理。
