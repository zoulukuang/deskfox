// FORK-ONLY: REQ-049 L3 sidecar 断连/内存压力提示(订阅 + 展示壳) [feat: sidecar-oom-brake] 2026-08-02
// 决策逻辑在 @/utils/sidecar-health(纯函数可单测);本组件只负责订阅原生桥事件与弹 toast。
import { onCleanup, onMount } from "solid-js"
import { isDesktopApp, listen } from "@/utils/native"
import { showToast } from "@/utils/toast"
import {
  INITIAL_SIDECAR_HEALTH_STATE,
  reduceSidecarHealth,
  type SidecarWatchdogPayload,
} from "@/utils/sidecar-health"

export function SidecarHealthMonitor() {
  onMount(() => {
    if (!isDesktopApp()) return
    let state = INITIAL_SIDECAR_HEALTH_STATE
    let unlisten: (() => void) | undefined
    void listen<SidecarWatchdogPayload>("sidecar-watchdog", (event) => {
      const result = reduceSidecarHealth(state, event.payload)
      state = result.state
      if (result.toast) showToast(result.toast)
    }).then((u) => (unlisten = u))
    onCleanup(() => unlisten?.())
  })
  return null
}
