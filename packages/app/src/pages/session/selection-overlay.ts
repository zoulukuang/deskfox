// [fork-only] 选区高亮 overlay 几何工具 —— 纯函数,供 file-tabs.tsx 的 setSelectionHighlight 用。
//   [feat: viewer-selection-tray-style] 2026-06-14
//
// 抽出原因:CSV grid 与 HTML iframe 两类格式的选区 overlay 需要几何变换,纯函数便于单测
// (file-tabs.tsx 是 SolidJS 组件,直接测困难)。

export type OverlayRect = { left: number; top: number; width: number; height: number }
export type Bounds = { left: number; top: number; right: number; bottom: number }

/**
 * 把高亮矩形裁剪到容器边界内(取交集)。
 * CSV 是 CSS grid:跨行选区 range.getClientRects() 会横跨整行、横向滚动时还会超出可视区,
 * 而 overlay 是 viewport-fixed 定位 → 不裁剪会溢出到左侧文件树 / 下方聊天区(user 报 Image#34/#35)。
 * 裁到 CSV 容器矩形即可只在表格可视区内画高亮。完全在界外的矩形被丢弃。
 */
export function clampRectsToBounds(rects: OverlayRect[], bounds: Bounds): OverlayRect[] {
  const out: OverlayRect[] = []
  for (const r of rects) {
    const left = Math.max(r.left, bounds.left)
    const top = Math.max(r.top, bounds.top)
    const right = Math.min(r.left + r.width, bounds.right)
    const bottom = Math.min(r.top + r.height, bounds.bottom)
    if (right > left && bottom > top) out.push({ left, top, width: right - left, height: bottom - top })
  }
  return out
}

/**
 * iframe 内选区矩形(相对 iframe 自身 viewport,来自 iframe.contentWindow 的 getClientRects)
 * → 父文档 viewport 坐标(加上 iframe 在父文档里的左上偏移)。
 * 供 HTML 预览右键时把 iframe 内选区投影成父文档的 overlay 蓝 —— 治"iframe 失焦后原生选区变灰"。
 */
export function projectIframeRects(rects: OverlayRect[], iframeOffset: { left: number; top: number }): OverlayRect[] {
  return rects.map((r) => ({
    left: r.left + iframeOffset.left,
    top: r.top + iframeOffset.top,
    width: r.width,
    height: r.height,
  }))
}
