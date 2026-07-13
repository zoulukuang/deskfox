feat-id: quick-ask-enter-align
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 「加入聊天」浮窗快捷键对齐

## 实施单元

- **B1 两浮窗提交键 + IME 守卫**:新建 `utils/ime.ts` 导出 `isImeComposingEvent`;两浮窗 onKeyDown 改为 `Shift+Enter 换行(return 交默认)→ IME 守卫 return → 裸 Enter 提交`,顺序对齐主输入框 `prompt-input.tsx`(Shift+Enter 判定先于 IME,IME 先于提交)。
- **B2 i18n 模板**:`shortcutHint` 模板串改文案(zh/zht/en),移除两浮窗 `shortcut` 传参。

## 决策轨迹

- **为什么 `Shift+Enter` 只 return 不 preventDefault**:浮窗是原生 `<textarea>`(不同于 prompt-input 的自定义 contenteditable),`Shift+Enter` 默认就插换行,直接 return 让默认行为生效即可,无需手动插 `\n`。
- **`IS_MAC` 常量清理**:两浮窗改后 `IS_MAC` 仅剩定义、无引用 → `noUnusedLocals` 会报错,删两处 `const IS_MAC = ...` 定义。
- **共享 util 不复制 prompt-input 的 `composing()` signal**:浮窗生命周期短、不跟踪 compositionstart/end 事件,`e.isComposing || e.keyCode === 229` 两枚事件自带标志已足够,与需求 doc 建议一致。
- **测试策略(helper extract 模式)**:onKeyDown 内联 JSX 依赖完整组件渲染上下文(usePrompt/useLanguage/providers),按治理「组件抽出的 helper 进 Logic 清单、原组件留 View 清单」原则,把 IME 守卫抽成纯函数单测(`ime.test.ts` 4 例),浮窗组件本体待 e2e 基础设施(View 清单)。

## 验证

- `bun test src/utils/ime.test.ts` → 4 pass
- `bun turbo typecheck --filter=./packages/app` → 绿
