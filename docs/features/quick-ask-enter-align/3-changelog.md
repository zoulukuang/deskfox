feat-id: quick-ask-enter-align
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 「加入聊天」浮窗快捷键对齐

## 实际改动

commit: feat 分支 `feat/quick-ask-align-onboarding`,与 REQ-083 同分支分开 commit;反查 `git log --grep '[feat: quick-ask-enter-align]'`(合 main 后回填最终 hash)

| 文件 | 改动 | 类型 |
|---|---|---|
| `packages/app/src/utils/ime.ts` | 新增 `isImeComposingEvent(e)` 共享纯函数(`e.isComposing || e.keyCode === 229`)| 新增 fork-only |
| `packages/app/src/utils/ime.test.ts` | 4 单测(isComposing / keyCode 229 / 裸 Enter / 两者同命中)| 新增 fork-only |
| `packages/app/src/utils/context-menu-host/host.tsx` | onKeyDown 改裸 Enter 提交 + Shift+Enter 换行 + IME 守卫;移除 `shortcut` 传参;删无用 `IS_MAC` | 改 fork-only |
| `packages/app/src/pages/session/file-tabs.tsx` | 同上(markdown 选区浮窗);保留 FORK marker;删无用 `IS_MAC` | 改上游 |
| `packages/app/src/i18n/zh.ts` | `shortcutHint` → `Enter 提交 · Shift+Enter 换行 · Esc 取消` | 改 |
| `packages/app/src/i18n/zht.ts` | `shortcutHint` → `Enter 提交 · Shift+Enter 換行 · Esc 取消` | 改 |
| `packages/app/src/i18n/en.ts` | `shortcutHint` → `Enter to submit · Shift+Enter for newline · Esc to cancel` | 改 |

行数:约 +50 −12。上游侵入:1 文件(`file-tabs.tsx`,已有 FORK marker,本次续用)。

## 影响范围

- 选区「加入聊天」两个入口(PDF/Office 右键浮窗 + markdown 选区浮窗)提交键位。
- 其余 locale(ar/de/fr/ja/... 等 16 个)无 `shortcutHint` key,回落英文默认,不受影响。

## 回归测试

- `bun test src/utils/ime.test.ts` → 4 pass
- `bun turbo typecheck --filter=./packages/app` → 绿

## 回退方法

`git revert <commit>` 单笔回退(纯前端,P4 可逆)。

## 待真桌面 QA(View 清单,e2e 基础设施就绪后补)

- 两浮窗真键盘:裸 Enter 提交 / Shift+Enter 换行 / 中文输入法组合确认时 Enter 不误提交 / Esc 关闭 / 底部提示文案。
