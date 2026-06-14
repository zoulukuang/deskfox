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

## 阶段 2 — 本地完整 DEV 安装包 + Office 预览端到端验证(2026-06-14)

按 user 决策"先本地出带 Office 预览的完整安装包(DEV),不碰服务器/不发版"推进:

1. **生成 Win LO bundle**:`prepare-lo-bundle.ps1`(TEMP 重定向到 D 盘防 C 盘 7GB 爆)→ 下载 LibreOffice
   25.8.7 MSI(349MB)→ msiexec /a 解压 → 剥皮(extensions 内容 460MB / resource 语言 264MB / config
   图标 71MB 等)→ **[3.5/4] 冷启动 smoke 通过**(剥皮后能建 profile + 转换)→ 输出
   `libreoffice-bundle/windows`(647MB,soffice.exe + presets 13 文件)。
2. **完整 build**:`build-deskfox-electron.ps1 -Env dev`(无 -NoBundle)→ §3.5b LO 门槛放行
   ("LO bundle 健康 636MB,presets 非空")→ electron-vite build → electron-builder `--win` NSIS
   (LZMA 压 636MB LO)→ **§5.5 post-build verify:最终包含 soffice.exe + 非空 presets ✓** → 产物
   `dist-deskfox\DeskFox-Dev-2026.7.0-win-x64.exe`(**276MB**,signtool 已签 + blockmap)。
3. **Office 预览端到端**(用**打包后** win-unpacked 的 soffice,全新冷 profile):
   - `.txt → PDF` ✅(引擎二进制完整 + presets bootstrap + PDF 导出)
   - `.rtf → PDF` ✅(Writer RTF 导入滤镜)
   - `.xlsx → PDF` ✅(Calc OOXML 导入滤镜;fflate 造合规 zip)
   - 全部输出 `%PDF-` 文件头。落点 `win-unpacked\libreoffice\program\soffice.exe` = 后端现有探测路径,精确吻合。
4. **完整包冷启动健康**:启动 win-unpacked\DeskFox Dev.exe,内嵌 Node 后端监听 127.0.0.1,两端点
   HTTP 401(鉴权=健康),6 进程正常。

> 全程 0 代码改动(LO bundle / 安装包均 gitignored 产物);仅本文档记录。

### 仍待真机 QA(CDP/headless 不可替代)

- **应用内** Office 预览 UI(双击文件 → DeskFox 内嵌 PDF 预览渲染):引擎链已证可用,但"在 app 界面里
  点开 office 文件看到预览"的视觉/交互须真机验。
- 防睡眠开关托盘↔设置双向同步、HTML 预览右键"加入聊天":单测覆盖逻辑,视觉/native 须真机验。
- NSIS 安装包真机安装一遍(装到 `AppData\Local\Programs\deskfox-dev`)再走一遍上述,属阶段2 收尾真机 QA。

## 回退方法

- 全部改动 fork-only(脚本新增 + config fork 段),`git revert <commit>` 可单独回退,**0 上游侵入、0 黑名单改动**。
