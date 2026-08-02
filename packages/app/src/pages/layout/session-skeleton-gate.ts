// FORK: REQ-092 sidebar SessionSkeleton 门条件(纯逻辑,Logic 清单)
// [feat: startup-sidebar-feedback] 2026-08-02
//
// 原门条件 `fetching > 0 && count === 0` 在冷启动 bootstrap 未发起查询时不亮 →
// 启动期 sidebar 空白无反馈。补 ready 维度:未 ready 且无会话也亮 skeleton。

export function showSessionSkeleton(fetching: number, count: number, ready: boolean): boolean {
  if (count > 0) return false
  return fetching > 0 || !ready
}
