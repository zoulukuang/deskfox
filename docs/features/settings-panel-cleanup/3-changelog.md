feat-id: settings-panel-cleanup
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

> commit:`(本笔 commit)`(feat 分支 `feat/settings-panel-cleanup`,基于 `feat/electron-replatform`)

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/app/src/components/settings-general.tsx` | 改(上游,FORK marker) | 删「高级」整组(`AdvancedSection` 函数 + 调用)+ 删「New layout and designs」开关;清理失活的 `dialog`/`useDialog` 引用 |
| `packages/app/src/i18n/zh.ts` | 改(fork i18n 数据) | 补「终端字体」译文(原为英文)+ 新增「捏合缩放」译文 |
| `packages/app/src/i18n/zht.ts` | 改(fork i18n 数据) | 同上,繁体 |
| `packages/app/src/components/titlebar.tsx` | 改(上游,FORK marker) | 经典标题栏 DEV 徽标前加「打开终端」图标按钮(gate 在 `params.dir`,点击 `command.trigger("terminal.toggle")`)|
| `packages/app/src/index.ts` | 改(上游,FORK marker,additive) | 导出 `useLanguage` 供桌面端监听 locale |
| `packages/app/package.json` | 改(additive) | exports 加 `./desktop-menu-i18n` 子路径(指向既有 fork-only 文件)|
| `packages/app/src/desktop-menu-i18n.test.ts` | 新增(fork-only,test) | 菜单 i18n 完整性守卫:`DESKTOP_MENU` 全部 label 必须有 zh/zht 译文 + 未知 locale 回退英文 |
| `packages/desktop/src/main/menu.ts` | 改(fork-only) | 接 `translateMenuLabel`;`createMenu` 保留 deps/locale 模块态 + 新 `setMenuLocale()` 可重建;role 项也翻译(带 label 用翻译表覆盖、纯系统 role 用带 `app.getName()` 译名);`translatedLabel`/`withLabel`/`roleLabel` 三 helper |
| `packages/desktop/src/main/ipc.ts` | 改(fork-only) | 新 IPC `set-menu-locale` → `setMenuLocale` |
| `packages/desktop/src/preload/index.ts` | 改(fork-only) | 暴露 `setMenuLocale(locale)` |
| `packages/desktop/src/preload/types.ts` | 改(fork-only) | `ElectronAPI` 加 `setMenuLocale` 签名 |
| `packages/desktop/src/renderer/index.tsx` | 改(fork-only) | `Inner()` 用 `useLanguage()` + `createEffect` 监听 locale → `window.api.setMenuLocale` 推回主进程 |

## 逐任务实现

1. **删「高级」分组**:移除 `AdvancedSection`(文件树/导航控件/命令面板/服务器状态/Custom agents 5 项)函数定义 + `<Show when={desktop()}>` 调用,留 FORK 注释。底层 `showFileTree` 等字段/默认值不动。
2. **删 v2 开关**:移除 `newLayoutDesigns` SettingsRow;默认 `false` 不变 → 经典布局保持。连带删唯一失活的 `dialog`/`useDialog`。
3. **i18n 补译**:zh「终端字体/自定义终端中使用的字体」「捏合缩放/允许触控板捏合和 Ctrl+滚轮手势缩放」;zht 对应繁体。`satisfies Partial<Record<Keys,string>>` 类型校验保证 key 合法。
4. **终端图标**:经典标题栏 `ChannelIndicator` 前加 `TooltipKeybind` + `Button`(`Icon name="terminal"`),`command.trigger("terminal.toggle")`,gate `params.dir`。
5. **原生菜单 i18n**:渲染进程语言变化 → IPC → 主进程 `rebuildMenu()`。带 label 的 role 项与普通项走 `translateMenuLabel`;纯系统 role(about/hide/hideOthers/unhide/quit)按 role 给带应用名译名。仅有真实译文时覆盖 → 英文/未翻译语言零回归。

## 回归测试

- typecheck:**26 包全过**
- app 单元测试:**434 pass / 0 fail**
- desktop 主进程测试:**69 pass / 0 fail**
- 新增 `desktop-menu-i18n.test.ts`:**4 pass / 0 fail**(扫描确认当前全部菜单 label 均有 zh/zht 译文)
- 真机 QA:dev `--no-bundle` 包(`dist-deskfox/mac-arm64/DeskFox Dev.app`)— 设置面板两组消失 / 终端图标点击切换集成终端 / 简体原生菜单中文 + 切语言即时跟随。

## 影响范围 / 风险

- 全 fork-only 新增 + 既有 fork 文件改动 + 上游文件 additive/删除型改动(均 FORK marker);**0 R4 override / 0 黑名单 / 0 网络监听**。
- 上游侵入:`settings-general.tsx`/`titlebar.tsx`/`index.ts` 三个上游文件(删除 + additive 为主),其余全 fork。

## 回退方法

`git revert <本笔 hash>` 单笔回退:设置面板两组恢复、菜单退回英文、终端按钮消失,无数据迁移、无副作用。
