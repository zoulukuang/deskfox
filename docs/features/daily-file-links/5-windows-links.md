feat-id: daily-file-links
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./4-r4-review.md

# Windows 绝对路径入口补验（2026-11-14，笑南的电脑）

REQ-152/162 最后交叉核查发现：handler 支持 `C:/` 不代表消息真的渲染链接。普通 Markdown 的 DOMPurify 默认将 Windows 盘符识别成未知协议，删除 href，只显示正文。Chromium 新增实际聊天绝对盘符链接，禁用候选 hook 复现为1 fail：`Absolute Windows guide` 没有 link role/href，5秒断言超时。确认后恢复修复再验。

新 fork helper `session-ui/src/components/markdown-file-links.tsx` 只保留 HTML `<a>` 的 `href`，且值必须以字母盘符和斜杠/反斜杠开头。不保留 `C:relative`、javascript/data/file/localasset scheme；不影响 IMG src、SVG href、style 等资源入口。共享 `markdown-cache.tsx` 只 import + hook 注册，共3行有效挂接，其余默认净化规则原样保留。

12个精确匹配/拒绝单测通过；6条实际浏览器GUI再次通过，包含Windows编码绝对路径点击后的正确文档内容。session-ui包typecheck及包含真实context fixture的e2e typecheck通过。此前app生产build也已通过；最终push再跑完整pre-push。

本笔属于同一文件链接范围的末端修复，session-ui不在现行pre-commit黑名单正则内，普通hook提交。它补充/更新先前4-r4-review中“尚未修改既有Markdown文件”的时间点描述；唯一待提交R4仍是opencode `llm/request.ts`。C staged diff 与 `/tmp/deskfox-file-links-r4-review.patch` 保持冻结，未经审签不提交。

仍不等同于Windows真实桌面回执；本次为Mac上Chromium、Windows路径fixture，双端local继续待验。
