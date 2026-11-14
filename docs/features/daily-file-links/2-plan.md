feat-id: daily-file-links
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施顺序

2026-11-14 用户对汇总方案回复「批准两项施工方案，继续并行推进」，B Large 已获施工许可；C 黑名单提交复核见 `4-r4-review.md`，仍须具体 R4 确认。

1. A 部分先写真实共享 handler 的复现测试，再修解码、纯锚点和跨文档片段；只用 fork helper 与小挂接。
2. B/C 完成接口、用户体验及通道盘点，Large 施工方案交主 agent 汇总审签；有独立 Medium 子项不被后续方案阻塞。
3. 相关单元/DOM/GUI验证通过后，协调机器资源执行完整 pre-push；Mac/Windows local 和模型实测缺口如实写回执。

## 读码结论（2026-11-14）

- 两个点击入口共享 `md-link-click.ts`，当前没有 percent 解码，纯锚点直接放行原生导航。
- Markdown 已生成标题 ID，sanitize 会加 `user-content-`；可以在外层实现滚动，无需侵入底层 renderer。
- 当前项目内文件 API 检查项目边界；仅删除前端检查不能实现项目外读取。
- native `get_file_mtime` / `read_binary_file_base64` 接受任意 root，但不提供完整单文件类型/大小/来源限制；B 需专用受控 IPC，不能简单把 root 换成 `/`。
- shared request prep 在生成 OAuth instructions、messages 前调用 system transform；插件桥接是否消费 system 尚待核查。
- 补充：`file.officePdf` 现有 handler 接受绝对路径，因此 Office 可在 native 验证单文件后复用，不需增加 server API。桥接兼容记录明确存在“不消费 system”的提供方，C 改用同一约定 + 请求副本用户 text 提醒，详情见 spec C。
