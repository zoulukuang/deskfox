feat-id: file-tree-test-client-env
status: done
related: ./3-changelog.md

# 3-changelog · file-tree.test.ts Windows 测试修复(Tiny)

> Tiny(1 文件 / +6 行,纯测试隔离)→ 按规范只写本 changelog。

## 问题

远程同步代码后在 Windows 跑 app 单测套件:`packages/app/src/components/file-tree.test.ts` fail,报 `Client-only API called on the server side`。app 包 708 pass / 1 fail。

## 根因

`bun test` 把 solid-js 解析成**服务端构建**(`solid-js/web/dist/server.js`,无浏览器/development 条件)。该测试只想测纯函数(`shouldListRoot`/`shouldListExpanded`/`dirsToExpand`),但 `import ./file-tree` 连带加载 `@opencode-ai/ui/context-menu`(= Kobalte `ContextMenu`)→ `@kobalte/core` 在模块求值期调 solid-js client-only API → 服务端构建抛错。其余 707 测试不引 Kobalte,故只此一处触发。**纯测试环境问题,非运行时 bug**(真实 app 跑 WebView2 有浏览器,组件正常)。

## 修法(commit `b073c5fa5`)

测试已 mock `collapsible`/`file-icon`/`icon`/`tooltip`,独缺 `context-menu`。补一条同款 mock(Proxy 透传任意子组件)阻止真 Kobalte 加载即可 —— 本测试从不渲染组件,mock 形状无所谓。

上游测试(`#12468`),改动加 FORK marker。

## 测试 / 回归

`file-tree.test.ts` 3 pass / 0 fail;app 包整体 **711 pass / 0 fail**(原 708/1)+ typecheck 17/17。不改任何软件功能。

## 备注

更根本的修法是给 bun test 配 solid-js 客户端构建条件(browser/development),但当前仅此一处触发,按"最小改动"用 mock 隔离。将来若多处组件测试出现同症,再考虑全局条件方案。
