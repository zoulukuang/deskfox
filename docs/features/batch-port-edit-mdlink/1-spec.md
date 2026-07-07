feat-id: batch-port-edit-mdlink
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 三笔独立小修:飞书 OAuth 端口缓存 + 编辑按钮失效 + 聊天 md 链接空白

> 需求源:`OPENCODE-PLAN/需求计划/2026-07-07.md`(REQ-029 + REQ-074 + REQ-075)。
> 三笔彼此无代码耦合,凑一批交付;整体 Medium(REQ-029/074 各为 Tiny 量级,REQ-075 为主体)。

## 需求与根因(均已对 main 代码坐实,2026-07-07 审查)

| REQ | 一句话 | 根因落点 |
|---|---|---|
| REQ-029 | 飞书 plugin 重启换端口后,前端仍用旧端口报错 | `packages/desktop/src/main/deskfox/feishu.ts:18-33` `cached` 一次设值永不失效 |
| REQ-074 | 文件查看器右键「编辑」永久灰显(换基座回归) | `packages/app/src/pages/session/file-tabs.tsx:446` `isTauri()` 检测 `__TAURI_INTERNALS__`,Electron 不注入 → 永远 false |
| REQ-075 | 聊天消息里点相对路径 md 链接 → SPA 被原生导航掉,界面空白 | 聊天区 Markdown 无点击拦截(拦截逻辑只挂在 file-tabs.tsx 文件预览容器);main 进程无 `will-navigate`/`setWindowOpenHandler` 兜底 |

## 架构选型

- **REQ-029**:`loadReady()` 加 mtime 失效(每次 `statSync` 比对,变了才重读);函数可测化(注入路径)。不固定端口、不上 fs.watch。
- **REQ-074**:`packages/app/src/utils/native.ts`(deskfox 桥唯一封装点)export `isDesktopApp()`,file-tabs.tsx 3 处改用。不新写第二份 `"deskfox" in window`。
- **REQ-075** 三件套:
  1. **提取共享 util**(新文件):把 file-tabs.tsx `handleMdLinkClick`(1299-1343)的解析/越权/存在性检查逻辑提为参数化函数(`baseDir` 可传——文件预览区=当前文件所在目录,聊天区=项目根);file-tabs 改为调用共享实现,行为不变。
  2. **聊天区接线**:session.tsx 聊天时间线容器加 onClick 委托(≤5 行注入 + FORK marker),命中项目内相对链接 → 走与文件树同款的 `createOpenSessionFileTab` 链(开 tab + 开预览面板 + setActive)。**相对路径按项目根(`sdk.directory`)解析**(user 2026-07-07 拍板)。
  3. **main 进程兜底**(新文件 `navigation-guard.ts` + createMainWindow 1 行注入):`will-navigate` 拦截主窗口被导航离开 app 页;`setWindowOpenHandler` 对 http(s) 转 `shell.openExternal`、其余 deny。

### 外链现状(2026-07-07 实测结论,加兜底前的风险评估)

聊天 markdown 外链走 fork 自建委托链(`a.external-link` 全局点击委托 → IPC `open-link` → `shell.openExternal`),与 will-navigate/window-open 兜底**互不干扰**。`message-part.tsx:736/1682` 两处硬编码 `target="_blank"`(exa/webfetch 链接)现状是弹**裸 Electron 窗**(CDP 实测证实),`setWindowOpenHandler` 落地后改为系统浏览器打开 = 顺手修复,纳入验收。

## OUT OF SCOPE

- REQ-029:不做端口固定化 / fs.watch / OAuth 流程重构
- REQ-074:不改可编辑格式黑名单(二进制/Office/>10MB 仍不可编辑)
- REQ-075:不重构链接渲染管线;不合并聊天区与文件预览区两条实现(只提取共享 util + 补聊天区接线);不处理聊天里的绝对路径链接(锦上添花,不进本批)

## R8 测试用例清单(动工前定稿)

### REQ-029(unit,packages/desktop;+人工)
- [ ] T1 写 server.json{url:…10167} → `loadReady()` 返 10167 【unit】
- [ ] T2 改写 server.json{url:…3961}(mtime 变)→ `loadReady()` 返 3961 【unit,关键回归点】
- [ ] T3 文件删除/内容损坏 → 返 null 且内部缓存被清(不残留旧值)【unit】
- [ ] T4 文件未变(mtime 同)→ 命中缓存(返回同一对象/不重读)【unit】
- [ ] M1 真桌面:飞书 OAuth 中途 kill plugin 进程 → 看门狗重启换端口 → 功能自愈不报旧端口 【人工,运行时风险点】

### REQ-074(unit + 真机)
- [ ] U1 `isDesktopApp()`:`window.deskfox` 存在 → true;缺失 → false 【unit】
- [ ] M1 真桌面:右键 .md/.txt/.ts →「编辑」可点 → 进 CodeMirror → 保存内容正确 【人工,native 右键菜单只能真机验】
- [ ] M2 真桌面:二进制/Office/大文件「编辑」仍灰显(黑名单不破坏)【人工】

### REQ-075(unit on 共享 util + CDP e2e + 真机)
- [ ] U1 http(s)/mailto/data/blob 外链 → 不拦截(不 preventDefault、不调 onOpen)【unit】
- [ ] U2 锚点 `#xxx` → 不拦截 【unit】
- [ ] U3 相对路径解析落在项目根内 → preventDefault + 调 onOpen(正确 rel)【unit;含聊天场景 baseDir=根、文件场景 baseDir=文件目录 两组】
- [ ] U4 越权路径(`../../..`)→ 越权 toast + preventDefault + 不调 onOpen 【unit】
- [ ] U5 目标文件不存在(mtime 探测失败)→ 「文件不存在」toast + 不开 tab 【unit,mock invoke】
- [ ] U6 修饰键(ctrl/meta/shift/alt)按住点击 → 不拦截 【unit】
- [ ] E1 CDP:聊天消息点相对 md 链接 → 右侧文件预览区开 tab 展示 【CDP】
- [ ] E2 CDP:点不存在文件的链接 → toast,主内容区不空白 【CDP】
- [ ] E3 真机:聊天点 http(s) 外链 → 系统浏览器弹出,SPA 不动 【人工,native 行为】
- [ ] E4 真机:exa/webfetch 硬编码 `_blank` 链接 → 系统浏览器打开(不再弹裸 Electron 窗)【人工】
- [ ] E5 CDP:主窗口强制触发外部导航(模拟漏接线)→ `will-navigate` 拦下,界面不空白 【CDP】
- [ ] R1 回归:文件预览区内部 md 内链跳转 / 越权 toast / 不存在 toast 行为不变(提取 util 后)【unit 覆盖 + CDP 抽查】

## 验收门槛(对齐需求计划 doc + 外链细化)

- [ ] REQ-029:T1-T4 绿 + M1 人工过
- [ ] REQ-074:U1 绿 + M1/M2 真机过
- [ ] REQ-075:U1-U6 绿 + E1/E2/E5 CDP 过 + E3/E4 真机过 + R1 回归无碎
