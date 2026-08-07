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

## commit

- 主体:`ec3f0650bb`
