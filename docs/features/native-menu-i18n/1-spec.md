feat-id: native-menu-i18n
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 原生右键菜单 i18n — 1-spec

> 源:REQ-096 讨论时 user 提出「右键菜单语言跟随软件设置」;会话行菜单已由应用层菜单就地解决,
> 本 feat 补齐**其余区域的 Electron 原生菜单**(输入框剪切/复制/粘贴、图片另存为、链接复制等)。

## 需求

Electron 原生右键菜单(electron-context-menu)标签恒英文;应跟随 **app 内语言设置**(非 OS locale)。

## 方案

- fork-only `desktop/src/main/deskfox/context-menu-labels.ts`:19 语言 × 12 标签(cut/copy/paste/selectAll/copyLink/saveLinkAs/copyImage/copyImageAddress/saveImage/saveImageAs/copyEmail/inspect),locale 归一(zh-TW→zht、pt→br、nb/nn→no,未知回退 en)。
- fork-only `deskfox/context-menu.ts`:`applyContextMenuLanguage(locale?)` 按语言重挂(dispose+reinit);启动先用 OS locale 兜底,renderer 语言就绪/变更后经 IPC `deskfox:set_context_menu_language` 同步真实设置。
- 上游触点:main/index.ts 换调用(2 行)、deskfox/ipc.ts 注册(4 行)、app language.tsx effect 同步(桌面端才发,web 静默跳过)。全部白名单,0 R4。

## 验收

- [x] 19 语言标签集完整(单测钉死)+ locale 归一边界
- [x] IPC 通道真机可调
- [x] 真机 zh:composer 右键菜单显示「剪切/复制/粘贴」(cliclick 实拍截图)
