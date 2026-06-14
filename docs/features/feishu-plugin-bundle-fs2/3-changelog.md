feat-id: feishu-plugin-bundle-fs2
status: done
related: ./3-changelog.md

# 3-changelog · 飞书插件 "failed to load plugin (fs.existsSync undefined)" 修复

## 现象

macOS prod ship 验证(2026-05-27)启动 prod `DeskFox.app`,sidecar 日志出现 **4×**:

```
ERROR service=plugin path=.../plugin/feishu-bridge
  error=undefined is not an object (evaluating 'fs.existsSync') failed to load plugin
```

诡异点:feishu 桥接**功能其实全正常**(WSS 2/2 connected / server up / client ready /
event-dispatch ready / migrate 正常打 "both exist"),却同时 4× "failed to load plugin"。
上一发布版 `2026.5.25.1` 无此错(对比 bundle:旧 `fs2`/`fs` 悬空引用 0 处)→ 确认是回归。

## 根因(排查路径,有复用价值)

1. bundle 静态扫:`fs.existsSync` 报错,但调用点传的是有效对象字面量 `{ existsSync, ... }` —— 矛盾。
2. `bun run` 直接 import bundle **不复现**;只有 `bun build --compile` 出来的 opencode-cli sidecar 加载时复现 → 一度误判为 `--target=bun`/打包 target 问题(**red herring**,改 target=node 只是把 `fs2` 错名变 `fs`,没修)。
3. 给 opencode plugin loader(`packages/opencode/src/plugin/index.ts` applyPlugin catch)临时插 `console.error(err.stack)` + 重建 sidecar → 拿到真实堆栈:`at applyStaleSessionsCleanup (plugin.js)`。
4. 给插件 helper 插 `typeof fs` 日志 → **关键证据**:`applyStaleSessionsCleanup` 被调 5 次 —— 1 次来自 initBackground(fs=有效对象,前面有我的 DBG-CALL 日志),**4 次 fs=undefined 且前面无 DBG-CALL**(根本不经 initBackground 调用点)。
5. **真因**:`opencode plugin loader 的 getLegacyPlugins 遍历插件模块的所有 export(`Object.values(mod)`),把每个 export 当 plugin server 函数调 `fn(input, options)`**。plugin.ts 为单测 `export` 了 `migrateLegacyWorkspace` + `applyStaleSessionsCleanup` 两个裸 helper → 被以错误参数 `(input, options)` 调用 → 第 3 参 `fs` = undefined → `fs.existsSync` 抛。media-gen 插件不 export 裸 helper,故同款 sidecar 里加载干净。helper 是 `imbot-workspace-rename`(2026-05-25,在 `2026.5.25.1` 之后)新加 + 为 DI 测试 export 的 → 正好是回归引入点。

## 修复

把 `migrateLegacyWorkspace` + `applyStaleSessionsCleanup`(+ 其 `MigrateResult`/`CleanupResult` 类型 + 文档)
从插件入口 `plugin.ts` 挪到新模块 **`packages/adapter-feishu-lark/src/workspace-migrate.ts`**:

- `plugin.ts` 改为 `import { migrateLegacyWorkspace, applyStaleSessionsCleanup } from "./workspace-migrate"`(内部用,**不 re-export**)→ 插件入口的 export 面只剩 `default`/`server`/`FeishuBridgePlugin`(同一函数引用,getLegacyPlugins 去重后 = 1 个真插件)。
- 3 个引用方 import 路径改到 `workspace-migrate`:2 个单测 + `scripts/probe-cleanup-integration.ts`。
- `workspace-migrate.ts` 头注释写明**为什么必须放插件入口之外**(防后人再 export 回去)。

## 影响范围

- 新增:`packages/adapter-feishu-lark/src/workspace-migrate.ts`(移动来的 helper,逻辑 0 改)。
- 改:`plugin.ts`(删 helper 定义 + 加 import)、2 单测 + 1 probe 脚本(import 路径)。
- 新增守卫单测:`src/__tests__/plugin-exports.test.ts` —— 断言插件入口不 export 裸 helper(所有函数 export 是同一插件引用),防回归。

## 测试 / 回归

- 真机:prod `DeskFox.app` 重启,sidecar 日志 "failed to load plugin"/`fs.existsSync` **4 → 0**,feishu 干净加载(WSS 2/2 / server / migrate ran)+ media-gen `/healthz` ok。
- 飞书全单测 **622 pass / 0 fail**(migrate/cleanup 测试移到从 workspace-migrate import,逻辑不变)。
- 新守卫测 3 pass(修复前会 fail —— 那时 helper 还在 export 列表)。
- 全仓 typecheck 17/17。

## 回退

revert 本笔即把 helper 移回 plugin.ts(会复发本 bug,故仅紧急时用)。

## 备注 / 待办

⚠️ **Win prod `2026.5.27.1` 大概率同款问题**(feishu 插件源码/打包两端共用 `getLegacyPlugins` 是 opencode 通用行为)。本修复合 main 后,Win 端需重发一版盖掉 `2026.5.27.1`;Mac 端发版承接本修复(此前已 build 的 prod 包须用修复后的 plugin 重打)。
