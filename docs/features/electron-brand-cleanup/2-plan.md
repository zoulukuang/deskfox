feat-id: electron-brand-cleanup
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

分支:`feat/electron-brand-cleanup`(基于 `feat/electron-replatform`)。按需求池 §九 五阶段推进。

## 阶段执行

- **阶段 1 文本接线**:扩 `rebrand.ts`(补 `Go` 短语豁免 + key 感知白名单)→ desktop renderer i18n 出口套 `rebrandDict` → 回潮断言单测。
- **阶段 2 Logo/主题**:`renderer/index.tsx` 的 `Splash` import 换源到 `@opencode-ai/branding/logo`。
- **阶段 3 图标资源**:`copy-icons.ts` 叠加 branding 图标到 `resources/icons`;通知图标改本地 data URL。
- **阶段 4 独立修复**:窗口标题锁定(`page-title-updated`)、卸载发布者、误发护栏。
- **阶段 5 验证**:typecheck + 单测 + electron-vite build + 打包 win-unpacked + 真机冷启动 boot smoke(OS 窗口标题核验 B1)。

## 关键决策 / 与 spec 的偏差(均有据,记此备查)

1. **theme.css 无需在 desktop renderer 额外 import**(偏差,spec §3.2/阶段2 曾列此任务)。
   复查实证:`@opencode-ai/branding/theme.css` 已由 `app.tsx → @/index.css → @import branding/theme.css` 注入,
   而 desktop renderer 通过 `@opencode-ai/app` barrel 静态 import `AppInterface`(→ app.tsx),CSS 副作用 import 随之进 bundle。
   构建产物 `out/renderer/assets/main-*.css` 实测含 `--logo-text`/`--surface-brand-base`(6 处)→ 已注入。
   故只做 Splash import 换源(`--logo-*` var 现成可用),不加冗余 import(避免噪声)。`renderer/styles.css` 0 字节是历史残留,留它不动。

2. **菜单 "OpenCode Documentation" 天然保留**(B2,无需进 rebrand 白名单)。
   菜单 label 是 `desktop-menu.ts` 的硬编码英文串(经 `desktop-menu-i18n.ts::translateMenuLabel` 翻译),
   **不走 i18n 字典 / 不经 rebrandDict**,故天然不被替换。白名单只放真正流经 rebrandDict 的 i18n key
   (wsl.* / mcpFailed / freeModels.title)。

3. **D1 发布者改 `extraMetadata.author` 而非 `win.publisherName`**(关键踩坑)。
   `win.publisherName` 在 electron-builder 26.15.2 仅用于代码签名校验,且其 JSON schema(scheme.json)对未签名构建
   只接受 `string[] | null`,传值即报 `configuration.win should be one of these: null` 校验失败(实测 string 与 array 均失败)。
   溯源:NSIS 卸载列表「发布者」取 `installer.nsh` 写的 `Publisher = ${COMPANY_NAME}`,而 `app-builder-lib appInfo.companyName`
   = `metadata.author.name`(package.json `author.name="OpenCode"`)。故根因在 author.name → 用 `extraMetadata.author.name`
   覆盖为 `PRODUCT_NAMES[channel]`。这才是 D1 的正确单一源(且对签名/未签名都生效)。

4. **A6 favicon(标签页/HTML favicon)本期不改**(偏差,spec 标 A6 低优先)。
   `packages/app/public/favicon-*.png` 实为指向 `packages/ui/src/assets/favicon/` 的 symlink,Win 上 checkout 成
   纯文本占位(内容是路径串),DeskFox favicon 资产也未就绪。且 Electron 无原生浏览器 tab,HTML favicon 在桌面窗口
   几乎不可见(窗口/任务栏图标走 exe 内嵌 icon = A2 已 DeskFox)。改它需先解决 symlink + 出 DeskFox favicon 资产,
   独立资产工作,桌面收益≈0 → 本期 defer,留 backlog。

5. **A2 运行时 iconPath() 在打包态读不到也无碍**。
   `windows.ts::iconsDir()` 打包态读 `process.resourcesPath/icons`,而 `files:["resources/**"]` 把 resources 收进 app.asar
   (top-level `resources/icons` 不存在)→ `BrowserWindow{icon: iconPath()}` 路径不存在被忽略 → 回落 **exe 内嵌 icon**。
   exe 内嵌 icon 由 deskfox config `win.icon=branding icon.ico`(DeskFox)设定 → 任务栏/标题栏即 DeskFox。
   `copy-icons` 叠加 branding 到 `resources/icons` 的价值在:① dev 态 iconPath() 读 `packages/desktop/resources/icons`(我方覆盖生效)
   ② 它是上游 config `win.icon='resources/icons/icon.ico'` 的取值源(根源修一处,两套 config 都吃到 DeskFox exe 图标)。

6. **回潮断言测试按引用方向分置**(测试工程)。
   `rebrand.test.ts` 放 app 包(在 app project 内,含 app 出口 appEn+uiEn 回潮断言);desktop 出口(appEn+desktopEn,
   含 desktop.updater.* 升级 toast)的回潮断言放 `desktop/src/renderer/i18n/rebrand-regression.test.ts`。
   原因:app 的 tsconfig 不含 desktop 文件,app 跨包 import desktop 会触发 tsgo `TS6307`;而 desktop 引用 app 合法。

## 验证结果

- typecheck:app / desktop 各 exit 0(console-core 的 `resource.node.ts` 隐式 any 是预存在、与本改动无关、§七 不在范围)。
- 单测:app rebrand 10 pass / desktop regression 2 pass;app 全量 419 pass(2 个 fail 在 global-sync child-store / session-status-reconcile,
  与本改动无关的预存在用例)。
- 构建:`electron-vite build` ✓;`electron-builder --dir --win` ✓(config 校验过、出 `DeskFox Dev.exe`)。
- 真机 boot smoke:启动 6 进程无崩溃;**PowerShell 读 OS 窗口标题 = "DeskFox Dev"**(B1 直证,page-title-updated 锁定生效)。
- 资源核验:`resources/icons/icon.ico` md5 == branding dev icon.ico;`out/renderer` 运行时 .js 无外网 opencode favicon URL、含 DeskFox data URL;`out/main` 含 page-title-updated。

## 留待真机视觉 QA(CDP ≠ 真桌面)

启动画面狐狸 Splash 视觉、托盘/Dock 图标(A3/A4 Mac)、通知图标实显、卸载列表发布者(需走 NSIS 安装)、
设置/侧栏文案逐项 —— 由 user dev 包真机抽查(对照 governance「CDP 自测 ≠ 真桌面 QA」)。
