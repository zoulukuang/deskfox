feat-id: electron-replatform-windows
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志

## 实际改动(2026-06-14)

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/branding/scripts/build-deskfox-electron.ps1` | 新增 fork-only | Windows Electron 一键构建 wrapper(对称 mac `.sh`),UTF-8 BOM 保存 |
| `packages/desktop/electron-builder.deskfox.config.ts` | 改 fork-only | 加 `targetPlat==="windows"` LO `extraFiles` 注入(`libreoffice-bundle/windows` → app 根 `libreoffice/`) |

> **后端零改动**:`office-installer.ts`(黑名单)不碰。Win LO 走 `extraFiles` 落 app 根,命中后端**现有**
> 探测路径 `dirname(execPath)\libreoffice\program\soffice.exe`。原计划改后端被 pre-commit 黑名单拦截 →
> 反转为配置层方案(详见 2-plan.md「决策反转」)。

### 模块 A — build-deskfox-electron.ps1

逐段对齐 mac `build-deskfox-electron.sh`:
- 版本号预检(`<env>-windows` / prod 裸 `windows` 号线;`[System.IO.File]::ReadAllText(.. ,UTF8)` 读 JSON 防 GBK 乱码)
- icon.ico 就绪(缺则 `png-to-ico.ts` 现场生成,不碰 Tauri `apply-icons`)
- 杀 `DeskFox*` / `opencode-cli` 进程(避免输出目录被锁)
- §3.5a plugin dist 门槛 / §3.5b LO bundle 门槛(presets 非空硬卡;release 缺则 throw,`-NoBundle` 降警告)
- electron-vite build → electron-builder `--win`(`-NoBundle` → `--dir`;shim 用 `electron-builder.exe`)
- 绕 Clash 代理(清 `*_PROXY`,仅本进程)+ `--publish never` + npmmirror
- §5.5 post-build 验证(最终包 app 根 `libreoffice/program/soffice.exe` + 非空 presets)+ 产物路径打印

### 模块 B — config Win LO 注入

新增 `extraFiles` 数组 + windows 分支,以 `program/soffice.exe` 存在为准条件注入到 app 根
`libreoffice/`;config 对象加 `extraFiles` 字段(mac 为空)。bundle 不存在时不注入(不中断本地无 LO 自测)。
mac 段保持 `extraResources`(.app 进 `Contents/Resources`)不变。

## 验证结果(R9 分支内验收闸,Win 真机)

| 用例 | 结果 |
|---|---|
| R3 desktop `bun test src` | ✅ 81 pass / 0 fail(electron mock 基建 + 防睡眠/local-asset) |
| typecheck desktop | ✅ EXIT 0(config `extraFiles` 改动后复验) |
| A4 release 缺 LO 硬失败 | ✅ build 前 exit 1 + 指引 |
| A1 `-NoBundle` 出 win-unpacked + exe | ✅ `dist-deskfox\win-unpacked\DeskFox Dev.exe`(231MB,electron-builder `--dir --win` 全链路通) |
| A2 冷启动健康检查(后端 401) | ✅ 启动产物,内嵌 Node 后端(pid=utilityProcess)监听 127.0.0.1,`/` 两端点 **HTTP 401**(鉴权=健康) |
| B1/B2/B3 注入逻辑 | ✅ 静态正确 + typecheck;`-NoBundle`(无 bundle)走 B2 不注入路径,A1/A2 已验 |

> A1/A2 跑在 `extraFiles` 反转**之前**的等价产物上;反转后 `extraFiles` 空数组对无 LO 的 `-NoBundle`
> 路径是 no-op,行为不变,typecheck 复验通过,无需重跑。

### 运行时·native 风险点(待真机 QA,CDP 自测不可替代)

- 防睡眠开关托盘↔设置双向同步、HTML 预览右键"加入聊天":单测覆盖逻辑,视觉/native 交互须真机验。
- LO 全量注入端到端:需先 `prepare-lo-bundle.ps1` 生成 bundle(本地未生成,~636MB);本轮验了落点路径
  (`extraFiles` → app 根 `libreoffice/`)与后端现有探测路径一致性 + §5.5 门槛逻辑,真机端到端待补。

## 回退方法

- 全部改动 fork-only(脚本新增 + config fork 段),`git revert <commit>` 可单独回退,**0 上游侵入、0 黑名单改动**。
