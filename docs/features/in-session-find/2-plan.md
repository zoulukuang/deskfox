feat-id: in-session-find
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-097 会话内查找 — 2-plan

## 关键决策

- **D1 匹配单位与滚动锚**:出现次(occurrence)按轮次(user 消息 + 其 assistant 回复)组织;滚动锚 = 轮次 user 消息(时间线 `data-message-id` 行锚只在 user 行,同 REQ-095 anchor 设计)。跳转 = revealMessage(轮次)→ rAF 重试在轮内定位第 k 个 Range → 视口外再微调 scrollTop。
- **D2 高亮走 CSS Custom Highlight API**:markdown 渲染后的 DOM 不能包 mark 标签(破坏组件树),CSS.highlights 双层(全部命中 + 活跃命中)零 DOM 改动;虚拟化只染已渲染行,滚动事件节流补染;不支持的环境(happy-dom)静默降级。
- **D3 计数在数据层**:sync store 全部已加载消息,虚拟化不影响 total;深位未加载历史留 V2。
- **D4 ⌘F capture 期接管**:composer 是 CodeMirror,自带 Mod-F 搜索面板且冒泡期 stopPropagation;window capture:true 先到手 + preventDefault/stopPropagation。
- **D5 作用域注册口**:`data-deskfox-find-ignore` 祖先内的焦点不响应(本期文件预览区挂此属性);将来预览区自建查找时以此属性为界接管,零改造(user 拍板的架构)。
- **D6 ⌘K 联动通道**:模块级一次性 pending(setPendingFind/consumePendingFind),palette 点击内容命中时写入,FindBar 在 sessionID+turns 就绪后消费——比 URL 参数干净(不污染路由/历史)。

## 踩坑记录

1. **CodeMirror 吞 Mod-F**:bubble 期 window 监听收不到;capture:true + 显式截停解决(e2e 首轮 2 fail 定位)。
2. **e2e 按键太早**:goto 后立即 ⌘F,FindBar 尚未挂载,keydown 无人接;e2e 用 toPass 重试式打开(合成事件 debug 定位:handler 正常,时机问题)。
3. happy-dom 支持 TreeWalker/Range(collectRanges 可单测),不支持 CSS.highlights(applyHighlights 需 no-op 守卫)。
