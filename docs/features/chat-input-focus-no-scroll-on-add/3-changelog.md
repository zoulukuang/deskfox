---
feat-id: chat-input-focus-no-scroll-on-add
status: done
related: ./3-changelog.md
---

# 3-changelog · 加卡片入聊天后输入框 scroll 跳顶修复

## 现象

聊天输入框已有较长内容、user 已 scroll 到下方,在文件查看器右键选区 → **添加到聊天窗口** → 卡片(`聊天引用 / skillhub.md:3-5` 等)加完后,**下方输入框文字 scroll 状态被强制重置到顶部** — cursor 仍在末尾(被 `focusChatInput` 程序化设置),但被滚出视口,user 必须自己滑下去找。

跟兄弟 fix `chat-composer-focus-scroll-reset` 是**同款根因不同触发路径**:
- 兄弟 fix:user mousedown click 路径(`prompt-input.tsx:1382`)
- 本笔:卡片 submit 后程序化 focus 路径(`chat-input-focus.ts:24`)

## 根因

`packages/app/src/utils/chat-input-focus.ts:24` `focusChatInput()` 内调 `el.focus()`,用浏览器默认 `preventScroll: false`,触发 `scrollIntoView` 把整个 `editorRef`(contenteditable div)的开头滚进父级 scrollRef(`max-h-[240px] overflow-y-auto`)的可视区。当 editor 内容超过容器高度、user 已往下滚时,scroll 状态被硬拽回顶。

调用链:
```
user 右键选区 → 添加到聊天 → submitToChat / submitMdSelection
  → prompt.context.add(...)       // 增卡片到 chat context
  → requestAnimationFrame(focusChatInput)
    → el.focus()                  // 默认 scrollIntoView 触发 → scroll 跳顶
    → range.selectNodeContents(el) → collapse(false)
    → sel.addRange(range)         // cursor 程序化移到末尾(此处 selection 不触发 scroll)
```

## 修法

`el.focus({ preventScroll: true })` — focus 不触发自动 scrollIntoView,scroll 状态保持。cursor 仍由下方 Selection API 程序化移到末尾(浏览器对程序化 `selection.addRange` 默认不 `scroll-into-view`,这是 spec 行为)。user 想看末尾自己滑;关键不变量"加卡片后输入框 scroll 不动"达成。

## 改动文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/utils/chat-input-focus.ts` | `el.focus()` → `el.focus({ preventScroll: true })` + FORK marker 注释 | +8 -1 |

净改动 ~8 行 / 1 文件 / 0 R3 / 0 R4 / 0 上游侵入。**Tiny** 改动按 v2 规范只写本 3-changelog 简版。

## 影响范围

`focusChatInput` 被三处消费者调用,本笔 fix 全部受益:

| 消费者 | 场景 | 行为变化 |
|---|---|---|
| `pages/session/file-tabs.tsx:1171` `submitMdSelection` | .md / 代码 / HTML 右键添加到聊天 | scroll 保持,cursor 到末尾 |
| `utils/context-menu-host/host.tsx:370` `submitToChat`(file/chat 卡片路径)| PDF / office / 聊天区右键添加 | 同上 |
| `utils/context-menu-host/host.tsx:384` `submitToChat`(老路径 fallback)| sourceKind 为空的旧逻辑兜底 | 同上 |

三处均按 user 意愿"卡片加入不影响下边输入区文字的跳转保持不动"。原 helper 注释"光标位置兜底 + caret-to-end" 语义不变,只是不再附带 scroll 副作用。

## 测试 / 验证

- typecheck 17/17
- 全 app 单测 744/0 pass(0 回归)
- unit 测层未加:browser `focus()` 的 `preventScroll` 副作用 happy-dom 不完整模拟,unit 测不稳定;**靠 user 真桌面验证 + bug-repro tag 标识**
- Mac dev .dmg user 真桌面 verify pass — 加卡片场景 scroll 不动符合期望

## 回退

`git revert 741d5f65c` 即可。改动是一行加参数 + FORK 注释,移除恢复原行为。无其他依赖。

## 关联

- 兄弟 fix:`fix/chat-composer-focus-scroll-reset`(`3ffb65408`)— 同款根因不同触发路径(mousedown 而非 `focusChatInput`)
- 设计观察:`el.focus({ preventScroll: true })` 这个浏览器 API 选项在 contenteditable + 滚动容器场景下是**默认推荐**用法 — 任何"editor 局部聚焦不要扰动 scroll"的代码都应该考虑加上。未来如有第三处类似 bug,先在 `editorRef.focus()` / `chatInputRef.focus()` 调用点扫一遍 `preventScroll` 状态。
