feat-id: share-windows-build
status: in-progress
related: ./3-changelog.md

# Windows 分享构建与发版前复核

2026-10-16，基线 `6c840b6ed8`，分支 `release-validation`。原工作区两处 E2E 测试调整保留，不混入本次修复。未提交、合并、推送或发布。

## 修复

SolidStart 的服务函数生成器用 `node:path.normalize` 将 Windows 原生路径直接写入 JavaScript import，导致反斜杠被当作转义字符；应用入口 define 也直接用模板拼引号，随后导致 esbuild 拒绝非法字面量。

对锁定的 `@solidjs/start@https://pkg.pr.new/@solidjs/start@dfb2020` 增加最小依赖补丁：运行时导入用依赖已有的 `pathe.normalize`，入口 define 用 `JSON.stringify`。同时修改包内源文件和 dist，不升级依赖、不修改分享协议或数据持久化。Bun 1.3.14 的 patch --commit 在 URL 依赖上崩溃，因此保存标准 patch 文件并用正式 `bun install --ignore-scripts` 安装验证。

真实 `solidStart()` + Vite `resolveConfig` 回归验证 app entry 能还原成本机文件路径；临时恢复旧表达式时测试因 Invalid escape character p 失败，finally 恢复后通过。enterprise 包级 `bun run typecheck` 通过；生产 client、SSR、Nitro Node 构建完整成功。

最终补丁通过 `bun install --ignore-scripts --frozen-lockfile` 安装，检查源文件与 dist 均保留 app/client 两个入口，配置与路由发现回归共 2 pass /4 assertions。最终生产构建完整退出 0，日志保存在本轮验收输出目录 `share-build.log`。

## Windows 候选包

正式 wrapper `packages/branding/scripts/build-deskfox-electron.ps1 -Env local` 完整退出 0。local 独立身份、版本 `2026.11.1`，未升版、不发布；构建前检查本地版未运行，没有重启用户应用。插件预检与最终包 LibreOffice soffice/presets 校验通过。

产物：`packages/desktop/dist-deskfox/win-unpacked/DeskFox 本地版.exe`。读取 app.asar 确认 package name 为 `deskfox-local`、版本 `2026.11.1`；包内 2511 个 out 文件与本轮构建输出逐字节一致。此为构建与产物完整性验证，不等于安装升级或原生附件交互通过。

## 验收边界

- 首轮历史分页冒烟失败没有忽略：独立带 trace 运行 1 pass，随后完整 smoke/user-story 21 pass，均 retries=0。根因未复现，不宣称已修复。原测试未改。
- Windows 目录 fsync 的 EPERM 保留为平台限制，未通过跳过目录同步削弱删除墓碑的持久化保障。目标 Linux 的存储、重启、灾备补验已通过，见下文。本机 WSL 无已安装发行版。
- 本轮没有修改线上站点、实际分享数据或保留政策；不把构建成功当作运营验收通过。
- 原生剪贴板与选择器已补验；Explorer 外拖、macOS/手机真机和安装升级仍未关闭。

## 2026-10-16 原生与目标 Linux 补验

实际启动本轮 Windows local 包，通过原生项目选择器打开仅含合成文件的新测试项目。混选 945013 字节 CSV 与 PNG 后，CSV 显示路径引用，PNG 为图片附件；在 Windows 文件对话框复制 small.txt、取消选择器、在实际编辑器粘贴，新增路径引用。添加 312334 字节合成 PDF 后仍为 PDF 附件；点击发送出现 305.1 KiB 成本确认，中文取消后附件与两个文本引用保留，项目会话列表未新增。未点击继续发送、未发真实计费模型请求。

用户明确授权将约 13MB 的合成测试及本轮构建上传既有 deskfox.ai 的独立临时目录。Bun 1.3.14 便携运行时通过官方 SHASUMS256 校验，不安装到系统。复用服务独立 Node 22.23.3，随机 loopback 端口、临时文件，未重启/修改生产服务。

原有七个服务测试文件以 Bun 打包携带实际实现运行：30 pass、2 fail。30 项涵盖真实文件仓储、权限/容量拒绝、取消墓碑、备份恢复、跨区/篡改拒绝、写入/file fsync/rename/directory fsync 的错误和强杀八边界，以及独立原子写入进程强杀。两个失败属于本轮 Windows 构建制品的生产 API/重启流程（响应不是预期 JSON），不能标通过。

后续真实 SolidStart 路由发现回归先失败，定位到 fs-routes/router 的 node:path.normalize 在 Windows 把 URL 路径变成反斜杠。增加 pathe.normalize 最小补丁后，配置与路由回归 2 pass /4 assertions、enterprise 类型检查通过；当时重建制品等待 Linux 复验。新增诊断脚本上传曾被自动审批以超出先前归档载荷范围拒绝，随后取得用户明确授权后继续；没有通过内联脚本或重新包装绕过。

随后用户明确授权后续合成验收与诊断脚本上传。修正制品在同一独立 Linux 目录复验：七个测试文件 **32 pass、0 fail、255 assertions**，包括真实 Node 生产 API、SSR/静态资源、撤销和三代进程重启。原先两个失败已由路由修复关闭。最终日志保存为本轮输出目录 `linux-final.log`；修正归档 SHA256 为 `498ed51de0e1a02b37c5afd66cfb4041b1aa96e23fe9f5569f5a5044f8933189`。

公开分享原有 Playwright 桌面及移动视口测试 **2 pass，5.6 秒，零重试**，覆盖富文本、图片、数学公式、工具、diff 和撤销。直接 SSH 链路首次超时，诊断发现 622KB 资源传输约 51 秒；最终测试从本地读取同一构建的静态文件，所有动态发布、读取及撤销仍通过隧道访问隔离 Linux 服务。没有修改原断言、超时或增加重试；此验证不涵盖线上 CDN 性能。

Windows 原生补验另覆盖英文成本确认及 Escape 取消后草稿保留、未知二进制拒绝且草稿保留，结束时语言恢复简体中文。未确认真实模型发送。Explorer 跨窗口拖放受到当前自动化接口窗口边界限制，尚未完成。安装升级因本机没有隔离 Windows 环境且正式应用正在使用，未覆盖；当前 unpacked local 候选包不能作为 NSIS 安装升级通过的证据。macOS、手机真机及 WSL/SSH 原生附件流程亦无通过结论。

## R4 提交前复核

`package.json`：补丁必须登记到包管理器入口才能在干净安装后生效。应用 wrapper 无法修正依赖内部在解析前已生成的非法 JavaScript；只在 Vite 下游改 alias 已晚于字符串转义。`bun.lock`：由 Bun 同步保存同一补丁声明，保证锁定安装一致。新增 patch 与回归为 fork 文件。

风险：改变服务端函数生成器的导入路径及入口 define，须保留 Linux/macOS 构建复核。验证：Windows 先红后绿的真实配置回归、完整生产构建、enterprise 类型检查。回退：一起移除补丁声明、lock 对应项、patch 与回归，重新安装锁定依赖。根清单与锁文件涉及 R4，提交前仍需按仓库规范完成审签；本轮不执行 Git commit。

验收结束已停止本轮 loopback 服务及 SSH 隧道，确认远端 14419 无监听，正式 deskfox-share 服务仍为 active。合成测试临时目录与日志保留供复核。
