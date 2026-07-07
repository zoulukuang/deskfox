feat-id: batch-port-edit-mdlink
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

分支 `feat/batch-port-edit-mdlink`(基于 main `01d5c98c7`)。三笔各自独立 commit(P4 可单独 revert),每笔 fix + 复现测试同 commit,标 `[bug-repro: …]`。顺序:REQ-029 → REQ-074 → REQ-075。

## REQ-029 飞书端口缓存 mtime 失效

- `packages/desktop/src/main/deskfox/feishu.ts`:`loadReady()` 按工单补丁加 `cachedMtimeMs`;为可测性把核心逻辑提为 `loadReadyFrom(file: string)`(路径参数化,`loadReady()` 薄壳传默认路径),export 供测试。
- 测试:`packages/desktop/src/main/deskfox/__tests__/feishu-load-ready.test.ts`(bun test,临时目录写真实文件,覆盖 T1-T4)。
- 注意:mtime 精度理论上同毫秒双写可漏检,真实场景 plugin 重启间隔 >> 1ms,不处理(spec OUT OF SCOPE 精神)。

## REQ-074 编辑按钮检测桥

- `packages/app/src/utils/native.ts`(FORK-ONLY 文件):export `isDesktopApp()`。
- `packages/app/src/pages/session/file-tabs.tsx`:446 行 `isTauri` 定义删除,448/461 两处调用改 `isDesktopApp()`,FORK marker 注明换基座回归修复。
- 测试:`native.test.ts` 覆盖 U1(mock window.deskfox 有/无)。

## REQ-075 聊天区 md 链接拦截 + 兜底

**新文件 1**:`packages/app/src/pages/session/md-link-click.ts` — 提取 file-tabs.tsx:1299-1343 逻辑,签名(纯函数,便于单测):

```ts
createMdLinkClickHandler(input: {
  root: () => string | undefined          // 项目根(越权边界)
  baseDir: () => string | undefined       // 相对路径解析基准(聊天=root,文件预览=当前文件目录)
  onOpen: (rel: string) => void           // 命中项目内文件 → 开 tab 链
  checkExists?: (root, rel) => Promise<unknown>  // 默认 invoke("get_file_mtime"),可注入 mock
  toast?: (…) => void                     // 默认 showToast,可注入
}): (event: MouseEvent) => void
```

- `file-tabs.tsx` 的 `handleMdLinkClick` 改为调该工厂(baseDir=当前文件目录),行为不变(R1 回归用例守护)。
- `session.tsx` MessageTimeline 挂载容器加 `onClick`(≤5 行 + FORK marker),handler 用同工厂(baseDir=root),onOpen 走 `createOpenSessionFileTab` 同款输入(session.tsx 已有 `tabs()/file/view()` 原语,见 949-955 现例)。

**新文件 2**:`packages/desktop/src/main/deskfox/navigation-guard.ts` — export `wireNavigationGuard(win)`:
- `will-navigate`:目标 URL 非 app 自身协议(`oc://`)→ `preventDefault`;http(s) 顺手转 `shell.openExternal`(与 open-link IPC 同语义)。
- `setWindowOpenHandler`:http(s) → `shell.openExternal` + `{action:"deny"}`;其余一律 deny。
- `windows.ts` `createMainWindow()` 加 1 行 `wireNavigationGuard(win)`(FORK marker)。
- ⚠️ 已核实不与现有外链链路冲突(spec §外链现状);`oc://` 内部导航(如有)必须放行——落地时先确认 renderer 是否存在合法整页导航(`location.reload` 走 reload 事件不走 will-navigate,安全)。

**测试**:`md-link-click.test.ts` 覆盖 U1-U6 + R1(两组 baseDir);CDP 验 E1/E2/E5;真机 E3/E4。

## 决策轨迹

- 2026-07-07 user 拍板:聊天区相对路径按**项目根**解析;确认两条产品行为(外链→浏览器、项目内文档→预览区 tab)。
- 2026-07-07 实测(CDP,本地版 2026.8.2):无 `setWindowOpenHandler` 时 `window.open(_blank)` 弹裸 Electron 窗 → exa/webfetch 链接现状即如此,兜底落地 = 顺手修复,非行为破坏。
- message-part.tsx(packages/ui,上游文件)**零改动** — 拦截全部在 app 层容器委托实现,符合 R1/P1。
