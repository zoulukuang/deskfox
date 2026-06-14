feat-id: electron-brand-cleanup
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志(2026-06-14)

分支 `feat/electron-brand-cleanup`(基于 `feat/electron-replatform`)。把 Electron 桌面入口接回 fork 品牌单一源,消除运行时 OpenCode 残留。

## 实际改动

| 文件 | 类型 | 说明 | 触点 |
|---|---|---|---|
| `packages/app/src/i18n/rebrand.ts` | 改 fork-only | 短语规则补 `Go`(`/OpenCode(?! Zen\| Go)/`,修「OpenCode Go」被错改);新增 `isRebrandExemptKey` key 感知白名单(`wsl.*`/`error.chain.mcpFailed`/`dialog.model.unpaid.freeModels.title`);`rebrandDict` 按 key 豁免 | B8/B9/B10 + 白名单 |
| `packages/desktop/src/renderer/i18n/index.ts` | 改上游(FORK marker) | flatten 出口套 `rebrandDict`:`build` 拆成 `build`(rebrand 包装)+ `buildRaw`(原逻辑),全语言含 en 统一替换 | B3–B7 |
| `packages/desktop/src/renderer/index.tsx` | 改上游(FORK marker) | `Splash` import 换源 `@opencode-ai/ui/logo`→`@opencode-ai/branding/logo`;通知图标外网 URL→`NOTIFICATION_ICON` | A1 / A5 |
| `packages/app/src/utils/notification-icon.ts` | 新增 fork-only | DeskFox 通知图标 data URL(狐狸,源 branding tray-icons),离线可显示 | A5 |
| `packages/app/src/index.ts` | 改上游(FORK marker) | barrel 导出 `NOTIFICATION_ICON` 供 desktop renderer 复用 | A5 |
| `packages/app/src/entry.tsx` | 改上游(FORK marker) | web 入口通知图标外网 URL→`NOTIFICATION_ICON` | A5 |
| `packages/desktop/scripts/copy-icons.ts` | 改上游(FORK marker) | 上游 □ 图标拷入后,叠加 `branding/src/assets/icons/<channel>` 顶层文件(icon.ico/*.png),覆盖运行时/exe 图标源 | A2 |
| `packages/desktop/src/main/constants.ts` | 改上游(FORK marker) | 新增 `PRODUCT_NAMES`(三档产品名单一源,与 deskfox config 对齐) | B1 |
| `packages/desktop/src/main/windows.ts` | 改上游(FORK marker) | 创建窗口 `title: PRODUCT_NAMES[CHANNEL]`;`page-title-updated`+`preventDefault`+`setTitle` 锁定标题,拦 renderer `<title>OpenCode</title>` | B1 |
| `packages/desktop/src/main/index.ts` | 改 fork-only | 本地 `APP_NAMES` 去重为 `= PRODUCT_NAMES`(复用 constants 单一源) | B1 |
| `packages/desktop/electron-builder.deskfox.config.ts` | 改 fork-only | `extraMetadata.author.name = PRODUCT_NAMES[channel]`(NSIS 卸载列表发布者根源,见 2-plan 决策3) | D1 |
| `packages/desktop/package.json` | 改上游 | 默认 `package` script 指 `electron-builder.deskfox.config.ts`(误发护栏);devDep 加 `@opencode-ai/branding`(renderer 直接 import) | C1 / A1 |
| `packages/app/src/i18n/rebrand.test.ts` | 新增 fork-only | rebrand 单测 + app 出口(appEn+uiEn)无 OpenCode 回潮断言(10 用例) | R5 |
| `packages/desktop/src/renderer/i18n/rebrand-regression.test.ts` | 新增 fork-only | desktop 出口(appEn+desktopEn)回潮断言 + 升级 toast 替换断言(2 用例) | R5 |

## 跟进改动(2026-06-14,真机安装版核对后补)

user 装 dev 安装版逐项核对,发现 3 处补强,均已真机验证:

| 文件 | 类型 | 说明 | 触点 |
|---|---|---|---|
| `packages/app/src/app.tsx` | 改上游(FORK marker) | **第 2 处 Splash 漏接**:AppInterface 的「阻塞式健康检查加载」+「连接错误」两态用上游 `@opencode-ai/ui/logo` 的 □ Splash(桌面启动那一下可见的灰 □ 就是它);import 换源 `@opencode-ai/branding/logo` → 品牌三角 loader(与 `品牌设计/SVG/loading.svg` 同款三角,组件版自带深/浅色适配) | A1 补 |
| `packages/app/src/components/windows-app-menu.tsx` | 改上游(FORK marker) | Windows ≡ 菜单顶部硬编码 `<GroupLabel>OpenCode` + 2 处 `aria-label`,改走 `rebrandValue("OpenCode")`→"DeskFox"(单一源,不新增硬编码品牌串) | 菜单品牌 |
| `packages/desktop/electron-builder.deskfox.config.ts` | 改 fork-only | D1 发布者文字定为厂商名 `DeskFox`(原 `PRODUCT_NAMES[channel]` 会出「DeskFox Dev」与名称列重复);三档统一 | D1 细化 |

真机验证(dev NSIS 安装版,装到 `%LOCALAPPDATA%\Programs\deskfox-dev`):
- 卸载列表发布者注册表实测 = `DeskFox`(原 OpenCode);窗口标题 = `DeskFox Dev`。
- 启动 loader = 品牌三角;≡ 菜单顶部 = DeskFox。
- electron-vite build + electron-builder NSIS 出 `DeskFox-Dev-2026.7.0-win-x64.exe`,静默安装 exit 0、GUI 子系统(正常快捷方式启动无终端)。

## 不动工 / 保留项(均按需求池 §五白名单 + §二取舍)

- **保留 OpenCode**:`OpenCode Zen`/`OpenCode Go`、`wsl.*`(真实 CLI 名)、`error.chain.mcpFailed`(研发向)、`dialog.model.unpaid.freeModels.title`(提供方归属)、菜单 "OpenCode Documentation"(硬编码 label,天然不经 rebrand)。
- **A6 favicon defer**:`app/public/favicon-*` 为指向 ui 的 symlink(Win 占位失效)+ DeskFox favicon 资产未就绪 + 桌面无 tab favicon 几乎不可见 → 留 backlog(详 2-plan 决策4)。
- **A3/A4 Mac 图标 / 视觉**:Mac 真机抽查(A4 托盘已 DeskFox 狐狸 base64)。
- **console 不纳入**(需求池 §七)。

## 验证

- typecheck:`@opencode-ai/app` / `@opencode-ai/desktop` 各 exit 0。
- 单测:app rebrand 10 pass / desktop regression 2 pass;app 全量 419 pass(2 fail 预存在、无关:global-sync child-store / session-status-reconcile)。
- 构建:`electron-vite build` ✓ / `electron-builder --dir --win`(deskfox config)✓ 出 `DeskFox Dev.exe`。
- 真机 boot smoke:6 进程无崩溃;**OS 窗口标题 = "DeskFox Dev"**(B1 直证)。
- 产物核验:`resources/icons/icon.ico` == branding dev icon.ico(md5 `56e338…`);`out/renderer` 运行时无外网 opencode favicon、含 DeskFox 通知 data URL;`out/main` 含 page-title-updated 锁定。

## 治理

- 改上游文件均加 FORK marker(R2);文本只动 `rebrand.ts` + 出口套用,资产只用 `branding/`(不另起并行机制)。
- 0 R4 黑名单 override / 0 改上游 `electron-builder.config.ts`(走 deskfox config)。
- 回退:`git revert` 各 commit;新增文件直接删。

## 待 user

- dev 包真机冷启动逐项视觉 QA(需求池 §八);卸载列表发布者需走一次 NSIS 安装/卸载确认。
