feat-id: first-launch-onboarding
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 首次启动默认工作区

## 实施单元

- **A1 首启检测 + New DeskFox 初始化 + 标记**:新 fork-only `main/deskfox/onboarding.ts` —— 纯决策 `decideOnboarding` + IO 壳 `runFirstLaunchOnboarding`;`store-keys.ts` 加 `FIRST_LAUNCH_DONE_KEY` / `onboarding.*`。
- **A2 自动 openFolder/openFile**:index.ts 首启后发 `opencode://open-project?directory=..&file=..` deep link;renderer `deep-links.ts` 给 `open-project` 加可选 `file` 参,`layout.tsx handleDeepLinks` 开工作区后 `layout.tabs(key).open("file://" + file)` 打开首个 tab。
- **A3 设置项 + 异常降级**:`onboarding.openOnFirstLaunch`(默认 true)/ `completed` 持久化;所有 IO try/catch 吞错只 log,写失败返回 null 不阻塞、不标记(下次可重试)。
- **A4 介绍文档落 resources**:`packages/branding/src/assets/onboarding/关于 DeskFox 你该知道的几件事.md`(base64 QR 内嵌单文件);`electron-builder.deskfox.config.ts` extraResources → `resources/onboarding`。

## 决策轨迹

- **deep link 复用而非新 IPC(R1 三级跳落在第 2 级)**:主进程→renderer 已有成熟 deep link 管道(`consumeInitialDeepLinks` 初始排空 + `onDeepLink` 运行时,均汇入 `emitDeepLinks`;`open-project` 已能开工作区)。只给 `open-project` 加一个可选 `file` 参 + handleDeepLinks 里几行开 tab,免新 IPC channel、免时序竞态(pending + live send 双保险)。
- **base64 vs 随附 assets(待钉死项 #1)**:实测 `rewriteAssetSrc` 对 `data:` URI 返回 null 不改写(不会被 localasset 改写破坏),DOMPurify 默认对 `img` 放行 `data:` → base64 内嵌可渲染。选**单文件 base64**(符合 user 意图),不退回 assets/。子 agent 初判「高风险」经实测更正为低风险。
- **tab id 格式**:文件 tab id = `file://<相对项目根路径>`(`context/file/path.ts` tab());介绍文档在项目根,相对路径 = 文件名。`open()` 内 `normalizeSessionTab` 会再经 `path.tab` 规范化(编码空格/中文),故 handleDeepLinks 直接传 `file://` + 原始文件名即可。
- **测试基座复用**:`OPENCODE_TEST_ONBOARDING=1` 已有的隔离 userData/XDG 脚手架,天然给首启 e2e 提供「每次全新首启」环境(tmp root → 无 marker → 必触发);index.ts 里 test 模式的 documents 指向 `onboardingTestRoot/documents` 隔离。
- **资源路径 dev/packaged 分支**:packaged 读 `process.resourcesPath/onboarding`;dev 用 `firstExistingPath` 在多个候选(`../../resources/onboarding`、branding 源)里挑存在的,防 dev 布局差异。

## 验证

- `bun test src/main/deskfox/onboarding.test.ts` → 10 pass(decideOnboarding 4 + runFirstLaunchOnboarding 5 + firstExistingPath 1)
- `bun test src/pages/layout/helpers.test.ts` → 34 pass(含新增 open-project file 参解析)
- `bun turbo typecheck --filter=./packages/app --filter=./packages/desktop` → 2/2 绿

## 待真桌面 QA(CDP 自测覆盖不到)

- 全新 profile 双击首启:New DeskFox 建成 + 自动开工作区 + 介绍文档作首个 tab + base64 二维码真渲染。
- Windows 端 `app.getPath("documents")` 落点 + 首启全链路。
- macOS TCC 未授权时 .md 的 file:// 兜底加载。
- 重启不重复 / 删目录不重建 / 已存在不覆盖(单测已覆盖决策,真机复验行为)。
