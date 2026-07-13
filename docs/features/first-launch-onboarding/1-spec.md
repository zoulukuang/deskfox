feat-id: first-launch-onboarding
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 首次启动默认工作区(New DeskFox + 介绍文档)(REQ-083 v4)

> 需求源:`OPENCODE-PLAN/需求计划/2026-07-11-2.md`(REQ-083 v4 简化版)。
> 规模:Medium(主进程 + 渲染层 + 打包配置 + 资源;新增 ~250 行含测试与介绍文档)。

## 需求(v4 简化)

新用户第一次打开 DeskFox:在系统 Documents 目录下创建 `New DeskFox/` 文件夹(macOS/Windows 一致,`app.getPath("documents")`),里面只放一份介绍文档 `关于 DeskFox 你该知道的几件事.md`,自动打开该目录为工作区、该文档作首个 tab。v3 的单轨演示 / 示例文件三件套 / 提示词预填 / 文件树展开全部砍掉。

## 落点(核对后)

- **主进程 = Electron** `packages/desktop/src/main/index.ts`(无 `src-tauri/`)。首启检测 + 建目录 + 拷文件 + 标记全落主进程 Node fs。
- **已确认无生产半成品**:index.ts grep 命中的 `onboarding`/`first-launch` 是 `OPENCODE_TEST_ONBOARDING` **测试脚手架**(隔离 userData/XDG),不是首启逻辑半成品 —— 反而白捡一套隔离测试基座复用。
- **标记持久化**:复用现成 `electron-store`(`main/store.ts` + `store-keys.ts`,落 userData)。
- **自动打开**:复用现成 deep link 通道(`emitDeepLinks` → `open-project`),主进程首启后发 `opencode://open-project?directory=<New DeskFox>&file=<介绍文档>`,renderer 现成 `handleDeepLinks` 打开工作区 + 新增 file 参打开首个 tab。
- **base64 二维码(待钉死项 #1 已验证)**:渲染层 `marked` + `DOMPurify 3.3.1`;`rewriteAssetSrc` 对 `data:` 素通(`utils/local-asset.ts:84`),DOMPurify 默认放行 `img` 的 `data:` → **base64 内嵌确认可渲染** → 采用**单文件**方案(符合 user 单文件意图,无需退回随附 assets/)。

## 验收标准

- [~] 全新机器双击启动:`Documents/New DeskFox/` 已创建 ✅ + 作为工作区自动打开 ✅,但 `关于 DeskFox 你该知道的几件事.md` **未作为首个 tab 自动激活渲染 ❌**(缺陷待修,详 3-changelog);手动打开该文档后二维码正常渲染 ✅(base64 方案坐实)
- [ ] macOS 与 Windows 均落在各自系统 Documents(`app.getPath("documents")`),文件夹里只有那一个文件 —— Mac 隔离验证落 tmp/documents(路径逻辑同);**Windows 待验**
- [x] 重启不再重复触发(marker gate);删除 `New DeskFox/` 后重启不重建;已存在不覆盖;写失败降级不阻塞启动 —— 决策逻辑单测覆盖(TC-A1~A4 / TC-R1~R5)
- [ ] macOS TCC 对话框未点时,介绍 .md 前端 file:// 兜底加载(不依赖 sidecar)—— **待真桌面 QA**

## OUT OF SCOPE

- v3 的单轨演示 / 示例文件三件套 / `0-从这里开始.md` / 提示词预填 / 聊天驱动导出 Word / 文件树展开示例目录 —— 全不做。
- 多语言(介绍文档仅简体一份)/ 入门视频 / 进度条 / Tour 高亮气泡 / 升级追加。
- 设置项 UI 开关:本期落地持久化 key `onboarding.openOnFirstLaunch`(默认 true,可经 store 关)+ `onboarding.completed`,**设置面板 UI 行留 follow-up**(功能开关已生效,只差可视入口)。
