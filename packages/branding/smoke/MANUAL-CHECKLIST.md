# DeskFox 人工验收单

> [fork-only] **长期复用资产**。与 [`CHECKLIST.md`](./CHECKLIST.md)(63 项总清单)配套:
> 总清单里**自动化能覆盖的**由 `run_group2/3/4/567.py` 跑;本文件收的是**自动化原理上做不到**的那些。
> [feat: ui-probe-toolkit] 2026-08-13 立
>
> 每条都写清:**为什么机器做不到** —— 否则下次会有人(包括我)又去写一版跑不通的脚本。

## 零、开跑前(2 分钟)

```bash
# 1. 用本地版,不要用你日常在用的正式版
open "/Volumes/ExtSSD/opencode-fork/packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app"

# 2. 需要时切到自建测试项目(含各格式样本,可随便折腾)
python3 packages/branding/smoke/make_fixtures.py
python3 packages/branding/smoke/open_project.py /Volumes/ExtSSD/deskfox-uitest
```

**本地版与正式版三层隔离**(身份 `ai.deskfox.app.local` / 数据 `opencode-local.db` / 配置),
怎么折腾都不会碰到你正在用的正式版。

⚠️ 唯一的例外是下面 **#7 文件关联**与 **#8 深链**:这两条走的是**系统级路由**,
macOS 只认「哪个 app 注册了这个类型/协议」,很可能把请求交给**正式版**。
所以做这两条时要么接受「验的是正式版的路由」,要么先临时退出正式版。

---

## 一、只能人工验的项(共 5 条,约 15 分钟)

> 2026-08-14:原 10 条中 **#10/#11/#12 已自动化**、**#7 功能不存在已移出**、**#51b/#56/#57 user 已自验通过**。剩下这几条见下。

### ~~#7 文件关联~~ —— ⚠️ **功能不存在,已移出本单**

实测:打包产物 `Info.plist` 的 **`CFBundleDocumentTypes` 为空** —— DeskFox 一种文件类型都没注册,
双击 `.md` 永远不会打开它。且**基准版没有、全仓历史从未有过、上游 anomalyco/opencode 也没有**
(上游只声明 `protocols: { schemes: ["opencode"] }`)。三方一致 = **从未实现**,不是缺陷。

原条目是把「一个桌面应用大概该有的功能」当成了「DeskFox 有的功能」——
与 #12(崩溃恢复对话框实为静默自愈)、#21(通知面板实为第三方库无障碍标签)、
#48(重开标签是上游新命令)同类,**这已经是第四次**。

已转为需求 ⏸「有条件的拒绝」:
[`OPENCODE-PLAN/需求池/文件关联-双击文件用DeskFox打开.md`](../../../../OPENCODE-PLAN/需求池/文件关联-双击文件用DeskFox打开.md)
(主因:DeskFox 打开的是**项目**不是孤立文件,「双击的散落文件属于哪个工作区」没有好答案)。

### #8 深链 `opencode://`

「深链」= 一条 `opencode://` 开头的链接,**点一下就让 DeskFox 打开指定项目**。
用途是从外部唤起:飞书消息里放一条链接、同事一点就跳到对应项目;或文档里放链接直达工作区。

实测支持**两条**路由(`packages/app/src/pages/layout/deep-links.ts`),没有别的:

```bash
# ① 打开项目(file 参可选,相对项目根;首启引导就是用它把介绍文档作首个 tab)
open "opencode://open-project?directory=/Volumes/ExtSSD/deskfox-uitest"
open "opencode://open-project?directory=/Volumes/ExtSSD/deskfox-uitest&file=README.md"

# ② 在指定项目下新建会话(prompt 参可选,预填提示词)
open "opencode://new-session?directory=/Volumes/ExtSSD/deskfox-uitest"
open "opencode://new-session?directory=/Volumes/ExtSSD/deskfox-uitest&prompt=你好"
```

| | |
|---|---|
| **通过** | ① 打开项目:切到该项目;带 `file` 时该文件作为 tab 打开<br>② 新建会话:在该项目下开出新会话;带 `prompt` 时输入框已预填 |
| **失败记什么** | 是否唤起、停在哪个页面;`~/Library/Application Support/ai.deskfox.app.local/logs/` 最新日志里 `deep link received` 那行 |
| **机器为什么做不到** | URL scheme 由 LaunchServices(Win 为注册表 `HKCU\Software\Classes\opencode`)分发,在应用进程之外 |
| **注意** | ⚠️ 之前本单写的 `open "opencode://session"` **是错的** —— 没有这个 hostname,跑了静默无反应,会被误判成「深链坏了」。<br>另:`opencode` 协议**正式版也注册了**,系统可能把链接交给正式版。要验本地版先退正式版。 |

**Windows 用这套命令**(PowerShell;`open` 是 macOS 的):

```powershell
Start-Process "opencode://open-project?directory=D:/deskfox-uitest"
Start-Process "opencode://open-project?directory=D:/deskfox-uitest&file=README.md"
Start-Process "opencode://new-session?directory=D:/deskfox-uitest"
Start-Process "opencode://new-session?directory=D:/deskfox-uitest&prompt=你好"
```

⚠️ **Win 端协议是「后启动者通吃」**:`index.ts` 的 `app.setAsDefaultProtocolClient("opencode")` 每次启动都写
`HKCU\Software\Classes\opencode\shell\open\command`,**本地版一启动就把协议从正式版抢走**。
所以 Win 上验这条**不必先退正式版**(与 macOS 不同),但**验完要还回去** ——
重开一次正式版即可,或直接改回注册表值:

```powershell
Set-ItemProperty 'HKCU:\Software\Classes\opencode\shell\open\command' -Name '(default)' `
  -Value '"C:\Users\<你>\AppData\Local\Programs\deskfox\DeskFox.exe" "%1"'
```

不还回去的后果:以后点任何深链都会打开那个本地测试版。日志在 `%APPDATA%\ai.deskfox.app.local\logs\<最新目录>\`。

### #9a 拖文件进聊天输入框 → 变成**附件**

| | |
|---|---|
| **步骤** | 从访达把 `deskfox-uitest/images/sample.png` 拖到 DeskFox 的聊天输入框,松手 |
| **通过** | 文件进入待发送区(输入框上方出现附件卡片),可随消息一起发出 |
| **额外验** | ① 一次拖**多个**文件都能进(实现里有 `parseMultiPathDropPaths`)<br>② 当前模型**不支持图片**时,拖图片应被拦下并给提示(REQ-026),不是静默丢弃 |
| **实现位置** | 路由 `prompt-input/external-drop.ts`(纯函数,已 16 条单测);接线 `attachments.ts` |
| **2026-08-14 行为变化** | 非图片改走**路径引用**,任何类型都拖得进来;图片仍内联。二进制拖进来后 agent 仍读不了(档二解决),但会明确报错 |
| **机器为什么做不到** | 系统级拖放(NSDragging)不经过 renderer;CDP 的 `Input.dispatchDragEvent` 只能模拟**页面内**拖拽,喂不进跨进程的文件拖放 |

### #9b 文件树内拖动 → **移动文件**

| | |
|---|---|
| **步骤** | 在文件树里把 `code/plain.txt` 拖到 `docs/` 目录上,松手 |
| **通过** | 文件真的移动到 `docs/`(树刷新,磁盘上文件也在新位置);同名冲突时有询问而非静默覆盖 |
| **实现位置** | `packages/app/src/utils/file-tree-dnd.ts` + `file-conflict.ts` |
| **可否自动化** | **可以** —— 这是**页面内**拖拽,CDP 能模拟。尚未补进脚本,属可补缺口 |

### ~~#10 首启引导 / #11 更新器 / #12 崩溃恢复~~ —— 已全部自动化(2026-08-14)

这三条我原先写了「机器为什么做不到」,**判断是错的**,user 质疑后重做,现由
[`run_group1_native.py`](./run_group1_native.py) 全自动跑通:

| # | 现在怎么验 |
|---|---|
| 10 | 用**产品自带的 `OPENCODE_TEST_ONBOARDING=1` 钩子**跑全新安装语义(userData/XDG 全指临时目录、DB `:memory:`),断言建出 `New DeskFox` 并自动打开为工作区。**完全不碰真实档案** |
| 11 | 本地版**按设计禁用更新器**(`UPDATER_ENABLED`),故判据是「菜单项存在且置灰」。⚠️ **完整的「点开 → 对话框 → 中文文案」仍需 prod/beta 包**,见下方保留条目 |
| 12 | CDP `Page.crash()` 造真崩溃(reason=`crashed`,可数;`pkill` 是 `killed` 不算)→ 断言恢复对话框出现、三个按钮齐、点「重新启动」后恢复 |

> **#12 顺带更正了一处我判反的结论**:我曾断言「崩溃恢复没有对话框,是静默自愈」,
> 依据只有 `renderer-crash-guard.ts`,**看漏了 `windows.ts` 的 `wireWindowRecovery`**。
> 总清单原文是对的。实测文案:`DeskFox 窗口意外终止 / 原因:crashed / 代码:5`。

### #11b 更新器完整对话框(**需 prod / beta 包**)

| | |
|---|---|
| **前置** | 本地版验不了 —— `UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev" && CHANNEL !== "local"` |
| **步骤** | 在 prod 或 beta 包上:菜单栏 → DeskFox →「检查更新…」 |
| **通过** | 弹出对话框、**文案是中文**、按钮可点;无更新时给「已是最新」之类明确反馈 |
| **机器为什么做不到** | 不是做不到,是**当前测试环境没有 prod/beta 包**。有包时这条同样可自动化(判据与 #12 同构) |

### #4 托盘「保持电脑不休眠」

| | |
|---|---|
| **步骤** | 点托盘图标 →「保持电脑不休眠」→ 勾上 → 完全退出应用 → 重新打开 → 再看托盘 |
| **通过** | ① 勾选态在重启后**保持**<br>② 开启期间 `pmset -g assertions` 里能看到 `PreventUserIdleSystemSleep` 且持有者是 DeskFox |
| **收尾** | 记得取消勾选,别让机器一直不休眠 |
| **机器为什么做不到** | 勾选态本身 AppleScript 读得到(可自动化),但「重启后保持」+「系统断言真的生效」需要跨进程重启与系统级观察,值得人过一遍 |
| **Windows 差异** | 实现是**跨平台同一套**(`deskfox/prevent-sleep.ts` → Electron `powerSaveBlocker`,非 macOS 专属),Win 上一样验。<br>系统断言查法换成**管理员** PowerShell 跑 `powercfg /requests`(看 `SYSTEM:` 段有无 DeskFox);`pmset` 是 macOS 命令,Win 上没有 |

### #51b 创作模式「生成一次」(**会花钱**)

| | |
|---|---|
| **步骤** | composer 右下角模式下拉 →「文生图」→ 输入一句提示 → 发送 |
| **通过** | 出图并在会话里正常渲染;失败时给明确错误,不是静默无响应 |
| **机器为什么不做** | 会真的调用付费接口。自动化里**默认不烧钱**,所以脚本只验到「入口在、8 档可切」为止(#51 已通过) |
| **其他 7 档** | 图片编辑 / 文生视频 / 图生视频 / 语音合成 / 语音识别 / 专业翻译,同理按需人工抽验 |

### #56 飞书账号 / 工作区绑定

| | |
|---|---|
| **步骤** | 设置 → 飞书桥接 → 走完账号绑定与工作区绑定流程 |
| **通过** | 绑定成功并持久化(重启后仍是已绑定) |
| **机器为什么做不到** | 需真实飞书账号 + 站外 OAuth 授权页交互,自动化不该代按 |

### #57 群消息 @ 策略 / 重试反馈

| | |
|---|---|
| **步骤** | 在真实群里 @ 机器人发一条;再造一次失败(如断网)看重试反馈 |
| **通过** | @ 策略按设置生效;失败有可见反馈而非静默丢弃 |
| **机器为什么做不到** | 依赖真实群聊消息往返,链路在站外 |

---

## 二、曾经的缺口 —— 已全部补成脚本(2026-08-14)

本节原先列了 8 条「本可自动化但尚未覆盖」的项。**现已全部补齐**,不再是缺口:

| # | 条目 | 归属脚本 |
|---|---|---|
| 16 | 面板开关矩阵(树/审查/终端 **8 种组合**) | `run_group2.py` |
| 22 | 切换终端 / 新建终端 | `run_group2.py` |
| 26 | 聊天引用(卡片入输入区 + 点击不开空白页) | `run_group3.py` |
| 27 | md 内链拦截(站内跳转 + 无浏览器被拉起) | `run_group3.py` |
| 59 | 主题真切 Fox Blue(`--surface-base-active` → `#7295c452`)并切回 | `run_group567.py` |
| 62 | MCP 开关真执行一次并复位 | `run_group567.py` |
| 63 | 服务器列表(只有一个本地服务器,**无从切换**;workspace 切换由 #19/#18 覆盖) | `run_group567.py` |
| 55 | 飞书页开关翻转 + **落盘复核**(键 `preventSleepConfig`)+ 复位 | `run_group567.py` |

四组当前状态:第 2 组 7/7、第 3 组 16 通过 2 跳过、第 4 组 11/11、第 5~7 组 11 通过 2 跳过,
**待处理 0**。仍在跳过的只剩三条,都是真的做不了:
#23b 分享(需 user 逐次授权)、#56 飞书绑定、#57 群消息往返。

> **保留本节而不是删掉**,是因为它记录了「哪些曾被当成『不能自动化』、后来发现其实能」——
> 下次再有人想把某条塞进人工单时,先看看是不是同一类误判。

## 三、执行记录(每轮复制一份填)

### 2026-08-14 · Windows · DeskFox 本地版 2026.9.1 · user 自验

分支 `sync/upstream-2026-08-10`,配合 [`../../../docs/features/upstream-sync-2026-08/7-windows-verification.md`](../../../docs/features/upstream-sync-2026-08/7-windows-verification.md)。
产物 `dist-deskfox/win-unpacked/DeskFox 本地版.exe`(LOCAL 徽标 / UA `DeskFox本地版/2026.9.1` / soffice + presets 5 项随包)。

| # | 条目 | 结果 | 备注 |
|---|---|---|---|
| 8 | 深链(两条路由) | ☑ 通过 | 四条 `Start-Process` 全部正确响应;验后协议已写回正式版 |
| 9a | 拖文件进聊天框 | ☑ 通过 | 图片走附件、非图片走 `@` 路径引用(正斜杠) |
| 9b | 文件树内拖动 → 移动文件 | ☑ 通过 | |
| 11b | 更新器对话框 | ☐ **跳过** | 本地版**原理上验不了**:`UPDATER_ENABLED = isPackaged && CHANNEL !== "dev" && CHANNEL !== "local"`。需 prod/beta 包,属发版前动作 |
| 4 | 防休眠 | ☑ 通过 | 跨平台同一套 `powerSaveBlocker` |

**结论:Windows 侧人工项除 #11b(前提不满足)外全部通过,无缺陷。**

---

日期:____________  版本:____________  执行人:____________

| # | 条目 | 结果 | 备注 |
|---|---|---|---|
| 8 | 深链(两条路由) | ☐ 通过 ☐ 失败 ☐ 跳过 | |
| 9a | 拖文件进聊天框 → 附件 | ☐ 通过 ☐ 失败 ☐ 跳过 | |
| 9b | 文件树内拖动 → 移动文件 | ☐ 通过 ☐ 失败 ☐ 跳过 | |
| 11b | 更新器对话框(需 prod/beta 包) | ☐ 通过 ☐ 失败 ☐ 跳过 | |
| 4 | 防休眠 | ☐ 通过 ☐ 失败 ☐ 跳过 | |
| 51b | 创作生成一次 | ☑ 通过(user 2026-08-14 自验) | |
| 56 | 飞书绑定 | ☑ 通过(user 2026-08-14 自验) | |
| 57 | 群消息策略 | ☑ 通过(user 2026-08-14 自验) | |

**填「失败」时务必记下:实际现象 + 截图 + 日志片段。** 只写「不行」的条目,下次没人能复现。

## 四、维护规则

1. 新增「自动化做不到」的条目时,**必须写明为什么做不到** —— 否则下次会有人重复写一版跑不通的脚本。
2. 第二节里的条目一旦补成脚本,就从本文件移走、并在 `CHECKLIST.md` 标注对应脚本。
3. 发现条目本身写错了(如 #12「恢复对话框」实为静默自愈),**就地更正并注明依据的源码位置** ——
   规则同 `CHECKLIST.md` §三之二。
