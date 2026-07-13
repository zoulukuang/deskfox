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
- ✅ **介绍文档自动作为首个 tab 激活渲染全文**(2026-07-14 修复后复验:全新首启 2s 内 `active`=介绍文档 tab + 正文「住在你电脑里」/隐私段/文末加群段渲染)
- ✅ **base64 二维码真解码渲染**:`img[src^="data:image/png;base64"]`,naturalWidth=1372 / naturalHeight=1392 / complete=true —— 单文件 base64 方案坐实(待钉死项 #1 闭合)

### ✅ 缺陷已修复:介绍文档 file tab 自动激活(2026-07-14)

首轮实现「自动作首个 tab」不生效,经 CDP 逐层诊断(诊断法本身高复用价值):

- **诊断链**:①`window.__onboardingDebug` 证 consume effect 触发、pending 取到、`openChatFileTab` 调用 → ②tab **已开且预览区在**,但内容空 → ③`window.__ob` 证 `file.load` **很快成功**(loaded=true / hasContent=true)、内容已进 store → ④查 `aria-selected` 证 **active tab 是「审查」(review)**,介绍文档 tab 未激活 → 预览区显示 review 而非文档。
- **真根因(与首判不同)**:不是 load 时机、不是 key/编码,而是**首启默认把 active 设为 review,覆盖了 `openChatFileTab` 的 `setActive`**。
- **修法(最终)**:改用「按目录传递已废弃 → 全局单值 pending」+ 正常 `openProject`(默认导航到 session 视图);session.tsx 消费 effect 里延迟后**持续把 active 设回介绍文档 tab + 保底 force load**,直到 tab 激活且加载(`ensure` 有界自愈,~6s 上限,实测 2s 内成)。彻底避开 `fromLegacy/fromRoute` 的 key 形态差异与 `/var`↔`/private/var` symlink 匹配脆弱性。
- **改动文件**:`session/handoff.ts`(pending 单值)+ `layout.tsx`(setPendingOpenFile + 普通 openProject)+ `session.tsx`(consume + ensure effect)。诊断代码已全部移除。

### ⚠️ 仍待人工 QA(R9 未完全闭合,merge 前须补)

- **视觉最终确认**:真实(非隔离)双击首启,介绍文档在系统 Documents、二维码视觉对齐 —— 建议 user 双击真机看一眼。
- **Windows 端**:`app.getPath("documents")` 落点 + 首启全链路(我在 Mac,须 Win 同事验)。
- **macOS TCC**:真实 `~/Documents` 首启若弹 TCC 授权对话框、未点时 .md 加载路径(隔离用 tmp 不触发 TCC,此项隔离验不到)。
- 设置面板 UI 开关行(功能 key 已生效,可视入口 follow-up)。
