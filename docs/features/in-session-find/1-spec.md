feat-id: in-session-find
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-097 会话内查找(⌘F)— 1-spec

> 源:OPENCODE-PLAN `需求池/会话内查找.md`(2026-08-07 PM 讨论,user 拍板:焦点作用域架构 + ⌘K 联动)。

## 需求

1. **查找条**:会话页 ⌘F 呼出:输入词 → 会话内命中高亮 + 计数「n/total」+ Enter/⇧Enter(或 ↑↓ 按钮)在命中间环形跳转 + Esc 关闭。
2. **焦点作用域**:⌘F 按焦点面板分发;文件预览区(`data-deskfox-find-ignore`)不响应,该属性即将来预览区自建查找的注册口。composer(CodeMirror)聚焦时也归会话查找(capture 期接管,压过 CM 自带 Mod-F)。
3. **⌘K 联动**:内容搜索命中点击 → 会话打开 + 查找条带词自动展开 + 定位到命中轮次首个出现,可继续 Enter 遍历。
4. **V1 范围**:数据层匹配全部已加载消息(user/assistant text part,轮次组织);高亮 CSS Custom Highlight API 只染已渲染 DOM(虚拟化安全,不改 DOM);未加载深位历史遍历(V2 接后端)不在本期。

## 架构(要点)

- 纯逻辑 `find-core.ts`(计数/扁平出现表/环形步进/锚点定位)+ DOM 层 `dom-highlight.ts`(TreeWalker 收集 Range + CSS.highlights 双层高亮 + 轮次内活跃 Range 定位,不支持时静默降级)+ `find-bar.tsx`(UI/键盘/滚动补染/联动消费)+ `find-request.ts`(⌘K→会话页一次性通道)。
- 挂载在 message-timeline 根容器;跳转复用 `revealMessage`(虚拟化 scrollToIndex)+ rAF 重试定位轮内 Range。
- 全部改动在 packages/app 白名单区,**0 R4 override**。

## R8 测试用例清单

Unit(Logic):
- [x] U1 countOccurrences:中文/大小写/空/重叠
- [x] U2 buildOccurrences 轮次序展开;stepIndex 环形;indexForAnchor 回退链
- [x] U3 collectRanges 跨元素文档序;locateActiveRange 轮次切分;不支持环境降级

e2e:
- [x] E1 ⌘F 打开 → 计数 → Enter/⇧Enter 步进 → Esc 关闭
- [x] E1b 无命中 0/0
- [x] E2 ⌘K 内容命中 → 查找条带词自动展开 + 计数就绪

真机(CDP):
- [ ] M1 ⌘F 于聊天区/composer 聚焦时打开;预览区聚焦不响应;中文命中高亮可见;Enter 跳转滚动;⌘K 联动

## 验收标准

- [ ] 会话页 ⌘F 查找条可用(含 composer 聚焦时),中文命中,计数与跳转正确
- [ ] 文件预览区 ⌘F 不触发会话查找
- [ ] ⌘K 内容命中点击后落地即定位,可继续遍历
- [ ] FTS/Highlight 不支持环境不崩(计数仍工作,高亮降级)
