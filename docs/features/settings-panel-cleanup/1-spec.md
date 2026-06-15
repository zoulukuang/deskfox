feat-id: settings-panel-cleanup
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 1-spec — 通用设置面板精简 + 终端入口 + 菜单本地化

> 规模:**Medium**(改 11 文件 + 1 新测,跨 app/desktop 两包;含 view + native 风险点)
> 起源:2026-06-15 user 看 Electron 基座 dev 包的「通用设置」截图,提 5 项调整。

## 需求(user 原话拆解)

| # | 需求 | 类别 |
|---|---|---|
| 1 | 「高级」分组(文件树/导航控件/命令面板/服务器状态/Custom agents)全部去除,不展示给用户 | UI 删除 |
| 2 | 「New layout and designs」开关去除,不展示给用户 | UI 删除 |
| 3 | 「终端字体 Terminal Font」「捏合缩放 Pinch to zoom」要跟随全局语言;简体下现显示英文 | i18n 补译 |
| 4 | 标题栏「DEV」徽标前加一个「打开终端」图标,给习惯终端的用户提供便利 | 新增 view |
| 5 | macOS 原生应用菜单(顶部菜单栏 + 应用菜单)要跟随全局语言;简体下仍大量英文 | native i18n |

## 验收标准

- **AC1**:设置 → 通用 不再出现「高级」整组(5 项全消失),底层 setting 字段 + 默认值不变(文件树默认仍开、余者默认关,既有行为零回归)。
- **AC2**:不再出现「New layout and designs」开关;默认仍是经典布局(`newLayoutDesignsDefault=false` 不变)。
- **AC3**:简体/繁体界面下「终端字体」「捏合缩放」标题与说明显示中文;英文界面照常英文。
- **AC4**:打开项目后,标题栏 DEV 徽标左侧出现终端图标,点击切换集成终端(等价 `terminal.toggle` / `Ctrl+\``);无项目时隐藏。
- **AC5**:简体界面下 macOS 顶部菜单栏(文件/编辑/视图/前往/窗口/帮助)+ 应用菜单(检查更新/设置/重启/关于/隐藏/退出 等)显示中文;切回英文即时变回英文。英文/未翻译语言下行为与上游 100% 一致。

## 架构选型

- **R1 三级跳**:任务 1/2/3/4 全在既有文件做最小删改 + i18n 数据补充;任务 5 复用 fork 既有 `desktop-menu-i18n.ts` 翻译表(P3 适配层),仅在 desktop 包内打通「渲染进程 locale → IPC → 主进程重建菜单」链路,不改上游菜单定义 `desktop-menu.ts`。
- **R3 合规**:无品牌/主题色/icon 硬编码改动;菜单应用名走 `app.getName()` 动态取,不硬编码 DeskFox。
- **关键 native 风险点(对照「CDP 自测 ≠ 真桌面 QA」)**:任务 4(标题栏按钮)、任务 5(macOS 原生菜单 + 切换语言即时重建)必须真机 QA,单测覆盖不到。

## 测试用例清单(R8,动工前列)

| 用例 | 层级 | 预期 |
|---|---|---|
| TC1 typecheck 全包 | 静态 | 26 包通过 |
| TC2 app 单元测试 | unit | 0 fail(删 UI 行 + i18n 改动不破坏现有断言) |
| TC3 desktop 主进程测试 | unit | 0 fail(menu/ipc 改动) |
| TC4 菜单 i18n 完整性守卫(新测) | unit | `DESKTOP_MENU` 全部 label 有 zh/zht 译文;未知 locale 回退英文 |
| TC5 设置面板两组消失 | 真机 QA | AC1/AC2 |
| TC6 终端图标位置 + 点击切换集成终端 | 真机 QA(native) | AC4 |
| TC7 原生菜单中文 + 切语言即时跟随 | 真机 QA(native) | AC5 |
