// FORK: Ctrl+C v2 scope helpers — 解 file-tabs.tsx capture-phase Ctrl+C 跨区域选区污染。
// 抽出 pure 函数 → 三场景(viewer 内重选短覆盖长 / 跨区域污染 / 取消选区幽灵复制)单测覆盖。
// 起源:OPENCODE-PLAN/需求池/ctrl-c-复制失效.md v2(2026-05-21 诊断,2026-05-29 R1+R2 落地)。

/**
 * 判定 selection 的 anchor 是否落在指定 viewer 容器内。
 * - light DOM:`anchorNode.parentElement.contains()` 直接判
 * - Shadow DOM:`anchorNode.getRootNode()` 拿到 ShadowRoot,climb 出 `host` 再判(window.getSelection
 *   对 shadow 选区的 anchorNode 行为依平台而异,统一靠 getRootNode 兜底)
 *
 * 同一 viewerRoot 应是**实例 scope**(本 FileTabContent 的 Tabs.Content 节点),
 * 而非全局 selector — 避免跨 tab 互相污染。
 */
export function isAnchorInsideViewer(
  anchorNode: Node | null | undefined,
  viewerRoot: HTMLElement | null | undefined,
): boolean {
  if (!anchorNode || !viewerRoot) return false
  let node: Node | null = anchorNode
  const root = anchorNode.getRootNode()
  if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) {
    node = root.host
  }
  const el = node instanceof Element ? node : (node?.parentElement ?? null)
  if (!el) return false
  return viewerRoot.contains(el)
}

/**
 * Ctrl+C 拦截决策。
 *
 * - **noop**:无选区 / 选区在 viewer 外 — handler 直接 return,让原生 Ctrl+C 自处理
 *   (chat 区原生工作;真无选区时原生也 no-op)。**这一档解场景 B/C**。
 * - **native**:viewer 内 + light DOM — 让原生 Ctrl+C 直接拷当前选区。比 history 路径更可靠,
 *   不必 preventDefault。**这一档解场景 A 的 light DOM 半边**。
 * - **shadow-intercept**:viewer 内 + Shadow DOM — 原生 `document.execCommand("copy")` /
 *   `clipboardData` 拿不到 shadow 内容(`window.getSelection().toString()` 对 shadow 返回 ""),
 *   必须 handler 自己 preventDefault + `navigator.clipboard.writeText(text)`。
 *   text 直接用 `readSelectionText` 拿到的**当前**选区,**不走 history** —
 *   keydown 没有 right-click 的 selection-collapse bug,history 兜底对 Ctrl+C 是错配。
 *   **这一档解场景 A 的 shadow DOM 半边**。
 *
 * Why 不沿用 spec 里"shadow → fall back to pickBest history"思路:
 * pickBestRecentSelection 挑 "30s 内最长" 是为对抗右键 collapse 设计的,kbd Ctrl+C 没这个问题,
 * 用 history 反而引入"重选短覆盖长"和"幽灵复制"两个 bug。直接用当前 readSelectionText 结果即可。
 *
 * history 机制本身保留(file-tabs.tsx `selectionHistory` + `pickBestRecentSelection`)给
 * 右键 `handleSelectionContextMenu` 用,不动。
 */
export type CtrlCDecision =
  | { action: "noop" }
  | { action: "native" }
  | { action: "shadow-intercept"; text: string }

export function decideCtrlCAction(input: {
  /** readSelectionText 返回的文本(shadow-aware,空串 = 当前真无选区) */
  text: string
  /** readSelectionText 返回的 shadow root;null = light DOM 选区 */
  shadow: ShadowRoot | null
  /** window.getSelection() 的 anchorNode(scope 判定用) */
  anchorNode: Node | null | undefined
  /** 当前 FileTabContent 实例的 viewer 根容器 */
  viewerRoot: HTMLElement | null | undefined
}): CtrlCDecision {
  // 场景 C 解:无选区(或全空白)→ 不拦,原生 no-op
  if (!input.text.trim()) return { action: "noop" }

  // 场景 B 解 + scope 缩窄:anchor 不在本 viewer → 不拦
  // (chat 区 / 其他 tab / 全局任意位置选的文字都走原生)
  if (!isAnchorInsideViewer(input.anchorNode, input.viewerRoot)) return { action: "noop" }

  // 场景 A 解:viewer 内
  if (input.shadow) {
    // shadow DOM — handler 自己写剪贴板
    return { action: "shadow-intercept", text: input.text }
  }
  // light DOM — 让原生 Ctrl+C 走
  return { action: "native" }
}
