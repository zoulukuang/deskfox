# DeskFox 功能测试总清单

> [fork-only] **长期复用资产**,每次发版 / 上游同步 / 大改动后逐项过。
> [feat: ui-probe-toolkit] 2026-08-13 立
>
> 与 [`UIPROBE.md`](./UIPROBE.md)(工具)、[`README.md`](./README.md)(广度冒烟)配套:
> 本文件回答**测什么**,UIPROBE 回答**怎么测才算数**,smoke.py 回答**有没有炸**。
>
> **自动化跑不了的那些**收在 [`MANUAL-CHECKLIST.md`](./MANUAL-CHECKLIST.md)(人工验收单),
> 每条都写明「机器为什么做不到」,并单列一节「本可自动化但尚未覆盖」的缺口 —— 别把它当成已验。

## 一、清单是怎么来的(方法论,决定它是否可信)

清单不是拍脑袋列的 —— 初稿 28 项,按下面方法自检后补到 **63 项**,翻了一倍多。
新增功能时**照这个方法重跑一遍**,而不是凭印象往里加。

### 1.1 保证「全」的四条原则

| 原则 | 含义 |
|---|---|
| **可枚举优先于可回忆** | 机器能列的一律机器列:命令注册表 / 快捷键表 / 菜单树 / 设置页 / DOM `aria-label` / FORK feat-id |
| **多源交叉,互相补漏** | 单一来源必有盲区,取并集:**入口源**(能点到什么)+ **定制源**(改过什么)+ **风险源**(修过什么,最易复发)+ **能力源**(产品命脉) |
| **以「用户能做的动作」为单元** | 不以代码模块为单元 —— 验收方式是亲手操作。「session-side-panel.tsx」不是条目,「tab 右键 → 关闭其他标签」才是 |
| **每条必带可判定预期** | 没有「什么算通过」的条目不算数,否则等于回到拍脑袋 |

### 1.2 枚举命令(维护清单时重跑)

```bash
# 命令面板条目(51 条核心命令)
grep -oE '"command\.[a-zA-Z0-9._-]+"' packages/app/src/i18n/en.ts | sort -u
# 快捷键绑定
git grep -E 'keybind: *"' -- packages/app/src
# 菜单树
grep -oE 'labelKey: "[^"]+"' packages/app/src/desktop-menu.ts
# FORK 定制密集度(定制越密 = 越该重点测)
git grep -hoE '\[feat: [^]]+\]' -- packages | sort | uniq -c | sort -rn | head -30
# 历史 bug-repro(修过的最容易复发)
git log --all --format='%s' --grep='bug-repro' | head -60
# 运行时可交互元素(静态代码抓不到,须开着应用跑)
python3 -c "from uiprobe import UI; ui=UI(); print(ui.ev('[...new Set([...document.querySelectorAll(\'[aria-label]\')].map(e=>e.getAttribute(\'aria-label\')))].sort()'))"
```

### 1.3 保证「真」的三条硬规矩

1. **真实输入**,不用 `element.click()` / `new KeyboardEvent()`(触发不了 SolidJS handler)。
2. **可靠指标**,不用 `innerText.includes()`(被同名文案污染)。
3. **视觉改动像素级验收**(样式挂上了 ≠ 用户看得见)。

细节与踩坑记录见 `UIPROBE.md`。

## 二、执行方式

- **基准对照**:与「上一个已知良好版本」比对。基准包用 `git worktree` 隔离构建,
  同 appId 有单例锁不能并存 → **交替运行**,当前版全量走一遍并记录,存疑项再回基准版跑同一条。

### 常驻基准环境(勿删)

    /Volumes/ExtSSD/deskfox-baseline          # git worktree,detached 于比对基线 commit
    .../packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app   # 已构建好的基准包

user 2026-08-13 决定**长期保留复用**。它的价值在于把「这是回归还是本来就有的问题」变成可判定 ——
本次靠它坐实了两条 **sync 引入的回归**(侧面板宽度 clamp 只改一半、行内评论一直存在非本次引入),
避免了「把长期问题当回归瞎修」和「把真回归当历史遗留放过」两类误判。

**切换基准点**(上游同步告一段落后,把基线推进到新的已知良好 commit):

    cd /Volumes/ExtSSD/deskfox-baseline
    git checkout <新的基线 commit>
    bun install && cd packages/desktop && OPENCODE_CHANNEL=local bun run build
    # 打包命令见 UIPROBE.md,注意必带 ELECTRON_MIRROR 与摘代理
### 专用测试项目(勿在 user 真实项目里跑)

    python3 packages/branding/smoke/make_fixtures.py     # 生成 /Volumes/ExtSSD/deskfox-uitest
    python3 packages/branding/smoke/open_project.py /Volumes/ExtSSD/deskfox-uitest

第 3 组含**归档 / 删除 / 分享**这类破坏性或对外的动作,在 user 真实项目(如 `/Volumes/ExtSSD/Finance`)
里跑等于拿真实数据练手,「分享」还会把内容发到站外。所以一律先切到自建项目。

生成的样本**内容带可判定特征**(`BOLDMARK` / `QUOTEMARK` / `PNGMARK` 等),
预览对不对能直接断言,而不是「看着像渲染出来了」;并且是 git 仓且**故意留有未提交改动**,
因为 #15 的「N 更改」tab 没有真 diff 就不渲染。各格式(md/docx/xlsx/pdf/png/代码/超大文件)一次备齐。

- **判定格式**:`动作 → 基准版表现 / 当前版表现 / 是否一致`。
- **图例**:`[ ]` 未验 / `[x]` 一致 / `[!]` 有差异待处理 / `[-]` 不适用

## 三、清单(63 项)

### 第 1 组 桌面外壳(Mac 专属,**web e2e 原理上验不了**)

> 这层 `Show when={isDesktop()}` 的子树在 web e2e 里整棵不渲染,断言必然空过 —— 只能真机 + AppleScript。

| # | 动作 | 预期 | 工具 |
|---|---|---|---|
| 1 | 原生菜单栏 7 个顶层逐个展开 | 全中文;role 项(关于/隐藏/退出/最小化/缩放/前置全部窗口)也须中文 | AppleScript 读 menu bar |
| 2 | 托盘图标左键 / 右键 | 菜单为「打开 DeskFox / 状态 / 保持电脑不休眠 / 退出」全中文 | AppleScript menu bar 2 |
| 3 | 关窗到托盘 → Dock 点击 | 窗口数 1→0 但进程存活;`open -a` 后回到 1 | AppleScript + pgrep |
| 4 | 防休眠开关 | 托盘勾选态重启后保持 | AppleScript |
| 5 | 窗口尺寸/位置记忆 | 首启 1440×900(受屏幕 clamp);用户调整后重启保持用户值 | `uiprobe.window_geometry()` |
| 6 | 多窗口(文件→新建窗口) | 窗口数 +1,各自独立 | AppleScript |
| 7 | 文件关联(双击 .md) | 用 DeskFox 打开 | 手工 |
| 8 | 深链 `opencode://` | 正确路由 | `open "opencode://..."` |
| 9 | 拖拽文件进窗口 | 接收并处理 | 手工 |
| 10 | 首启引导(REQ-083) | 首次启动出现,老用户不出现 | 清 firstLaunchDone 后启动 |
| 11 | 更新器 UI(检查更新) | 对话框正常、文案中文 | 手工 |
| 12 | 崩溃自愈(REQ-087) | **没有对话框**:120s 内第二次可数崩溃 → 隔离 .dat 快照并 reload(源码 renderer-crash-guard.ts) | 人工验收单 |

### 第 2 组 主界面骨架

| # | 动作 | 预期 | 工具 |
|---|---|---|---|
| 13 | 标题栏三按钮(状态/文件树/审查)开→关→再开 | 每次状态都翻转 | `uiprobe.click_element` |
| 14 | ⌘B 切换会话侧栏(点击 + 快捷键各 3 次) | `--main-right` 在 0 / >0 间翻转 | `uiprobe.css_var('--main-right')` |
| 15 | 文件树 tab「所有文件 / N 更改」互切 | 内容切换,tab 顺序:所有文件在左 | `find_element` + 几何 |
| 16 | **面板开关矩阵**(树/审查/预览/终端 各组合) | 任一组合下都不遮挡、无溢出、分隔线在 | `is_occluded` + `overflow_of` |
| 17 | 拖拽调整各面板宽度 | 松手后保持;侧面板占位 == 聊天区让位 | `overflow_of('main')` |
| 18 | rail 项目图标切换 | 切换项目 | `click_element` |
| 19 | 打开项目(`project.open`) | 目录选择 → 加载 | `open_project.py <路径>`(已自动化,原「手工」) |
| 20 | 前进/返回导航 | 历史正确 | `click_element` |
| 21 | toast 通知区就位 | 容器在视口右下待命;**无 toast 时 height=0 属正常** | `run_group2.py` |
| 22 | 切换终端 / 新建终端 | canvas 出现;shell prompt 正常 | `find_element('canvas')` |

### 第 3 组 会话与聊天

| # | 动作 | 预期 | 工具 |
|---|---|---|---|
| 23 | 会话列表:新建/切换/重命名/归档+撤销/删除确认/分享/取消分享 | 各动作生效,归档有撤销 toast | `click_element` |
| 24 | 会话内查找 ⌘F | 计数正确、回车循环、Esc 关闭;**关闭按钮必须在可点区内** | `overflow_of` + `is_occluded` |
| 25 | 全局搜索 ⌘K | 文件/命令/会话内容三类结果 | `key(cmd=True)` |
| 26 | 聊天引用(选中加聊天) | 出卡片;点击**不开空白预览页** | `drag` + `find_element` |
| 27 | md 内链点击拦截 | 站内跳转不外开浏览器 | `click_element` |
| 28 | **agent 切换**(composer 的 Build 下拉) | 列出 Build/Imbot/Plan 并可切 | `click_element` + 截图 |
| 29 | **Shell 模式切换** | composer 进入 shell 模式 | `click_element` |
| 30 | 会话撤销/重做 +「撤销此消息」 | 消息回滚 | `click_element` |
| 31 | 会话压缩 / 分叉 | 生成新会话 / 压缩上下文 | 手工 |
| 32 | 会话间导航(next/previous/**unseen**) | 正确跳转 | `key` |
| 33 | 消息间导航 | 滚动定位 | `key` |
| 34 | 复制消息 / 复制回复 | 剪贴板有内容 | `click_element` |
| 35 | 查看上下文用量 | 面板显示 | `click_element` |
| 36 | 跳转到最新 | 滚到底 | `click_element` |
| 37 | 步骤展开/收起 | 折叠态切换 | `click_element` |
| 38 | 导出会话 / 导出日志 | 文件落盘 | 手工 |
| 39 | 中断生成(取消) | 停止并标记「已中断」 | `click_element` |

### 第 4 组 文件与预览

| # | 动作 | 预期 | 工具 |
|---|---|---|---|
| 40 | 文件树展开/收起/点开文件/当前文件高亮 | 高亮跟随;**点击后焦点落入文件树** | `focus_state('[data-component="filetree"]')` |
| 41 | 预览 `.md` | 标题/引用/列表/粗体渲染正确 | 截图 |
| 42 | 预览 `.docx` | 内置 LibreOffice 转换成功 | 截图 |
| 43 | 预览 `.pdf` | 正常翻页 | 截图 |
| 44 | 预览 `.xlsx` | 走 LibreOffice **分页渲染**(无 `<table>`);两个 sheet 的特征词都要出现 | `run_group4.py` |
| 45 | 预览 图片 | 正常显示 | 截图 |
| 46 | 大文件预览守卫 | 超限有提示不卡死 | 手工 |
| 47 | 预览区**选中后**右键 → 加入聊天 / 复制 / 导出 | 菜单项是 `button` 不是 `role=menuitem`;空白处右键给不出这些项 | `run_group4.py` |
| 48 | tab 关闭 / 关闭其他 / 重开已关闭 | **入口各不相同**:关闭其他在右键菜单,关闭在命令面板/⌘W;**重开是上游新增命令,本布局未接入**(基准版无此命令,非回归) | `run_group4.py` |
| 49 | **附加文件**(composer 附件) | 文件进入待发送区 | 手工 |
| 50 | **选中交互一致性** | 所有格式选中后都是**右键→加入聊天**,代码类不再弹行内评论框 | `drag` + 文本断言 |

### 第 5 组 创作与供应商

| # | 动作 | 预期 | 工具 |
|---|---|---|---|
| 51 | 创作模式入口 → 切换 → 生成一次 | 入口在;生成成功 | `click_element` |
| 52 | 供应商页 10 个连接弹窗 | **GetBot 排首位 + 推荐标**;弹窗均不崩 | `smoke.py --only providers` |
| 53 | 模型选择器 | 列表可选 | `click_element` |
| 54 | 模型变体切换(composer「默认」) | 变体切换 | `click_element` |

### 第 6 组 飞书桥接(FORK 定制最密,160+ 处)

| # | 动作 | 预期 | 工具 |
|---|---|---|---|
| 55 | 设置 → 飞书桥接页各项开关 | 开关持久化 | `smoke.py --only settings` |
| 56 | 账号 / 工作区绑定流程 | 绑定成功 | 手工 |
| 57 | 群消息 @ 策略、重试反馈等设置项 | 生效 | 手工 |

### 第 7 组 设置与全局

| # | 动作 | 预期 | 工具 |
|---|---|---|---|
| 58 | 六个设置页逐页开、改一项、重启后保持 | 持久化 | `smoke.py --only settings` |
| 59 | 主题切换(含 Fox Blue)+ 深浅色 | `--surface-base-active` 变为 `#7295c452`(Fox Blue light) | `css_var` |
| 60 | 语言切换 | 界面 + **原生菜单**同步变 | AppleScript 读菜单 |
| 61 | **权限自动接受开关**(安全相关) | 开关生效 | 手工 |
| 62 | MCP 开关 | 生效 | 手工 |
| 63 | server 切换 / workspace 切换 | 生效 | 手工 |

## 三之二、条目本身也会错(2026-08-13 立)

枚举法能保证「不漏」,但**保证不了「不多」** —— 机器列出来的入口里混着不属于产品的东西。

实例:#21 原写作「通知面板(alt+T)→ 打开/关闭」,来源是 §1.2 枚举 DOM `aria-label` 时收到的
`Notifications (alt+T)`。追到 `node_modules` 才确认那是第三方库 **`solid-sonner`** 的 Toaster
容器标签,alt+T 是它把焦点移到 toast 列表的**无障碍热键**,压根没有「面板」这回事;
零条 toast 时 `height=0` 是正常状态。按原条目测,只会得到「入口在但打不开」的假缺陷。

**规矩**:验一条时若反复得到「元素在、但行为对不上」,先怀疑**条目写错了**,
去源码 / 依赖里确认这个入口到底属于谁、本该做什么,再决定是改代码还是改清单。
改清单要在条目旁写明**为什么改**,否则下次又会照着错的重列一遍。

## 四、维护规则

1. **新增 feat 上线 → 往对应组加条目**,写清「动作 / 预期 / 工具」三列,缺一不可。
2. **每修一个 bug → 检查是否该加一条**。修过的地方最容易复发(本清单第 1.1 节「风险源」)。
3. **定期重跑 §1.2 的枚举命令**,与清单比对,补上机器能看到而清单漏掉的入口。
4. 条目只增不轻易删;确实废弃的标 `[-]` 并注明原因,便于回溯。

## 五、已知会拖慢执行的点(先看再动手,省时间)

- **窗口可能在副屏**:CDP 坐标与屏幕坐标不是一套。动手前先跑 `python3 uiprobe.py` 看窗口在哪。
- **同 appId 单例锁**:基准版与当前版不能并存,只能交替跑。
- **e2e 在桌面层无能为力**:`Show when={isDesktop()}` 的子树 web 端不渲染,别指望 e2e 兜底。
- **`.txt/.json/.toml/.py` 走 CodeMirror,`.md/.docx/.pdf` 走 DocumentViewer**:两类 viewer 的选中/右键行为要分别验。
