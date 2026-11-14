feat-id: daily-use-integration
status: in-progress
related: ./3-changelog.md ./12-windows-oauth-wsl.md ../daily-file-links/1-spec.md

# Windows OAuth 字面百分号链接复验

## 复现与修复

修前的 [真实模型回复](./12-windows-evidence/oauth-read.json) 把 `report%20draft.md` 写成 `[report%20draft.md](…/report%2520%20draft.md)`。真实包日志的 `stat` 目标是 `report%20 draft.md`，证明多出的空格来自模型写出的 href，点击链路对它仅解码了一次。旧包真实点击显示「文件不存在」。同样的原文在 Chromium 聊天回归中可以渲染和点击，旧代码查找原文件内容的断言失败。

共享模型交付约定增加了字面 `%20` 与真实空格的对照示例，并要求确认一次解码后的路径与工具返回值逐字符一致。聊天中的旧回复保留原始 href 和持久化文本。仅在助手 Markdown 中的项目内目标返回 `ENOENT`、标签完全等于该文件名去掉误加空格的形式时，再核对同目录候选。首选目标存在时直接打开首选。项目外逻辑沿用原来的精确目标与预览边界。

## 自动化

- 修前单测在原始形态的缺失路径用例失败。修后链接与 Markdown 锚点 35 项通过，覆盖精确目标优先、错误标签、其他目录、权限错误及普通解码。
- Chromium 4 项通过，其中一项读入回执存档的真实 OpenAI 回复，逐个点击字面 `%20` 和真正空格的两个文件并核对内容。
- 后端文件交付测试 10 项通过，覆盖 OAuth、标准路径、workflow、排除项及消息不变性。app、app e2e 和 opencode 类型检查通过。
- 功能分支正常推送的 pre-push 完整执行，29 项 workspace 类型检查、6 个包测试通过，desktop 的 2 项既有跳过保留。

## Windows local 构建

在独立 worktree `D:/project/deskfox-win-final` 基于 `87d44eab607969bde5db67a5cce4c2874c62ba05`，Bun 1.3.14 冻结安装 78.85 秒，重新执行 `pwsh -NoProfile -File packages/branding/scripts/build-deskfox-electron.ps1 -Env local`，用时 168.07 秒并验证包含 LibreOffice。功能分支产品提交 `a5c91952300bc8d4ccf274db7a0431c30c215cd2`，与构建 worktree 的 `03cc16ba6e9fd8a92506259e9bcdef69edd434a4` 非文档树一致。修复补丁 SHA-256 为 `e03d7de4eaee53757988de97b4d5188b026e90a7ba03bd4aec59db8d3397b810`，构建启动后的一次修订仅修正测试类型。

产物为 `D:/project/deskfox-win-final/packages/desktop/dist-deskfox/win-unpacked/DeskFox 本地版.exe`。exe SHA-256 为 `ee678c825ca20d80e13d4d8bfd0264e3fbb318343facc5f47761032474441903`，app.asar SHA-256 为 `d0917641c40038daad83ba65d0ff460f49806496cfeee5f25ec82c7fa5d18aba`。修前包归档在 `D:/tmp/deskfox-daily-win-20261114/before-oauth-link-fix-dist`。

`bun.lock` 的 Git blob 为 `5b829249afb0ae32cd812c2f5a043a29b82c65fc`。Windows CRLF 工作文件 SHA-256 为 `1ce5abf5925e81ae0a5f2ab9ef769706a903b2c4471a1bf4cdbc315b1725bd8b`，同一内容的 LF SHA-256 为 `1563688f944b9a8a2d844c1877274c8bc345dac665a3fa437c6a75992df2101e`。

## 真实回复回放

将原 Windows OAuth 会话的 SQLite 复制到新配置，用新打的真实 Electron 和本机 IPC 点击回复中的原始六个 href。六个均打开正确内容。字面 `%20` 链接的 href 仍是 `report%2520%20draft.md`，点击约 651 ms 到 `LITERAL_PERCENT`。真正空格文件独立打开并显示 `REAL_SPACE`，用时 555 ms。该步骤使用上轮回复，实时新模型结果单列。

[六条回放记录](./13-windows-evidence/replay-clicks.json)、[字面百分号文件截图](./13-windows-evidence/replay-literal-percent.png)、[自动化日志摘要](./13-windows-evidence/test-log-excerpts.txt)。

## 真实 OAuth 复验

用新包和单独复制的 OAuth 凭据发送同一组真实文件任务，provider/model 为 `openai/gpt-5.6-luna`。默认会话在 177 秒配置观察窗内未完成回复，记录到 WebSocket 超时和 `AggregateError`；只应用现有代理的诊断会话在 97.5 秒观察窗也未完成。保留失败证据。[默认会话失败摘要](./13-windows-evidence/live-default-check.json)、[默认会话界面](./13-windows-evidence/live-default-timeout.png)。

**真实 OAuth HTTP 路径六个链接通过，默认 WebSocket 路径本轮仍未通过。** 保持产品包、模型、OAuth、工具调用、共享提示和实际文件点击路径不变。成功样本使用本轮隔离配置中的临时诊断插件，将现有系统代理显式交给 Node HTTP dispatcher，用现有传输标记选择 HTTP。该插件只在隔离配置加载，无产品提交。此前一次仅移除插件层会话头，仍被请求组装补回并走 WebSocket，观察窗内未完成，日志保留。

真实模型读取五个文件、生成新文件分别用时 42.42 秒和 28.74 秒。用户任务未明示链接或 Markdown。模型原始 href 正确使用 `report%2520draft.md`，并如实汇报不存在的同名文件，未为它生成链接。六次实际点击均显示正确标记，字面 `%20` 568 ms，生成文件 516 ms，全部范围 516–2570 ms。系统代理用于出站，未改正式版配置，未让本地模型桩处理任何 OAuth 请求。

[本轮读取原文](./13-windows-evidence/live-http-read.json)、[写入原文](./13-windows-evidence/live-http-write.json)、[六条点击](./13-windows-evidence/live-http-clicks.json)、[字面百分号截图](./13-windows-evidence/live-http-literal-percent.png)、[生成文件截图](./13-windows-evidence/live-http-generated.png)、[sidecar 日志摘要](./13-windows-evidence/oauth-live-sidecar-excerpt.txt)。

原始日志根目录 `D:/tmp/deskfox-daily-win-20261114/evidence`，构建与自动化见 `oauth-link-fix-*.log`、`oauth-link-browser-*.log`、`oauth-fix-push.log`。回放与实际 OAuth 运行分别见 `final-oauth-click-replay-fixed`、`final-real-oauth-fix`、`final-real-oauth-proxy-fix`、`final-real-oauth-proxy-http`、`final-real-oauth-proxy-http2`。隔离 Electron、sidecar 与监听已退出，默认协议恢复，临时 OAuth 凭据已清理。验收使用 CDP 操作真实 Windows 包。Windows 整批仍沿用原有未验范围，未合 main、未发布。
