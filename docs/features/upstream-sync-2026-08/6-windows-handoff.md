feat-id: upstream-sync-2026-08
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./4-verification-checklist.md ./5-handoff.md ./7-windows-verification.md

# Windows 端适配测试清单(拉到本分支先读这个)

> 🪟 **2026-08-14 Win 端回执:本清单已执行完毕,结果见
> [`7-windows-verification.md`](./7-windows-verification.md)。**
> 下面正文保留原样(它是 Mac 端当时的判断,有价值),但**三处前提经实测不成立**,
> 照着做会走弯路,先看这里:
>
> | 位置 | 原文 | 实测 |
> |---|---|---|
> | §零② | Mac 脚本大部分要重写 | `uiprobe.py` 的 CDP 部分**一行没改**;绑死 macOS 的只有 native 一层,已抽成 `uiprobe_native.py` 按平台分派,两端同一份脚本 |
> | §二 P1-1 | Win 是应用内菜单栏(`autoHideMenuBar`) | Win **没有原生菜单**(`createMenu()` 对非 darwin 直接 return);菜单是渲染层组件 `windows-app-menu.tsx`,**只能 CDP 验,UIA 验不到** |
> | §二 P1-2 | Win 内置 LO bundle 记为待办 | **早已内置且可用**;docx/xlsx/pdf 预览实测全部渲染成功 |
>
> 另:§零① 说的 3 项单测红已由 `bd13f5dabc` 修掉,**不必再 `--no-verify`**;
> 但 Windows 上另有一条 `no-row-reverse.test.ts` 因 `URL.pathname` 带盘符斜杠而恒红,见 `f05ce5494f`。

> 2026-08-14 立,Mac 端写给 Win 端。**Mac 侧已全量验完**,本文件只讲 **Windows 特有的部分** ——
> Mac 已验过的通用功能不必重跑,重跑也基本白花时间。
>
> 分支:`sync/upstream-2026-08-10` · main 一行未动、未合 · 两端都绿才合 main。

## 零、你会先撞到的两件事(先读,省 1 小时)

### ① `git push` 会被 pre-push 闸拦下 —— **不是你的锅**

3 项单测红:`packages/app/src/context/server-session.test.ts` 的
`projects V2 session events…` / `indexes V1 messages…` / `does not scan cached messages…`。

- **不是本轮工作引入的**:回退到 `5d2e316801` 实测同样红。
- **是上游随本次同步带进来的**(该文件无 FORK 标记,对应上游 PR #41001 / #38818 / #38641)。
- **性质**:期望与实收内容其实一致(实收是期望的超集,`toMatchObject` 本该过);
  且同一测试里上一行 `.map(m => m.id)` 的断言是过的 —— `.map()` 会取值,
  直接比对拿到的是 SolidJS store proxy。判为 **bun `toMatchObject` 与 store proxy 不兼容**,
  非产品缺陷。详见 `4-verification-checklist.md`。
- **你要推分支**:同样用 `git push --no-verify`,**并在 commit 里写明原因**。
  ⚠️ 但**合 main 前必须收口**(R5 不允许带红合 main),这是双方共同的前置。

### ② Mac 端写的测试脚本,大部分在 Windows 上跑不了

`packages/branding/smoke/` 下这轮新增了 5 个脚本,**移植成本差别很大**:

| 脚本 | osascript 依赖 | Windows 可用性 |
|---|---|---|
| `run_group2.py`(主界面骨架 7 项) | **0 处** | ✅ **可直接跑**(纯 CDP) |
| `make_fixtures.py`(生成测试样本) | 0 处 | ⚠️ 可跑,但 **`APP` 常量写死了 mac 的 soffice 路径**,PDF 生成会跳过 —— 改成 Win 的 `soffice.exe` 路径即可 |
| `run_group567.py`(创作/供应商/设置 13 项) | 2 处 | 🟡 改动小(只有原生菜单断言) |
| `run_group4.py`(文件与预览 11 项) | 5 处 | 🟡 中等 |
| `run_group3.py`(会话与聊天 18 项) | 11 处 | 🟡 中等 |
| `open_project.py`(打开项目) | 12 处 | 🔴 **要重写**(驱动的是 macOS NSOpenPanel) |
| `run_group1_native.py`(首启/更新器/崩溃恢复) | 9 处 | 🔴 **要重写**(菜单/对话框全是 AppleScript) |
| `uiprobe.py`(工具包本体) | 29 处 | 🟡 **核心可用**:`click/key/type_text/drag/find_element/overflow_of/is_occluded/css_var/shot/zoom_shot/deep_find_text/selection_text` 全是 CDP,跨平台。**macOS 专属**的是 `window_geometry`(AppleScript 取窗口)、`heal_window`、`key_native`、原生对话框读取 |

**建议**:先跑 `run_group2.py` 验证工具链在 Win 上通,再按需移植其余。
移植时优先把 AppleScript 换成等价的 Win 自动化(pywinauto / UIAutomation),
而不是把断言删掉 —— 删断言等于把测试变成装饰品。

## 一、环境准备

```powershell
git fetch origin
git checkout sync/upstream-2026-08-10

# 本地测试版(独立身份 ai.deskfox.app.local + 数据隔离,不打扰你在用的正式版)
packages\branding\scripts\build-deskfox-electron.ps1 -Env local
# 最快(额外跳过 LibreOffice):
packages\branding\scripts\build-deskfox-electron.ps1 -Env local -NoBundle
```

产物:`packages\desktop\dist-deskfox\win-unpacked\DeskFox 本地版.exe`
带 `--remote-debugging-port=9222` 启动才能跑 CDP 脚本。

**只杀本地版,别通杀**:
`Get-Process -Name 'DeskFox 本地版' -ErrorAction SilentlyContinue | Stop-Process -Force`

生成测试样本项目(改掉 soffice 路径后):
`python packages\branding\smoke\make_fixtures.py`

## 二、Windows 特有测试清单(按风险排序)

### P0-1 外部拖入的路径写法 ⭐ 本轮新功能,**最高风险**

2026-08-14 新增「外部拖入非图片改走路径引用」([feat: external-drop-path-ref])。
第一版**就是在这里埋了 Windows 坑**(反斜杠没归一化),Mac 端自查时发现并修了,
但**修法只在 Mac 上验过**,Win 端必须实测。

- [ ] 从资源管理器拖 `C:\...\报告.docx` 进聊天框 → 输入框出现 `@C:/.../报告.docx`
      (**正斜杠**,不是 `C:\`)
- [ ] 拖一个**本来就在项目里**的文件 → 插入的是**相对路径**(与文件树拖入完全一致)
- [ ] **跨盘符**:项目在 `D:\`、文件在 `C:\` → 插入完整绝对路径(正斜杠)
- [ ] 拖 `.png` → 仍是图片附件卡片(不是路径引用)
- [ ] 拖多个混合类型 → 图片走附件、其余走引用,互不干扰
- [ ] agent 能按插入的路径**真的读到**该文件(项目外应出现 `external_directory` 权限询问)

> 单测已覆盖 W1–W5(含跨盘符),但那是纯函数层;**真机的 `getPathForFile` 返回值形态没人验过**。

### P0-2 构建 / 安装包 / 三档身份

- [ ] `-Env local` 出包成功,`DeskFox 本地版.exe` 能起
- [ ] `-Env dev` 出 NSIS 安装包,安装/升级/卸载正常
- [ ] 三档身份隔离:local / dev / prod 各自数据目录、可共存(local 与发布档共存;发布三档互斥)
- [ ] 版本号来源正确(读 `installer-versions.json`,不是硬编码)

### P0-3 路径与进程处理(同步动过 **68 个含 win32 判断的文件**)

同步涉及的 Win 敏感面:`core/fs-util.ts`(路径归一化)、`core/pty.ts` + `pty.node.ts`(终端)、
`core/shell.ts`、`core/ripgrep/binary.ts`、`core/cross-spawn-spawner.ts`、
`core/filesystem/watcher.ts`、`desktop/src/main/{index,server,windows,background-cli}.ts`。

- [ ] 打开含**中文/空格路径**的项目,文件树、预览、搜索都正常
- [ ] 全局搜索 ⌘K/Ctrl+K 的文件结果能命中(ripgrep 二进制路径)
- [ ] 终端能开、`shell prompt` 正常、能跑命令(ConPTY)
- [ ] 文件监听生效(改文件后树/审查有反应)

### P1-1 菜单与中文化(**Win 与 Mac 实现不同**)

`desktop-menu.ts` 里条目带 `platforms: ["macos"] | ["windows"]` 区分,
Win 是**应用内菜单栏**(`autoHideMenuBar: true`),不是 macOS 那套原生菜单。
Mac 端这轮修过 `[窗口]` 菜单三个 role 项的中文化 —— **该修复与 Win 无关**,但要确认 Win 菜单自身没有英文残留。

- [ ] 菜单栏各顶层逐个展开,**全中文**,无英文残留
- [ ] 快捷键按 Win 习惯(`Ctrl+` 而非 `Cmd+`)
- [ ] 托盘菜单全中文、功能可用(打开 / 状态 / 保持不休眠 / 退出)
- [ ] 关窗到托盘 → 托盘点击可恢复

### P1-2 LibreOffice 预览(**Win bundle 是已知待办**)

`office-installer.ts` 有 Win x64 的 MSI 下载路径,但 **Win 端内置 bundle 此前记为待办**。

- [ ] 预览 `.docx` / `.xlsx` / `.pdf` —— 能转出来还是提示未安装?
- [ ] 若未内置:提示是否清晰、是否有安装引导,**不能静默失败或卡死**
- [ ] 若已内置:确认剥皮后 `presets/extensions` 未被删(删了必崩,历史踩过)

### P1-3 首启引导 / 更新器 / 崩溃恢复(Mac 端已自动化,Win 需等价验证)

- [ ] 首启引导:干净档案下建 `New DeskFox` + 介绍文档并自动打开
      (Mac 用产品自带 `OPENCODE_TEST_ONBOARDING=1` 钩子跑,**Win 同样可用**,值得优先复用)
- [ ] 更新器:Win 上 `UPDATER_ENABLED` 同样对 local/dev 关闭 → 菜单项应置灰;
      完整对话框需 prod/beta 包
- [ ] 崩溃恢复对话框:CDP `Page.crash()` 造崩溃 → 对话框出现、按钮齐、重启后恢复
      (**这条 CDP 部分跨平台**,只有读对话框那步要换 Win 自动化)

### P2 通用功能抽验(Mac 已全绿,Win 抽查即可)

Mac 侧结果:第 2 组 7/7、第 3 组 16 通过、第 4 组 11/11、第 5~7 组 11 通过。
Win 端不必逐条重跑,建议抽这几条(它们最容易被平台差异打到):

- [ ] 文件树展开/点开/高亮/**点击后焦点落入文件树**(本轮修过的回归点)
- [ ] 面板开关矩阵(树/审查/终端 8 种组合)不遮挡不溢出
- [ ] 会话内查找 ⌘F/Ctrl+F 的**关闭键可点**(本轮修过的回归点)
- [ ] 各格式预览:md / docx / pdf / xlsx / 图片 / 超大文件守卫
- [ ] 供应商页 **GetBot 排首位 + 推荐标**(fork 最核心定制点)
- [ ] 设置六页 + 改一项 + 重启后保持

### P2-2 WSL 相关(同步动过 `desktop/src/main/wsl/ipc.ts`)

- [ ] 若你的环境用 WSL:WSL 检测 / 引导流程无回归
- [ ] 不用 WSL 的环境:确认不会被 WSL 检查阻塞启动

## 三、Mac 侧已验过什么(别重复投入)

- 四组自动化清单全绿(见 `4-verification-checklist.md`),**待处理 0**
- 本轮修掉两个真缺陷:文件树点文件后焦点丢失(`1f458b9cbc`)、
  外部拖入路径写法(`543ce8f61d`)
- 判为**非回归**三处:#7 文件关联(功能从未存在,上游也无)、
  #48 重开标签(上游新命令未接入)、#21 通知面板(第三方库标签)
- 人工验收单剩 5 条(`packages/branding/smoke/MANUAL-CHECKLIST.md`),
  其中 #8 深链 / #9a 拖文件 / #9b 文件树内拖动 **Win 端也要各验一次**(系统级交互两端不通用)

## 四、回报格式

发现问题时请给到:**实际现象 + 截图 + 日志片段 + 复现步骤**。
只写「不行」的条目,对面没人能复现 —— 这条 Mac 端吃过亏。

日志位置:`%APPDATA%\ai.deskfox.app.local\logs\<最新目录>\`

判定三态,别只用「过/不过」:
- ✅ 通过
- ⏸ **前提不满足**(环境没准备好,不是缺陷)—— 写清缺什么
- ❌ 缺陷 —— 附上面四件套

> 「前提不满足」单列出来,是 Mac 端这轮最重要的教训之一:
> 把「会话没打开」「面板没展开」笼统记成 FAIL,会让人以为五六个功能一起坏了,
> 反复排查后才发现只是一个前提没准备好。
