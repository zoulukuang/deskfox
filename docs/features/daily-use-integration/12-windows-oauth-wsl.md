feat-id: daily-use-integration
status: in-progress
related: ./3-changelog.md ./4-windows-handoff.md ./10-windows-evidence.md

# Windows OpenAI OAuth 与 WSL 补验

## 本轮包

Windows 11 x64 10.0.26300.9974。独立 worktree `D:/project/deskfox-win-final` 从接手时的远端功能分支头 `9890fd8616d3074a90e6711afb922777b93bcc97` 构建。它包含 `f517fc04b42cbb9e47439832dec05f7b23c7a8dc`、`48909c6959fa0f02c87c85d945470946e92a65ce` 和 Windows 两项修复 `7e14b0e48913b822758d7db37dff003fca7a9e20`。之后的接手登记 `fdd99a16ec` 只改交接文档。

Bun 1.3.14 执行冻结安装，锁文件 SHA-256 为 `1563688f944b9a8a2d844c1877274c8bc345dac665a3fa437c6a75992df2101e`。初次安装遇到 Node 24.14.0 原生模块缺少 `Release/node.lib`，补齐同版开发库后默认源下载停滞，最终用镜像冻结安装成功，耗时 61.97 秒。首轮构建发现新 worktree 缺少 LibreOffice 输入，复制先前已验证的独立 LibreOffice 依赖后，使用 `pwsh -NoProfile -File packages/branding/scripts/build-deskfox-electron.ps1 -Env local` 从源码重新构建，耗时 149.80 秒。构建脚本核验了产物中的 `soffice.exe` 和非空 `presets`。

| 产物 | SHA-256 |
| --- | --- |
| `D:/project/deskfox-win-final/packages/desktop/dist-deskfox/win-unpacked/DeskFox 本地版.exe` | `4d3441636bed0ca7638ec60a02d6bdd3d5793b30bd75bfa351d451d56a8ade5d` |
| `resources/app.asar` | `466b72ae308de0c327cda5da044532b4dbf9ee51c92f5eaefdb684a73e73cb7e` |

## REQ-162 OpenAI OAuth

使用实际打包应用的本机 sidecar，`openai/gpt-5.6-luna`、OAuth、AI SDK 路径。单独复制所需 OAuth 凭据到临时配置，退出后删除该副本。仅提交合成夹具内容。通过真实会话发送两个任务，要求读取五个指定文件、判断错误子目录中同名文件是否存在，以及生成中文空格文件并汇报。两个任务均未要求链接或 Markdown。后端记录有两次 WebSocket 超时和三次 `ECONNRESET`，同一会话继续执行后完成。本机现有代理的独立认证握手返回 101，仅作为网络诊断。

读取和写入任务分别用时 127.27 秒、24.23 秒。读取记录显示实际 `glob` 和 `read` 调用，模型正确报告五个内容标记，并说明错误子目录中的文件不存在且未给它附链接。写入记录显示模型使用 `apply_patch` 和 `read`，在项目中生成实际文件，磁盘内容命中 `OAUTH_WINDOWS_REPORT_DEFAULT`。

**结果为未通过。** 模型把 `report%20draft.md` 的 href 写成 `report%2520%20draft.md`，解码一次后多出一个空格，指向不存在的 `report%20 draft.md`。首轮点击到此处时失败。把本次真实会话的 SQLite 数据复制到干净的隔离配置后，重新逐个点击同一批回复。六个链接中五个显示正确内容（510–1611 ms），包括生成文件（529 ms）。字面 `%20` 的链接点击 52 ms 后显示「文件不存在」，原文件仍在磁盘。该步的记录标为成功捕捉到错误提示，链接业务结果以 `markerVisible: false` 判为失败。

[模型读取原文](./12-windows-evidence/oauth-read.json)、[模型写入原文](./12-windows-evidence/oauth-write.json)、[六次点击](./12-windows-evidence/oauth-link-clicks.json)、[失败提示](./12-windows-evidence/oauth-literal-percent-error.png)、[生成文件](./12-windows-evidence/oauth-generated-file.png)、[sidecar 日志摘录](./12-windows-evidence/oauth-sidecar-excerpt.txt)。

## REQ-160 WSL 项目外预览隔离

原机有 WSL 2.6.3.0 且无已注册发行版。导入独立 `DeskFox-QA-20261114`（Alpine 3.23.5、WSL 2），运行 Linux OpenCode 1.18.16 的 musl x64 官方 npm 包。安装包完整性与 registry 元数据一致，Linux 可执行文件 SHA-256 为 `bad9b279fb1e76e74c9d867339f25faf506ab2ecf777f14265787048a76a7bda`。通过打包 Electron 的 WSL 原生 IPC 启动并选中 `wsl:DeskFox-QA-20261114`。真实后端 `/path` 返回 Linux `/root/deskfox-qa-project`，项目内文本对照正常显示。

在该会话实际点击 WSL 项目外 PDF、DOCX，及 Windows Downloads 下 PDF、DOCX、XLSX、PPTX，六项都在 20–75 ms 内出现「项目外文件预览仅支持本机桌面会话」提示，原会话路由保持，预览对话框及 Office 转换请求均未出现。Linux 与 Windows 的同名 PDF、DOCX 文件含不同内容标记。WSL 项目外隔离这项 **通过**。此项用 CDP 驱动真实打包窗口，Windows 本机成功预览的历史记录见 `10-windows-evidence.md`。

[WSL 连接与后端路径](./12-windows-evidence/wsl-connection.json)、[六项点击日志](./12-windows-evidence/wsl-checks.json)、[Linux PDF 提示](./12-windows-evidence/wsl-linux-pdf.png)、[Windows 同名 DOCX 提示](./12-windows-evidence/wsl-windows-docx.png)。测试结束后导出专用发行版留证并注销，恢复为原来的无注册发行版状态。

原始材料位于 `D:/tmp/deskfox-daily-win-20261114/evidence`。[构建摘要](./12-windows-evidence/windows-build-excerpt.txt)对应 `final-oauth-wsl-install*.log`、`final-oauth-wsl-build*.log`。运行记录见 `final-real-oauth-default`、`final-oauth-click-replay-fresh`、`final-wsl-preview`、`wsl-environment.log`、`wsl-offline-tools.log` 和 `wsl-cleanup.log`。四次重开旧配置有启动或会话加载超时，证据在 `final-oauth-click-replay{,2,3,4}`，改用独立 SQLite 副本后完成点击。隔离应用、sidecar 和测试监听均已退出，默认协议已恢复。
