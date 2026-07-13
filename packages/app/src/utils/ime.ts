// REQ-082: 共享 IME 组合态守卫 —— 选区「加入聊天」浮窗提交键判定用。
// 语义对齐主输入框 prompt-input.tsx 的私有 isImeComposing(那个引用组件内 composing() signal、
// 未导出、import 不到),浮窗不跟踪 composition signal,靠事件自带两枚标志即可:
//   - event.isComposing:标准 IME 组合态标志
//   - event.keyCode === 229:部分输入法(尤其旧版/某些中日韩 IME)只给 229 不给 isComposing
// 两者都判,避免组合确认时的 Enter 被误当成提交。
export function isImeComposingEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}
