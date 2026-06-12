// [fork-only] 选区菜单视口边界保护 — 共享定位 helper
// [feat: req-032-menu-clamp-viewport] 2026-05-28
//
// 两个手写的"选区加聊天"菜单(file-tabs.tsx mdMenu + context-menu-host/host.tsx ContextMenuHost)
// 都按 raw clientX/Y + fixed 定位、绕开 Kobalte 的视口保护。贴边沿时按钮溢出视口看不到点不到。
// 本 helper 给这两处提供统一的 clamp 逻辑,按真实 getBoundingClientRect 测出来的菜单宽高
// 把菜单收回视口内 —— 四边沿统一覆盖。
//
// 调用时机:菜单**渲染后**用 `requestAnimationFrame` / `onMount` 拿 element ref,
// 调 element.getBoundingClientRect() 测真实宽高(input 态 360px 宽 + textarea 多行高,
// menu 态 180-220px 宽,差异大不能用常量),再调本 helper 算最终 left/top。
// 防闪:初帧给 `visibility: hidden` 或屏外定位,测完再可见。

export interface ClampInput {
  /** raw 点击坐标(通常来自 event.clientX/Y)*/
  x: number
  y: number
  /** 菜单真实宽高(getBoundingClientRect()).不能用常量 */
  width: number
  height: number
  /** 视口尺寸 */
  viewportWidth: number
  viewportHeight: number
  /** 离窗口边的最小留白,默认 8px */
  margin?: number
}

export interface ClampResult {
  left: number
  top: number
}

/**
 * 按真实菜单宽高把 (x, y) 收进视口。
 *
 * 策略:
 * - **水平**:`x + width > vw - margin` → 向左收(`left = vw - width - margin`),
 *   但保证 `left ≥ margin`(防左边沿溢出)。flip-equivalent for one-sided right-edge case.
 * - **垂直**:`y + height > vh - margin` → flip 到锚点上方(`top = y - height`);
 *   若 flip 后 `top < margin`(锚点离顶太近),fallback 到 `top = margin`,clamp 优先于完美 flip。
 * - **最小留白** `margin`:菜单离视口边至少 8px(默认),避免顶到玻璃边贴脸感。
 *
 * 极端情况(菜单大于视口):优先保证 left/top ≥ margin,溢出的部分用户可通过缩放/调小字号自救。
 */
export function clampMenuToViewport(input: ClampInput): ClampResult {
  const { x, y, width, height, viewportWidth: vw, viewportHeight: vh } = input
  const margin = input.margin ?? 8

  // 水平:右溢出 → 向左收,再保证不破左边沿
  let left = x
  if (left + width > vw - margin) {
    left = vw - width - margin
  }
  if (left < margin) {
    left = margin
  }

  // 垂直:下溢出 → flip 到锚点上方
  let top = y
  if (top + height > vh - margin) {
    const flipped = y - height
    top = flipped >= margin ? flipped : margin
  }
  if (top < margin) {
    top = margin
  }

  return { left, top }
}

/**
 * 给已挂载的菜单 DOM 元素按 raw 坐标重定位 + 设可见。
 * 调用时机:在 SolidJS `createEffect` + `queueMicrotask` 里调,确保 DOM 已渲染含真实尺寸。
 * 防闪:JSX 上元素初始 `visibility: "hidden"`,本函数测完真实 rect 后置 `visible`。
 */
export function repositionMenu(el: HTMLElement, x: number, y: number, margin?: number): void {
  const rect = el.getBoundingClientRect()
  const { left, top } = clampMenuToViewport({
    x,
    y,
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    margin,
  })
  el.style.left = `${left}px`
  el.style.top = `${top}px`
  el.style.visibility = "visible"
}
