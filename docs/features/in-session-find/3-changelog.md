feat-id: in-session-find
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-097 会话内查找(⌘F)— 3-changelog

> 开发完成 2026-08-07。commit hash 回填见尾注。**全部改动在 packages/app 白名单区,0 R4 override。**

## 实际改动

### 新增文件(fork-only,~700 行含测试)

| 文件 | 说明 |
|---|---|
| `packages/app/src/pages/session/find/find-core.ts` | 纯逻辑:出现计数/轮次扁平表/环形步进/锚点定位 |
| `packages/app/src/pages/session/find/dom-highlight.ts` | CSS Custom Highlight 层:TreeWalker 收集 Range + 双层高亮 + 轮内活跃定位;不支持环境静默降级 |
| `packages/app/src/pages/session/find/find-bar.tsx` | 查找条 UI:⌘F capture 接管/计数/Enter⇧Enter ↑↓ 跳转/Esc/滚动补染/⌘K 联动消费 |
| `packages/app/src/pages/session/find/find-request.ts` | ⌘K → 会话页一次性联动通道 |
| `find-core.test.ts` + `dom-highlight.test.ts` | 16 用例 |
| `packages/app/e2e/smoke/in-session-find.spec.ts` | 3 条 e2e(⌘F 流/0-0/⌘K 联动)|

### 改上游文件(全部带 FORK marker,全在 app 白名单)

| 文件 | 内容 |
|---|---|
| `message-timeline.tsx` | reveal 抽本地函数共用 + findTurns 轮次文本 memo + FindBar 挂载 |
| `dialog-select-file.tsx` | 内容命中点击写入 pendingFind(带词联动)|
| `session.tsx` / `file-tabs.tsx` | 预览区挂 `data-deskfox-find-ignore`(作用域注册口,双挂载点)|
| `i18n/*.ts`(19 语言)| 3 键:find.placeholder / find.prev / find.next |

## 回归测试(2026-08-07)

- 单测:find 模块 16/16;app 全量 595(0 fail)
- e2e:本 feat 3 条 + **全量 29/29**(REQ-095/096 无回归)
- typecheck fork 范围全绿
- 真机 CDP(Mac 本地版):composer 聚焦 ⌘F 接管(压过 CodeMirror Mod-F)/ 中文「编译报错」计数 1/2 → Enter 2/2 / Esc 关闭 / **高亮真机渲染截图铁证** / ⌘K「钛合金狐狸」命中点击 → 查找条带词自动展开 1/1 并定位 / 预览区作用域(ignore 子树 target 不响应 + 双挂载点属性运行时在位)。另跑标题重命名探针 2 项确认 REQ-096 链路无回归。

## 踩坑(详见 2-plan)

CodeMirror 吞 Mod-F(capture 接管)/ e2e 按键早于组件挂载(toPass 重试)/ happy-dom 无 CSS.highlights(降级守卫)。

## 回退方法

`git revert` 1 笔 commit;纯前端,无 DB/API 变化。

## Follow-up:跳转定位失效修复(2026-08-07,user 真机报障)

**症状**:真实长会话里计数在走、视图不动;⌘K 落地也不定位到关键词。首版真机验证用的短种子会话(内容全在视口内)没压出滚动路径——测试盲区教训。

**三层根因**(在 user 真实「1599」会话上以 CDP 逐层实证):
1. **架构错位**:轮次几何/DOM 文档序定位在 virtua 虚拟列表下全不可信(行复用、绝对定位,文档序≠视觉序;深位 part 行直接被卸载出 DOM)。→ 重构为**数据直达**:匹配单位改为「可定位单元」(user 消息文本 / assistant 单 text part,与行结构一一对应),行帧铺 `data-find-part-ids`,跳转 = partRowIndex → scrollToIndex 直达行 → 行内取第 k 个 Range。
2. **reveal 竞态**:每跳先 scrollToIndex(行中心)再微调,前者异步落地把微调吸回行中心。→ **locate-first**:行已在 DOM 只做微调;行缺失才 reveal;行未构建(深位历史)hash 兜底自动翻页。
3. **scrollTop 大步被钳**:virtua 估算 scrollHeight,直接大步 scrollTop 偏差恰一个视口高。→ 大距离交 scrollToIndex 收敛,小距离微调 + 逐帧复核循环(修复原复核不递减的空转)。

另修:同会话内 ⌘K 命中联动不触发(consume 效应缺 hash 依赖)。

**验证**:真机 user 真实会话逐跳视口断言 4/4(每跳落点 574/968/574/574,精准中线);⌘K 联动(跨会话+同会话)PASS;新增 bug-repro e2e(40 轮长会话深位命中跳转必须可见);全量 e2e 30/30、app 596 单测、typecheck 全绿。

fix 分支 `fix/in-session-find-jump`,commit `09494cd28e`。

## V2:深位历史遍历(2026-08-07,user 要求补全)

查找开着时**后台渐进加载更早历史**(250ms/页节流,封顶 40 页):总数收敛,未拉完挂 "+"(如 3/17+);0 命中且有深位历史时持续深挖,找到即自动定位;⇧Enter 到达最早已加载出现时按需再拉(5 页/次);历史前插导致 index 后移按身份(unitID+indexInUnit)对齐游标。纯前端(sync.session.history.more/loading/loadMore 现成管线),0 R4。e2e 新增 E1d(120 轮,唯一词只在未加载深位 → 收敛 1/1 且跳达);真机 200 轮种子会话跨 197 轮自动定位视口内(top=298)。commit `f91711b70a`

## commit

- 主体:`ec3f0650bb`(V1)
