// FORK: REQ-086 绑定时 workspace 默认注入判定(纯逻辑,Logic 清单)
// [feat: feishu-session-project-visibility] 2026-08-02
//
// 绑定新账号 OAuth 成功后,决定是否把账号 workspace 默认为当前打开的项目目录:
//   - 账号已有 workspace(重绑)→ null(不覆盖用户已有设置)
//   - 当前无打开项目(home / 空白路径)→ null(回退全局默认 imbot-workspace)
//   - 其余 → trim 后的当前项目目录(注入)

export function defaultWorkspaceForBind(
  currentDir: string | null | undefined,
  existingWorkspace: string | null | undefined,
): string | null {
  if ((existingWorkspace ?? "").trim()) return null
  const dir = (currentDir ?? "").trim()
  return dir ? dir : null
}
