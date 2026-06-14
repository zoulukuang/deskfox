---
feat-id: chat-composer-focus-scroll-reset
status: done
related: ./3-changelog.md
---

# 3-changelog · 从外部点回聊天输入框时 scroll 跳到顶部修复

## 现象

聊天输入框已有较长内容,user 把 scroll 拽到下方(cursor 落在末尾或中段),点击外部任意区域(文件查看器 / 侧边栏 / 文件标签等)后,再点回输入框任意位置(非顶部附件卡片),**输入框文字 scroll 状态被强制拽回顶部** — cursor 实际落在点击位置,但被滚动出可视区,user 必须再手动滑下去找。

user 反馈截图:点回输入框后,文字内容跳到头部,光标停在点击位置但被滚出视口。

## 根因

`packages/app/src/components/prompt-input.tsx:1382` 外层 wrapper div 的 `onMouseDown` 调 `editorRef?.focus()`,使用浏览器默认 `preventScroll: false`,触发 `scrollIntoView` 行为 — 把整个 `editorRef`(contenteditable div)的**开头**滚进父级 scrollRef 容器(`max-h-[240px] overflow-y-auto`)的可视区。当 editor 内容超过 scrollRef 容器高度、user 已往下滚时,这一下硬把 scroll 拽回顶。

Browser native click 之后会把 caret 放在点击位置(DOM 层面),所以 cursor 行为是对的(落在点击处);只是 scroll 状态被 `focus()` 副作用拽走 → 视觉上 cursor 跑出视口。

## 修法

`editorRef?.focus({ preventScroll: true })` — `preventScroll: true` 阻断 `focus()` 触发的自动 `scrollIntoView`。Browser native click 仍正常把 caret 落在点击位置,user 看到的 cursor 跟手指落点一致;scroll 状态完全保持。

## 改动文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/components/prompt-input.tsx` | mousedown handler 的 `editorRef?.focus()` → `editorRef?.focus({ preventScroll: true })` + FORK marker 注释 | +10 -1 |

净改动 ~10 行 / 1 文件 / 0 R3 / 0 R4 / 0 上游侵入。**Tiny** 改动按 v2 规范只写本 3-changelog 简版。

## 影响范围(其他 `editorRef.focus()` 调用都保留原行为)

仅 mousedown 这一行加 `preventScroll`,其他 5 处 `editorRef.focus()` 调用不动:

| 位置 | 场景 | 为什么保持默认 scrollIntoView |
|---|---|---|
| `prompt-input.tsx:437` `setCursorPosition` 后 | 程序化 set cursor 时 | 调用方期望 cursor 可见 |
| `:467` `setMode` 切 shell/normal | 模式切换 | 应跳到可视区让 user 看见模式生效 |
| `:519` `clearEditor`/`focusEditorEnd` | 清空后聚焦末尾 | 已清空,scroll 跳顶无影响 |
| `:538` `restoreFocus` | 切回 session | 应让 cursor 可见 |
| `:932` 拖放/粘贴后 | 编程操作后聚焦 | 应让 cursor 可见 |

只有 mousedown 这条是"user 主动 click 到某处"路径,有自己的 caret placement,不需要 focus() 帮忙滚 — 反而帮倒忙。

## 测试 / 验证

- typecheck 17/17
- 全 app 单测 744/0 pass(0 回归)
- unit 测层未加:browser `focus()` 的 `preventScroll` 副作用 happy-dom 不完整模拟,unit 测不稳定;**靠 user 真桌面验证 + bug-repro tag 标识**
- Mac dev .dmg user 真桌面 verify pass — scroll 行为符合期望(scroll 状态保持,cursor 落点击位置)

## 回退

`git revert 3ffb65408` 即可。改动是一行加参数 + FORK 注释,移除恢复原行为。无其他依赖。

## 关联

- 兄弟 fix:`fix/chat-input-focus-no-scroll-on-add`(`741d5f65c`)— 同款根因不同触发路径(程序化 `focusChatInput()` 而非 mousedown),各自独立 commit + 分支
- 起源对比:`packages/app/src/utils/chat-input-focus.ts` 早期实现也是 `el.focus()` 默认 scrollIntoView,后续在加卡片场景下同款 bug 暴露 → 同款修法
