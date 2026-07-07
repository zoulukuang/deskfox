feat-id: batch-port-edit-mdlink
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实际改动

> 分支 `feat/batch-port-edit-mdlink`(基于 main `01d5c98c7`)。三笔独立 commit,各自可单独 revert。

## Commit 列表

| commit | 内容 | 行数 |
|---|---|---|
| `51594a617` | docs:1-spec(R8 用例清单)+ 2-plan + INDEX | +120 |
| `867d4d806` | REQ-029 feishu.ts mtime 失效 + 6 单测 | +100/-5,3 文件 |
| `12a19b976` | REQ-074 isDesktopApp 修编辑按钮 + 3 单测 | +40/-4,3 文件 |
| `839bacba7` | REQ-075 md 链接拦截共享 util + 聊天接线 + main 兜底 + 16 单测 | +364/-46,8 文件 |

## 影响范围

### REQ-029(全 fork-only)
- `packages/desktop/src/main/deskfox/feishu.ts` — `loadReady()` → `loadReadyFrom(file)` 参数化 + `cachedMtimeMs` 失效;损坏/删除清缓存
- `packages/desktop/src/main/deskfox/feishu-ready.test.ts`(新)— T1-T4 共 6 测
- `packages/desktop/test/electron-mock.ts` — 补 `dialog` mock 成员

### REQ-074
- `packages/app/src/utils/native.ts`(fork-only)— export `isDesktopApp()`(deskfox 桥唯一封装点)
- `packages/app/src/utils/native.test.ts`(新)— 3 测(含 `__TAURI_INTERNALS__` 不再作数防复发)
- `packages/app/src/pages/session/file-tabs.tsx` — `isTauri()` 定义删除,`canEdit`/`editDisabledReason` 改 `isDesktopApp()`(FORK marker)

### REQ-075
- `packages/app/src/pages/session/md-link-click.ts`(新,fork-only)— 拦截逻辑参数化提取(baseDir 聊天=项目根 / 预览=当前文件目录;toast/checkExists 注入式,零重依赖)
- `packages/app/src/pages/session/md-link-click.test.ts`(新)— 10 测(U1-U6 + 双模式 + Windows 反斜杠 root)
- `packages/app/src/pages/session/file-tabs.tsx` — `handleMdLinkClick` 改调共享工厂,行为不变
- `packages/app/src/pages/session.tsx` — 聊天时间线 display:contents 委托容器 + `createOpenSessionFileTab` 开 tab 链(FORK-BEGIN/END)
- `packages/desktop/src/main/deskfox/navigation-guard.ts`(新,fork-only)— `will-navigate` 一律拦 + `setWindowOpenHandler` http(s) 转系统浏览器其余 deny
- `packages/desktop/src/main/deskfox/navigation-guard.test.ts`(新)— 6 测(决策函数 + wire 胶水)
- `packages/desktop/src/main/windows.ts` — `createMainWindow` 注入 `wireNavigationGuard(win)`(2 行 + FORK marker)
- `packages/desktop/test/electron-mock.ts` — 补 `shell` mock 成员

改上游文件:file-tabs.tsx / session.tsx / windows.ts(均 FORK marker,注入量 ≤ 每处 5 行级);0 黑名单 / 0 R4。

## 回归测试

- typecheck:`bun turbo typecheck --filter='!./packages/console/*'` 22/22 ✅
- app 包:515 pass / 0 fail(含新 13 测)✅
- desktop 包:118 pass / 0 fail(含新 12 测;另 1 fail 为既有 `electron-builder.config.test.ts` Linux 路径可移植性问题,干净树复核与本批无关)✅
- CDP 自测(本地版 2026.8.2,win-unpacked 全新构建,2026-07-07):
  - **E1** ✅ 聊天消息点相对 md 链接(`./req075-probe.md`)→ 右侧预览区开 tab、内容正确渲染、URL 不变、无空白
  - **E2** ✅ 点不存在文件链接 → toast「文件不存在」,不开 tab、不空白
  - **越权** ✅ 点 `../../../../windows/win.ini` → toast「链接超出项目范围 D:/windows/win.ini」,不导航
  - **E5a** ✅ 强制 `location.href='./xxx.md'`(模拟漏接线原生导航)→ will-navigate 拦下,页面纹丝不动
  - **E5b** ✅ `window.open(https,_blank)` → 不再弹裸 Electron 窗(page target 数不变,setWindowOpenHandler deny 生效)
  - **REQ-074** ✅ md 预览右键 → 菜单「编辑」`disabled:false`(修复前永久灰显)→ 点击进 CodeMirror、内容正确;「添加到聊天/复制」无选区时仍正确灰显
  - 冷启动无 error toast(全新构建两次 fresh launch 观察)
- 真机 QA(user 待验,CDP 不可替代项):
  - [ ] REQ-074:真桌面右键 .md/.txt/.ts 编辑→改→保存,内容落盘正确;二进制/Office/大文件「编辑」仍灰显
  - [ ] REQ-075 E3:聊天点 http(s) 外链 → **系统浏览器**弹出(native 行为)
  - [ ] REQ-075 E4:exa 搜索结果 / webfetch 网址链接 → 系统浏览器(修复前弹裸 Electron 窗)
  - [ ] REQ-029 M1:真桌面飞书 OAuth 中途 kill plugin 进程 → 看门狗重启换端口 → 功能自愈不报旧端口

## 回退方法

三笔独立 `git revert`:
- 回退 REQ-029 → revert `867d4d806`
- 回退 REQ-074 → revert `12a19b976`
- 回退 REQ-075 → revert `839bacba7`(app 拦截与 main 兜底同笔;如只想撤兜底,单独删 windows.ts 注入 2 行)
