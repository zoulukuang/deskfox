// FORK: 从 file-tree.tsx 抽出的纯逻辑 helper(文件树 fetch 纪律判定)[feat: test-isolation-file-tree] 2026-06-14
//
// 起因:file-tree.test.ts 只测这 3 个纯函数,却要 `import("./file-tree")` 整个组件 → 连带加载
// @opencode-ai/ui/context-menu → @kobalte/core,而 bun test 下 solid-js/web 解析到 server 构建
// (isServer=true),@kobalte 顶层调 client-only API 直接抛 "Client-only API called on the server side"。
// 该失败随测试顺序/mock.module 全局泄漏游走(谁先 mock 掉相关模块谁就侥幸放行)。
// 按 fork R5「helper extract」模式:纯 Logic 函数抽到独立文件,测试直接 import 本文件,
// 不再加载任何组件/@kobalte,确定性通过且不污染全局 mock 状态。file-tree.tsx 内部改为从此处 import。

export function shouldListRoot(input: { level: number; dir?: { loaded?: boolean; loading?: boolean } }) {
  if (input.level !== 0) return false
  if (input.dir?.loaded) return false
  if (input.dir?.loading) return false
  return true
}

export function shouldListExpanded(input: {
  level: number
  dir?: { expanded?: boolean; loaded?: boolean; loading?: boolean }
}) {
  if (input.level === 0) return false
  if (!input.dir?.expanded) return false
  if (input.dir.loaded) return false
  if (input.dir.loading) return false
  return true
}

export function dirsToExpand(input: {
  level: number
  filter?: { dirs: Set<string> }
  expanded: (dir: string) => boolean
}) {
  if (input.level !== 0) return []
  if (!input.filter) return []
  return [...input.filter.dirs].filter((dir) => !input.expanded(dir))
}
