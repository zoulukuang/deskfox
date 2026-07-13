feat-id: first-launch-onboarding
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 首次启动默认工作区

## 实际改动

commit: feat 分支 `feat/quick-ask-align-onboarding`,与 REQ-082 同分支分开 commit;反查 `git log --grep '[feat: first-launch-onboarding]'`(合 main 后回填最终 hash)

| 文件 | 改动 | 类型 |
|---|---|---|
| `packages/desktop/src/main/deskfox/onboarding.ts` | 新增:`decideOnboarding`(纯决策)+ `runFirstLaunchOnboarding`(IO 壳,降级不阻塞)+ `firstExistingPath` | 新增 fork-only |
| `packages/desktop/src/main/deskfox/onboarding.test.ts` | 新增:10 单测 | 新增 fork-only |
| `packages/desktop/src/main/store-keys.ts` | 加 `FIRST_LAUNCH_DONE_KEY` / `onboarding.openOnFirstLaunch` / `onboarding.completed` | 改 fork-only |
| `packages/desktop/src/main/index.ts` | 首启后调 onboarding + 发 `open-project` deep link(FORK marker)| 改上游 |
| `packages/desktop/electron-builder.deskfox.config.ts` | extraResources 加 `onboarding` → `resources/onboarding` | 改 fork config |
| `packages/branding/src/assets/onboarding/关于 DeskFox 你该知道的几件事.md` | 新增:介绍文档(base64 QR 内嵌单文件,~247KB) | 新增 fork 资源 |
| `packages/app/src/pages/layout/deep-links.ts` | `open-project` 加可选 `file` 参(FORK marker)| 改上游 |
| `packages/app/src/pages/layout.tsx` | handleDeepLinks:开工作区后按 `file` 开首个 tab(FORK marker)| 改上游 |
| `packages/app/src/pages/layout/helpers.test.ts` | 追随 `parseDeepLink` 返回形状 + 新增 file 参解析用例 | 改测试 |

行数:约 +250 −5(不含 base64 资源)。上游侵入:3 文件(index.ts / deep-links.ts / layout.tsx,均 FORK marker)。

## 影响范围

- 仅首次启动(marker gate)。存量用户已有 marker/数据,不触发。
- deep link `open-project` 无 `file` 参时行为完全不变(向后兼容)。

## 回归测试

- `bun test src/main/deskfox/onboarding.test.ts` → 10 pass
- `bun test src/pages/layout/helpers.test.ts` → 34 pass
- `bun turbo typecheck --filter=./packages/app --filter=./packages/desktop` → 2/2 绿

## 回退方法

`git revert <commit>` 单笔回退。资源文件 + 主进程调用点 + deep link 扩展一并回滚,`open-project` 回到无 file 参。

## 真桌面 QA 记录

### ✅ Mac 首启端到端(功能层,2026-07-13,CDP 隔离首启)

本地版 `-Env local --no-bundle` 构建 → `OPENCODE_TEST_ONBOARDING=1` + `--remote-debugging-port=9222` 隔离首启(userData/XDG/documents 全落 tmp,不碰真实 Documents,正式版进程不受影响)→ CDP 验证:

- ✅ 磁盘:`<tmp>/documents/New DeskFox/关于 DeskFox 你该知道的几件事.md` 创建成功
- ✅ 首启 deep link 自动打开 New DeskFox 为工作区
- ❌ **介绍文档未作为首个 tab 自动激活渲染**(缺陷,复现:隔离首启 60s file tab 始终未出现,tabs 仅外壳「审查/所有文件」;手动点文件列表里的介绍文档条目才渲染)。根因见下。
- ✅ **base64 二维码真解码渲染**(手动打开介绍文档后验):`img[src^="data:image/png;base64"]`,naturalWidth=1372 / naturalHeight=1392 / complete=true —— **单文件 base64 方案本身坐实**(待钉死项 #1 闭合),缺陷只在「自动打开 tab」这一步。

> ⚠️ 更正:2026-07-13 首轮 QA 曾记「介绍文档作 tab 渲染 ✅」,系当时隔几分钟后偶然渲染的误判;复测稳定复现「工作区开、file tab 不自动开」。

### ❌ 缺陷:介绍文档 file tab 未自动激活(待修)

- **现象**:`open-project` deep link 的工作区打开稳定成功,但 `handleDeepLinks` 里 `layout.tabs(key).open("file://"+file)` 写入的 file tab 没在 UI 显示/激活。
- **根因(初判)**:`openProject(directory)` 的 `navigateToProject` 导航到项目文件列表视图;`layout.tabs(key).open(tab)` 只把 tab 写进 `projectTabs[projectKey]`,**未 `setActive`、未导航到显示文件预览的视图** → 数据在、UI 没切过去。对比:手动点文件条目走 `createOpenSessionFileTab`(open + setActive + 切预览视图)故能渲染。
- **修法方向(待实现 + 重验)**:handleDeepLinks 里对 file 分支补 `setActive` + 导航到文件预览路由(或复用 `createOpenSessionFileTab` 等价路径),使自动打开的 file tab 立即激活渲染。修后需重跑隔离首启复验。

### ⚠️ 仍待人工 QA(R9 未完全闭合,merge 前须补)

- **视觉最终确认**:真实(非隔离)双击首启,介绍文档在系统 Documents、二维码视觉对齐 —— 建议 user 双击真机看一眼。
- **Windows 端**:`app.getPath("documents")` 落点 + 首启全链路(我在 Mac,须 Win 同事验)。
- **macOS TCC**:真实 `~/Documents` 首启若弹 TCC 授权对话框、未点时 .md 加载路径(隔离用 tmp 不触发 TCC,此项隔离验不到)。
- 设置面板 UI 开关行(功能 key 已生效,可视入口 follow-up)。
