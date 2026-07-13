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

## ⚠️ 待真桌面 QA(R9 未闭合,不可据此提 merge 前置)

- 全新 profile 首启端到端(New DeskFox 建成 + 自动开工作区 + 介绍文档首 tab + base64 二维码渲染);可用 `OPENCODE_TEST_ONBOARDING=1` 起隔离首启。
- Windows 端 Documents 落点 + 全链路。
- macOS TCC 未授权 .md file:// 兜底。
- 设置面板 UI 开关行(功能 key 已生效,可视入口 follow-up)。
