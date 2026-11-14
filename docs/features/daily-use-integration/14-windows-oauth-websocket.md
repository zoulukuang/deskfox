feat-id: daily-use-integration
status: in-progress
related: ./3-changelog.md ./13-windows-oauth-fix.md ../daily-file-links/1-spec.md

# Windows 默认 OpenAI OAuth WebSocket 复验

执行端：Windows 电脑（YUEXI）。接手基线 `044c9978c8b2cd49de43a3eabd39bd6151b977a4`，登记后的构建基线 `a5a9505eec6da053335358d6e49f542084644248`。

## 复现与定位

以旧隔离 Windows local 包重新启动真实 OAuth 会话。读取文件的普通对话在 177 秒观察窗内没有完成，sidecar 多次报 `WebSocket connect timed out`。旧 exe SHA-256 为 `ee678c825ca20d80e13d4d8bfd0264e3fbb318343facc5f47761032474441903`，app.asar SHA-256 为 `d0917641c40038daad83ba65d0ff460f49806496cfeee5f25ec82c7fa5d18aba`。

同一旧包的 Electron Node 24.19.0 复用真实 OAuth 和原代理，默认 `ws` 握手 8046 ms 超时，调用与 sidecar 相同的 `http.setGlobalProxyFromEnv()` 后仍在 8047 ms 超时。显式注入 Node 原生代理 agent 后 1116 ms 返回 HTTP 101，现有间接依赖里的 CONNECT agent 同样在 789 ms 返回 HTTP 101。此对照把连接问题定位到 Node WebSocket 的代理交接。旧入口只给 Bun 传 `proxy`。

## R4 复核

- `packages/opencode/src/plugin/openai/ws.ts` 在 `upstream-base` 中，触发 R4。独立 helper 负责代理选择，只有创建 WebSocket 的调用点能把 Node 的 CONNECT agent 交给 `ws`。桌面全局代理已有初始化，实测该升级仍超时。外部配置插件实测只接通 HTTPS 诊断路径，覆盖不了默认 WebSocket 建连。上游文件新增 3 行、删除 8 行并加 FORK 标记。
- 新增 `ws-proxy.ts` 复用 `ProxyEnv` 的 `HTTPS_PROXY`、`ALL_PROXY` 和 `NO_PROXY` 选择规则。仅 Node 的 WSS 和有效 HTTP(S) 代理组合传入专用 agent，Bun 仍传原来的 `proxy` 选项。代理 CONNECT 不携带 OpenAI OAuth 头，普通 TLS 校验仍生效。无新增依赖，无全局改动。新测试文件真实启动 Node 与本机 CONNECT 服务，覆盖代理命中、头隔离和绕过。两文件均是 fork 自建。
- 风险范围为使用该传输的 Node WSS 客户端。代理协议实机覆盖 Windows 的 HTTP CONNECT，HTTPS 代理、只有 SOCKS 代理、Mac 实机均未测。回退可撤销这笔产品补丁。
- 冻结产品补丁 SHA-256 `e4ed6caa92c00652e526433c3a69e3416bff6ed69744d36c55ab1259f3103371`。构建目录反向校验通过，三个文件的 Git blob 分别为 `0e4f9c34c3498333afb6e13fa6478385213a19aa`、`fab54e54e54d821940354d4d76bdd6617b7e3650`、`49c7150649df5e2e0d68c24b7ba2289200c34b6c`。

## 自动化

新增回归先在旧入口运行，目标端直连报 `ECONNRESET`，未收到本地 CONNECT 的 502；修后本地 CONNECT 与 NO_PROXY 断言通过。相关 OpenAI 连接、池、默认开关和 OAuth 测试共 50 项通过。代码通过格式和 diff 检查。

完整 `.husky/pre-push` 初次在既有 UI 时序用例 `observe-element-offset.test.ts:50` 报错，失败日志保留。以同一应用用例的 runner 单独验证 7 项通过。提取最小网络注入并冻结最终补丁后，完整闸重跑通过，29 项类型检查与 6 个包测试通过，desktop 有 2 项既有跳过。

## Windows local 构建

独立 worktree `D:/project/deskfox-win-final` 使用登记后基线和上列冻结补丁。Bun 1.3.14 首次冻结安装停在依赖解析，218.72 秒后停止。单次命令使用镜像执行 `bun install --frozen-lockfile` 成功，用时 70.98 秒。锁文件 Git blob 为 `5b829249afb0ae32cd812c2f5a043a29b82c65fc`，构建目录 CRLF 文件 SHA-256 为 `1ce5abf5925e81ae0a5f2ab9ef769706a903b2c4471a1bf4cdbc315b1725bd8b`。随后运行 `pwsh -NoProfile -File packages/branding/scripts/build-deskfox-electron.ps1 -Env local`，构建 113.18 秒，验证包内 LibreOffice。

- EXE `D:/project/deskfox-win-final/packages/desktop/dist-deskfox/win-unpacked/DeskFox 本地版.exe`，SHA-256 `216df402a82a5b8968dc184d495b7002c404c2ea6e8743108e342dc31e4586fc`
- `resources/app.asar`，SHA-256 `02bcc87ed8348a35c2636659e92c12d1cceaeb93a0aedea982beb78fe5e0dc36`

## 默认配置真实 OAuth 六链接

以全新配置、数据库和合成测试项目启动新包，使用原 Windows HTTP(S) 代理和隔离副本 OAuth。应用仍加载随包的两个内置插件，未配置诊断插件、provider 覆盖、传输环境变量或模型桩。向真实 OpenAI `openai/gpt-5.6-luna` 提交两轮普通任务，未明确要求输出链接或 Markdown。读取轮用时 22.94 秒，生成轮用时 15.14 秒。侧车确实执行五个成功读取、一个缺失文件读取和一次写入后读取。模型说明同名文件不存在，也没有为它生成链接。

| 链接 | 整个点击检查耗时 | 内容 | 截图 |
| --- | ---: | --- | --- |
| `中文 空格.md` | 2492 ms | `CN_SPACE` | [截图](./14-windows-evidence/link-1.png) |
| `report%20draft.md` | 588 ms | `LITERAL_PERCENT` | [截图](./14-windows-evidence/link-2.png) |
| `report draft.md` | 544 ms | `REAL_SPACE` | [截图](./14-windows-evidence/link-3.png) |
| `report#节.md` | 552 ms | `HASH_NAME` | [截图](./14-windows-evidence/link-4.png) |
| `100%.md` | 651 ms | `RAW_PERCENT` | [截图](./14-windows-evidence/link-5.png) |
| `生成 OpenAI Windows 复验 fix-ws-default.md` | 530 ms | `OAUTH_WINDOWS_REPORT_FIX-WS-DEFAULT` | [截图](./14-windows-evidence/link-6.png) |

6/6 命中正确文件预览。字面百分号链接的模型原始 href 用 `report%2520draft.md`。逐条时间涵盖等待聊天链接就绪、点击及文件内容显示。另用 Windows 原生鼠标点了字面百分号链接，画面和文件查看器均确认 `LITERAL_PERCENT`。[原生点击截图](./14-windows-evidence/native-literal.png)。

[模型读取原文](./14-windows-evidence/default-read.json) · [模型生成原文](./14-windows-evidence/default-write.json) · [六条 href 和耗时](./14-windows-evidence/default-clicks.json) · [默认会话结果](./14-windows-evidence/default-result.json) · [旧包失败画面](./14-windows-evidence/old-timeout.png) · [同运行时握手对照](./14-windows-evidence/handshake-comparison.jsonl) · [sidecar 摘要](./14-windows-evidence/sidecar-excerpt.txt) · [测试和构建日志摘要](./14-windows-evidence/test-build-excerpt.txt)。

## WebSocket 取证

正式六链验收用上面原封构建的包。为补采协议状态，另在离线复制包的 sidecar 入口加载只读诊断订阅。该订阅从 Node HTTP 客户端事件观察目标的 WebSocket Upgrade，仅记录 101、用时、TLS 是否验证和供给 agent 的类别。诊断副本使用与正式验收相同的默认 OAuth 路径完成实际读写及六次点击，首个主会话 WebSocket 于 1129 ms 收到 HTTP 101，TLS 验证通过。诊断副本 app.asar SHA-256 为 `fde252b909eaf876d9f2c37d2de12f094137e471aa915b0ce6f6ce3e77ab7f9e`。先行的两次观察启动未能加载 sidecar 订阅，各自真实六链接完成的运行记录留在本机，握手取证使用实际加载诊断订阅的副本。[101 记录](./14-windows-evidence/sidecar-websocket-101.jsonl) · [诊断订阅脚本](./14-windows-evidence/observe-oauth-ws.cjs) · [诊断副本构建哈希](./14-windows-evidence/diagnostic-build-start.json) · [诊断会话结果](./14-windows-evidence/diagnostic-result.json)。

所有测试副本的 OAuth 凭据已清理，测试进程及监听已退出，协议注册已恢复。隔离资料目录为 `D:/tmp/deskfox-daily-win-20261114/evidence`。本轮签字限实测 Windows 主机、HTTP CONNECT 环境及真实 OpenAI OAuth 这一条用户路径。其他平台、代理协议和模型通道仍待验。

## R4 提交与推送

用户批准 SHA-256 为 `e4ed6caa92c00652e526433c3a69e3416bff6ed69744d36c55ab1259f3103371` 的三文件冻结补丁。产品提交 `09d0615cc77c96d2213832b0475bf01f95855172` 含 R4 override 标记，提交差异与批准的补丁 SHA-256 完全一致，三个文件的 Git blob 与验收包构建输入一致。产品提交推送的完整 pre-push 再次通过，29 项类型检查及六个包测试通过，desktop 保留 2 项既有跳过。[推送检查摘要](./14-windows-evidence/approved-push-excerpt.txt)。未合 main、未发布。
