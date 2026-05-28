// [fork-only] 启动期 sidebar 项目 tile ready gate — 纯逻辑 helper
// [feat: startup-sidebar-ready-gate] 2026-05-29
//
// 抽成纯函数便于单测(R5 v3.1 Logic 清单模式)。
// 起源:cold start sidecar/bootstrap 未就绪期间,project tile click 会触发 globalSDK.client.session.list 等
// HTTP,await 全卡 + .catch 兜底吞错 → user 视角"点了没反应"。这里给"视觉信号 + 功能拦截"两个原子函数。

/**
 * 计算 project tile 在启动期是否该被 gate(视觉变灰 + 鼠标 wait + 不响应 click)。
 *
 * 规则:
 *   - bootReady=true → 永远不 gate(正常态)
 *   - bootReady=false 且 selected → 不 gate(已选 tile 的 toggle sidebar 是纯前端 0 HTTP,允许)
 *   - bootReady=false 且 !selected → gate(切项目要走 HTTP,sidecar 没起就拦)
 */
export function shouldGateProjectTile(bootReady: boolean, selected: boolean): boolean {
  if (bootReady) return false
  return !selected
}

/**
 * 计算 project tile click 时是否该跳过 navigateToProject(功能拦截)。
 *
 * 跟视觉 gate 同一规则,但抽出独立函数表达"功能 vs 视觉"两个意图,callsite 可以选择性地用任一。
 */
export function shouldSkipProjectNavigate(bootReady: boolean, selected: boolean): boolean {
  return shouldGateProjectTile(bootReady, selected)
}
