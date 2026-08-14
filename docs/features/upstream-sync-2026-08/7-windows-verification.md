feat-id: upstream-sync-2026-08
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./4-verification-checklist.md ./5-handoff.md ./6-windows-handoff.md

# Windows 端适配与验收报告

> 2026-08-14 立,Win 端写给 Mac 端 / user。对应 [`6-windows-handoff.md`](./6-windows-handoff.md) 的逐条回执。
> 分支 `sync/upstream-2026-08-10` · **main 一行未动、未合、未 push**。
>
> 环境:Windows 11 Home China 26200 · DeskFox 本地版 2026.9.1(`-Env local` win-unpacked)
> · 双屏(主屏 2560×1440,副屏在左侧 x=-2160)· 缩放 125%

## 零、一句话结论

**Windows 端可以合。** 4 个 P0/P1 缺陷已在分支内修完并回归,全部自动化用例绿;
NSIS 安装包的安装 / 升级 / 卸载已于 2026-08-14 补做完毕(§七),**全部通过,无遗留项**。

## 一、结果总览

| 组 | 用例 | ✅ 通过 | ⏸ 前提不满足 | ❌ 缺陷 |
|---|---|---|---|---|
| uiprobe 工具包自检 | 18 | 18 | 0 | 0 |
| 第 2 组 主界面骨架 | 7 | 7 | 0 | 0 |
| P0-1 拖入路径写法 | 4 | 4 | 0 | 0 |
| P0-3 路径与进程 | 4 | 3 | 1 | 0 |
| P1-1 菜单与中文化 | 5 | 5 | 0 | 0 |
| P1-2 / P2 六格式预览 | 6 | 6 | 0 | 0 |
| P1-3 崩溃恢复 | 3 | 3 | 0 | 0 |
| P1-3 首启引导 | 3 | 3 | 0 | 0 |
| P2 通用抽验 + WSL | 5 | 4 | 1 | 0 |
| **合计** | **55** | **53** | **2** | **0** |

单元测试:`packages/app` `bun run test` → **1008 + 41 pass / 0 fail**(修前 1 fail,见 §二.2)。
Typecheck:`bun turbo typecheck --filter='!./packages/console/*'` → **29/29 successful**。

两项「前提不满足」是**环境条件**,不是缺陷:
- **P-4 文件监听** —— 需在项目里增删文件后观察树刷新。脚本刻意不写 user 的真实项目;
  且仓内已知「已打开项目的新增文件不刷新」是长期行为,不是本次回归。
- **G-4 更新器菜单项置灰** —— Windows 菜单里**本就没有**「检查更新」,见 §三.1。

## 二、修掉的 4 个缺陷

### 1. 🔴 P0-1 文件树单选拖入的 @ 路径是反斜杠 —— 本 feat 的不变式在 Win 上没成立

`2f30b41c44` · [feat: external-drop-path-ref]

交接文档把这条列为「最高风险」,判断准确,但方向反了:出问题的不是**外部拖入**(那条 Mac 已修对),
而是它的对照组 —— **文件树单选拖入**。同一个文件,四条通道给出两种写法:

| 通道 | 插入的写法 |
|---|---|
| `@` 提及补全 | `docs/产品架构方案.md` ✅ |
| 文件树**多选**拖入 | `docs/产品架构方案.md` ✅ |
| 外部拖入(资源管理器) | `docs/产品架构方案.md` ✅ |
| 文件树**单选**拖入 | `docs\产品架构方案.md` ❌ |

根因:单选走 `text/plain` = `file:${node.path}`,而 `node.path` 是 OS 原生写法(要拿去做 fs 操作),
塞进 @-mention 前没人归一化。多选走 `parseMultiPathDropPaths`、外部拖入走 `toMentionPath`,
两者早已归一化 —— 只有单选这条漏了。**macOS 上路径本就是正斜杠,这条路径原理上暴露不出来。**

- 该行(`file:${local.node.path}`)可追到 2026-04 的 `file-tree-dnd`,**不是本次同步的回归**;
  但本 feat 的 bug-repro 原文就是「同一个文件出现两种引用写法」,在 Win 上并未消除,故在本分支内修掉。
- 改法:`multi-path-drop.ts` 导出 `toMentionSeparators`(唯一事实源),`file-tree.tsx` 与
  `file-tree-v2.tsx` 两处同类 pattern 一并修(v2 当前未启用,只改跑得到的那处等于留复发点)。
- 内部移动走 `application/x-deskfox-paths`(绝对路径),不受影响。
- 测试:`multi-path-drop.test.ts` 新增 13 条(跨盘符 / root 带尾分隔符 / POSIX 恒等变换 / 既有容错)。

### 2. 🔴 row-reverse 源码守卫在 Windows 上从未真正执行过

`f05ce5494f` · [feat: upstream-sync-2026-08]

`no-row-reverse.test.ts` 用 `new URL("../../", import.meta.url).pathname` 取目录 ——
Windows 上得到 `/D:/project/.../src/`(**盘符前多一个斜杠**),`readdirSync` 直接 ENOENT。
于是这个守卫每次以异常收场:`bun run test` 整体红,而它本该检查的 `flex-row-reverse`
**一次也没检查到**。

守卫失效比没有守卫更危险 —— 前者让人以为已经防住了。而这条守卫恰恰是 Mac 端为
「`flex-row-reverse` 修了又复发」专门立的。改用 `fileURLToPath` 后:
- 全仓 grep 过同类,另一处 `theme-preload.test.ts` 把 URL 对象直接交给 `Bun.file`,是安全写法,不动;
- **反向验证**:往 `session-side-panel.tsx` 注入 `flex-row-reverse` → 守卫准确报出 `:152` 并失败;
  还原后 1008 pass / 0 fail。

### 3. uiprobe 截图在 Windows 上会崩

`f574119ba4` · `shot()` 用选择器当文件名,遇 `\ " : * ? < > |` 直接 `OSError` ——
**崩在「未命中自动截图」这个帮忙的动作上**,比原本的未命中更难排查。macOS 只有 `/` 违规,走不到。

### 4. make_fixtures 在 Windows 上会把项目建到不存在的路径

`1cb1dd454e` · `ROOT` 与 `soffice` 路径原为 mac 硬编码。Win 上会建到不存在的 `/Volumes/...`,
且 PDF 生成静默跳过 —— 而预览用例正要用那个 PDF,「没有样本」会一路顺延成「预览验不了」。

## 三、纠正交接文档的三处前提(都是实测)

### 1. P1-1「Win 是应用内菜单栏(autoHideMenuBar)」→ **Windows 没有原生菜单**

`desktop/src/main/menu.ts` 的 `createMenu()` 第一行就是 `if (process.platform !== "darwin") return`。
`autoHideMenuBar: true` 隐藏的是一个**根本不存在**的东西。Win 的菜单是渲染层组件
`components/windows-app-menu.tsx`(自绘标题栏左上角的汉堡),走 Kobalte DropdownMenu 画出来。

后果:这条**不能用 UIAutomation 验**(UIA 树里没有 MenuBar,实测返回空)。
按原文去敲 F10 抓 UIA 菜单只会拿到空列表 —— 差一点记成「菜单丢了」这种假缺陷。

顺带解释 G-4:「检查更新」属于 `DESKTOP_MENU` 的 `app` 组,该组标了 `platforms: ["macos"]`,
`windows-app-menu.tsx` 会把整组过滤掉。**已与合上游前的基线 `e77443750e` 比对,基线同样如此,非本次回归。**
(同组的「导出日志」「重启」在 Win 菜单里也没有;`设置`/`导出日志` 有 command,命令面板可达。)

实测结果:6 个顶层(文件/编辑/视图/转到/窗口/帮助)全部展开,**40 条文案全中文,快捷键为 `Ctrl+`**。

### 2. P1-2「Win 端内置 LO bundle 此前记为待办」→ **早已内置且可用**

`packages/branding/libreoffice-bundle/windows/` 有 647MB 健康 bundle(presets 非空);
build 脚本 §3.5b 硬卡它存在、§5.5 做 post-build 复验;产物含 `libreoffice/program/soffice.exe`。
最直接的证据:`make_fixtures.py` 生成 `sample.pdf` 用的就是**打包产物内那份 soffice**,转换成功。

实测 docx=canvas 2 / xlsx=canvas 3 / pdf=canvas 2 / png=img → **Windows 预览链路完整可用**。

### 3. §零②「Mac 端写的脚本大部分在 Windows 上跑不了,建议重写」→ 改为**按平台分派**

原文按「osascript 依赖数」给了移植成本表,并把 `open_project.py` / `run_group1_native.py` /
`uiprobe.py` 列为「🔴 要重写」。但重写 = 两套工具双轨维护,违背「绝对单一」元原则。

实际做法:`uiprobe.py` 的 CDP 部分**本来就跨平台,一行未改**;绑死 macOS 的只有一层
(窗口几何 / 屏幕枚举 / 真实按键 / 原生对话框),抽进新文件 `uiprobe_native.py` 按平台分派,
Mac 实现原样搬过去、行为不变。于是同一份 `uiprobe.py` / `run_group2.py` 两端都能跑。

`open_project.py` 确实要重写,但产出的 `open_project_win.py` **比 Mac 版更确定**:
Mac 走 ⌘⇧G 呼出「前往文件夹」再敲键盘,回车次数还不固定(其 `press_until` 注释记的正是这个坑);
Win 直接 `WM_SETTEXT` 写进「文件夹:」输入框 + `BM_CLICK` 确认,**把这个不确定性整个消掉**。

## 四、Windows 平台自身的 7 个坑(已写进代码注释,供后来者)

1. **DPI 虚拟化** —— Python 进程不声明 per-monitor-v2 感知,`GetWindowRect` 与 Electron 差一个缩放系数,
   「窗口是否在屏幕外」这类判定整体偏移,而且错得不显眼。
2. **最小化窗口停在 x=-32000** —— 不过滤会把它当主窗口(实测 user 的正式版报出 `199x34`)。
3. **DWM cloaked 窗口** `IsWindowVisible` 返回 true —— `window_count` 虚高,触发「几何不可信」告警。
4. **PS5.1 读无 BOM 的 `.ps1` 按 GBK 解码** —— 中文注释被打乱致整个脚本语法错误,
   表现为每个 verb **静默返回空**;看着像「UIA 树里没有对话框/菜单」,极易当成产品缺陷去查。
5. **PS5.1 `ConvertTo-Json` 把单元素数组拆成对象** —— Python 侧 `len()` 数成字典键个数,
   「1 个对话框」被报成「5 个,指代不清」。
6. **`SendMessageW` 的 lParam 类型随消息而变** —— `argtypes` 定死成 `c_wchar_p` 会让 `BM_CLICK` 报错。
7. **模态对话框阻塞 UI 线程时 UIA 恒返回空** —— 崩溃对话框明明在屏幕上,UIA 却报 0 个。
   据此下结论会得出「崩溃后没弹恢复对话框」这种**完全相反**的判断。
   实测 Electron 消息框的按钮是**真 Win32 `Button` 子窗口**(读得到「重新启动/导出日志/退出」),
   故 Win 对话框一律以 ctypes 为准,UIA 只留给非模态场景。

## 五、写测试时自己制造又修掉的 6 类假信号

这些不是产品问题,但每一条都曾指向一个不存在的缺陷,值得留档:

1. **用文本特征 / 几何邻近找补全弹层** → 先抓到侧栏的项目路径 `D:\Test Question Identification`,
   改成「输入框上方 320px」后又抓到聊天记录里的一条 shell 命令。**几何邻近不是锚点** —— 输入框上方
   本来就是消息流。改用结构锚点(`div[class*="translate-y-full"]` 内的 `button`)。
2. **Kobalte 子菜单触发器是 `aria-haspopup="true"` 不是 `"menu"`** → 判据写死后一个子菜单都没展开,
   而「无英文残留」照样报绿(只验到 6 个顶层词)。**典型假绿**,已加硬闸:可展开项一个没展开即判失败。
3. **泛匹配 `/关闭|close/` 取最后一个** → 终端开着时抓到「关闭终端」(y=823,超视口 804),
   报「被遮挡」。**遮挡检测对视口外的元素没有意义**,那是「没滚过去」,处置完全不同。
4. **点文件树行不先滚到视口** → 树长到 22 条后目标行滚出可视区,点击落空。
   **一个根因造出两条假红**:`images/` 展不开报「没有 png 样本」、README 预览不出内容报「特征词未命中」。
5. **固定 `sleep(3)` 等预览** → 机器忙时不够,README 只读到 391 字就判「特征词未命中」。改按判据轮询。
6. **正则里字面反斜杠写成 8 个** → 变成匹配两个连续反斜杠,Windows 路径里没有,恒不命中;
   把一条本该通过的首启引导用例报成 FAIL(界面其实早就打开了 New DeskFox)。

另有一次 **flaky 的完整定位**(R5 不允许 retry 掩盖):G-1「点文件树后焦点落入文件树」两次跑出相反结论。
先量复现率 —— 连点 12 次 12/12 正常、关弹窗后再点 6/6 也正常;最后定位真因是
**上一个脚本收尾时留了个模态弹窗没关**,点击被遮罩吃掉 → `activeElement=body`。
这是模态框的**正确**行为。已把「开跑前复位 + 弹窗前提断言」做进脚本,两个诊断脚本一并入库。

## 六、三档身份与数据隔离(P0-2,除安装包外已验)

> NSIS 安装包本身的安装/升级/卸载见 §七(已补做,全部通过)。本节是**运行期**的身份与数据隔离。

| 项 | 证据 |
|---|---|
| appId 四档 | 磁盘上并存 `ai.deskfox.app` / `.beta` / `.dev` / `.local` 四个 appData 目录 |
| 数据隔离 | `~/.local/share/deskfox/opencode/` 下 `opencode.db` 与 `opencode-local.db` 并存 |
| local 与发布档共存 | **全程实证** —— user 的正式版 DeskFox(7 个进程)整场测试一直开着,local 独立跑,互不打扰 |
| 版本号来源 | 设置页页脚「DeskFox for Windows v2026.9.1」= `installer-versions.json` 的平台裸号(local 回落),非硬编码 |
| 渠道徽标 | 标题栏显示 `LOCAL` |
| 产物命名 | `DeskFox-Local-` / `DeskFox-Dev-` / `DeskFox-` 前缀由 config 的 `ARTIFACT_PREFIX` 决定 |

## 七、NSIS 安装包:安装 / 升级 / 卸载(2026-08-14 补做,user 批准后执行)

对应 6-windows-handoff §二 P0-2 第 2 条。**全部通过。**

### 做法

验「升级」需要两个真实不同的版本,故:装旧版 `DeskFox-Dev-2026.7.0`(6/15 的存量产物)
→ 用 `bump-installer-version.ps1` 把 dev 号线 bump 到 `2026.7.1` → 用本分支代码打 NSIS
→ **升级安装** → 验证 → **卸载** → 验证残留。

### 结果

| 项 | 结果 |
|---|---|
| 出包 | `DeskFox-Dev-2026.7.1-win-x64.exe`(340 MB),post-build 复验 soffice + 非空 presets 通过 |
| 版本号来源 | 产物名与 UA 均为 `2026.7.1` = `installer-versions.json` 的 `dev-windows`,**非硬编码** ✅ |
| 升级安装 | 58 秒完成;注册表 `DeskFox Dev 2026.7.0` → `DeskFox 预览版 2026.7.1`,**单条替换无重复** ✅ |
| 跨 productName 改名 | 旧版 productName 是 `DeskFox Dev`、新版是 `DeskFox 预览版` —— 旧 exe 已清除、无双 exe 残留 ✅ |
| 数据保留 | dev appData 1244 文件 / 214.3 MB / 53 个 workspace 记录,升级前后**完全一致** ✅ |
| LibreOffice 随包 | 安装目录下 `libreoffice/program/soffice.exe` 存在 ✅ |
| 运行与身份 | UA `DeskFox预览版/2026.7.1`,**DEV 徽标**,窗口 1440×902(fork 默认,非上游 1280×800)✅ |
| 修复随包发出 | 在**装出来的**预览版上跑 `win_p0_drop_path.py 9224 "DeskFox 预览版"`,拖入插入 `@docs/中文文件名 带空格.md` —— 正斜杠,P0-1 修复确认已进安装包 ✅ |
| 卸载 | 安装目录**完全移除**、注册表条目移除;appData **按设计保留**(`deleteAppDataOnUninstall: false`)✅ |
| 与 prod 隔离 | 全程 prod 安装目录、appData(454 文件 / 306.4 MB)、注册表条目**一字未动** ✅ |

### 沿途两个值得记的发现

**① 首次升级会一次性清掉一批空 store —— 是预期,不是数据丢失。**

跑新 dev 后 `opencode.workspace.*.dat` 从 53 掉到 37,乍看像丢数据。应用自己的日志给了确证:
`cleaned scoped store files { count: 17, scanned: 53 }`。这是本次同步从上游带进来的新机制
(`store-cleanup.ts`,上游 PR #34651),规则是**只删空 store(≤128B)与超 30 天/超 100 条的陈旧草稿,
非空 workspace 记录永不删**。基线 `e77443750e` 上没有这个文件 —— 所以**老用户升级到本分支后
第一次启动会看到一次性清理**,量取决于历史遗留的空记录数。建议在 release note 提一句,免得被当成故障。

**② 跑新 dev 会迁移 `opencode.db`,而它是发布三档共享的。**

本分支代码比 user 在用的 prod 2026.9.1 新,dev 一跑就对共享库做了迁移(WAL 从 4 MB 涨到 128 MB)。
prod 是老代码,回去可能打不开(仓内记忆里正是这个坑)。
故本次测试**先完整备份 1.4 GB 会话库再动**,测完还原,并另存了一份「dev 跑后」的状态备查。
还原后 prod 启动正常(6 进程 / 主窗口在 / sidecar + server ready / 日志无错)。

> 这条对**真实发布**同样成立:prod 与 dev/beta 共享 `opencode.db`,一旦用户装了带新迁移的
> 预览版并运行过,再退回旧正式版就有风险。合 main 并发正式版之后此问题自然消失,
> 但**预览版先行期间**要提醒用户「装了预览版就别再退回旧正式版」。

### 一处非本次引入的观察

注册表里还留着一条 `DeskFox 2026.7.2 → D:\softwares\DeskFox\uninstall.exe` —— 那是 Tauri 时代
正式版的卸载登记,目录早已不在。属历史残留,与本次同步无关,未处理。

### 收尾

dev 已卸载(user 原本就没装 dev,回到原状态);prod 已拉起并确认正常。
`installer-versions.json` 的 `dev-windows` 保持在 2026.7.1 未回退 —— 产物确实存在过,
回退会让台账与磁盘对不上;下次真正 ship dev 从 2026.7.2 起
(台账 `docs/installer-versions.md` 已标注该条为「非发布版本」)。

## 八、复跑方式

```powershell
# 1. 出包(只杀本地版,不碰正式版)
packages\branding\scripts\build-deskfox-electron.ps1 -Env local

# 2. 起应用
packages\desktop\dist-deskfox\win-unpacked\"DeskFox 本地版.exe" --remote-debugging-port=9222

# 3. 造样本 + 打开(open_project_win.py 驱动原生对话框,无需人工点)
python packages\branding\smoke\make_fixtures.py
python packages\branding\smoke\open_project_win.py D:\deskfox-uitest

# 4. 跑全套
python packages\branding\smoke\uiprobe_selftest.py
python packages\branding\smoke\run_group2.py
python packages\branding\smoke\win_p0_drop_path.py
python packages\branding\smoke\win_p0_paths.py
python packages\branding\smoke\win_p1_menu.py
python packages\branding\smoke\win_p1_preview.py
python packages\branding\smoke\win_p2_general.py
python packages\branding\smoke\win_p1_crash.py       # 会真的把渲染进程搞崩
python packages\branding\smoke\win_p1_onboarding.py  # 会重启本地版
```

依赖:`websocket-client`(已有)、`python-docx` / `openpyxl` / `Pillow`(造样本用)。
控制台请设 `PYTHONUTF8=1`,否则中文输出在 GBK 终端下是乱码。

## 九、本轮 commit

| hash | 内容 |
|---|---|
| `2f30b41c44` | fix:文件树单选拖入的 @ 路径归一化为正斜杠(+13 条单测) |
| `f05ce5494f` | fix:row-reverse 源码守卫在 Windows 上从未真正执行 |
| `f574119ba4` | test:uiprobe native 层按平台分派,接入 Windows |
| `1cb1dd454e` | test:Win 版打开项目 + UIA 后端 + fixture 跨平台化 |
| `e1d947b6c8` | test:Windows P0 验收脚本 |
| `b440bf3517` | test:Windows P1 验收脚本(菜单 / 崩溃恢复 / 首启引导) |
| `64b9ea6db3` | test:Windows 六格式预览脚本 |
| `b6bb18c3f0` | test:Windows P2 抽验 + flaky 诊断留档 |
