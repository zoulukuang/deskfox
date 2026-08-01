// FORK-ONLY: REQ-049 L3 sidecar 健康事件 → 用户提示(纯逻辑) [feat: sidecar-oom-brake] 2026-08-02
//
// 主进程看门狗/内存刹车经 "deskfox:sidecar-watchdog" 通道广播;此前 renderer 无消费方,
// sidecar 崩溃-重启期间用户只看到零散请求失败,不知道发生了什么。这里把事件收敛成
// 可测试的 toast 决策(组件侧 sidecar-health-monitor.tsx 只做订阅+展示)。

export type SidecarWatchdogPayload = {
  status: "restarting" | "ready" | "gave-up" | "memory-pressure"
  usedMB?: number
  limitMB?: number
  ratio?: number
}

export type SidecarHealthToast = {
  variant: "default" | "success" | "error"
  title: string
  description?: string
}

export type SidecarHealthState = { restarting: boolean }

export const INITIAL_SIDECAR_HEALTH_STATE: SidecarHealthState = { restarting: false }

/** 收一条看门狗事件,返回新状态 + 要弹的 toast(无需弹则 undefined)。 */
export function reduceSidecarHealth(
  state: SidecarHealthState,
  payload: SidecarWatchdogPayload,
): { state: SidecarHealthState; toast?: SidecarHealthToast } {
  switch (payload.status) {
    case "restarting":
      return {
        state: { restarting: true },
        toast: {
          variant: "error",
          title: "AI 后台服务已断开,正在自动重启…",
          description: "期间的对话与文件请求会短暂失败,恢复后自动继续,无需重开应用。",
        },
      }
    case "ready":
      // 只在经历过 restarting 后报「已恢复」,避免正常启动误弹
      if (!state.restarting) return { state }
      return {
        state: { restarting: false },
        toast: { variant: "success", title: "AI 后台服务已恢复" },
      }
    case "gave-up":
      return {
        state: { restarting: false },
        toast: {
          variant: "error",
          title: "AI 后台服务多次重启失败",
          description: "请保存工作后重启 DeskFox;若反复出现请导出日志反馈。",
        },
      }
    case "memory-pressure": {
      const detail =
        payload.usedMB !== undefined && payload.limitMB !== undefined
          ? `(${payload.usedMB}MB / ${payload.limitMB}MB)`
          : ""
      return {
        state,
        toast: {
          variant: "default",
          title: `AI 后台内存吃紧${detail}`,
          description: "建议把大批量任务拆小执行;接近上限时后台可能自动重启,进行中的任务会中断。",
        },
      }
    }
    default:
      return { state }
  }
}
