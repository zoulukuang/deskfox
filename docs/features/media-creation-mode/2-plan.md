feat-id: media-creation-mode
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan · 创作模式实施计划 + 决策轨迹

## 实施分层

1. **后端骨架**:`catalog.ts`(8 模型目录)/ `registry.ts`(按 auth.json key 过滤亮模型)/ `dispatch.ts`(条目→引擎,复用 dashscope-*)。
2. **本地服务**:`server.ts` `Bun.serve` 固定端口 51737(R6 loopback)+ SSE `/generate` + `/models` + `/files` + 落盘 `asset-save.ts`。
3. **前端**:`media-creation.ts`(客户端,SSE 解析)+ `media-creation-store.ts`(createMode 信号 / runCreation / loadModels 重试)+ `media-creation-bar.tsx`(模式菜单 + 模型/音色下拉)+ `media-creation-results.tsx`(轻量结果卡)。
4. **上游注入(FORK)**:`prompt-input.tsx`(loadModels + handleFormSubmit 创作档拦到 runCreation + 工具栏 Show 守卫)/ `message-timeline.tsx`(结果卡融入聊天滚动流)。

## 决策轨迹(踩坑/推翻)

- **否决 AI 自动调工具** → 改显式创作模式(user 2026-05-26 拍板,可控性 + 可发现性)。
- 结果卡位置:初版"输入框上方独立条"(80fea5dee 加滚动容器)→ user 反馈挤掉输入 → **挪进聊天滚动流**(a30f1f94c,方案 C),去掉自带限高滚动,由时间线统一承载。
- 落盘位置:初版全局 `~/.deskfox/creations/` → user 要求**按项目根**(e026d0509)→ `<projectDir>/creations/`。
- ＋附图:user 报"附件图没传给模型" → submitCreation 提取 imagePart.dataUrl→refFile(2da6b77b0);附件提交后残留 → prompt.reset()。
- 回车误入聊天:Enter handler 调 handleSubmit 绕过创作拦截 → 改 handleFormSubmit(34096651b)。
- 样式对齐:模式菜单出滚动条/显中文描述 → 去 select.css 高度上限(scoped 类)+ 左侧显模型名(991025f21)。
- 措辞:配音→语音合成、转写→语音识别 + 语音合成加音色选择(34096651b)。
- 自测:CDP 驱动真实 WebView2(9222)端到端验交互 + 生成(90808c616);**改 media-gen/src 后必须单独 build dist**否则边车跑旧插件。

## 待办(留 backlog)

无模型引导 UI 实现 + 通用引擎/Layer3/自助配置(详后续路线 doc)。
