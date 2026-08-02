// FORK-ONLY: imbot 安全 agent spec + 注入/升级纯逻辑 [feat: imbot-agent-schema-upgrade] 2026-08-02
//
// 从 plugin-install.ts 抽出(无 electron 依赖,可单测)。REQ-094:原「已有 agent.imbot
// 完全跳过」导致发版带新 spec 时存量用户永不升级;改按 `_schemaVersion` 三分支升级,
// 字段级 merge 保留用户自增键。
//
// merge 字段表(2026-08-02 二次复核钉死):
//   - spec 管理键 `_schemaVersion` / `description` / `permission` → 升级时覆盖
//     (安全语义收敛;用户直改 permission 会被覆盖一次,doc 既定接受,自定义请另起 agent 名)
//   - 其余一切键(model / prompt / tools / 任何用户自增)→ 原样保留

/** spec 版本 — 改动 imbotAgentSpec 内容时必须 +1(对应档位:3 = v3 极简档) */
export const IMBOT_SCHEMA_VERSION = 3

/** 升级时覆盖的 spec 管理键;其余键保留用户现值 */
export const IMBOT_MANAGED_KEYS = ["_schemaVersion", "description", "permission"] as const

/** imbot 安全 agent v3 极简档(权限内容与 Tauri imbot_agent_spec 逐键一致) */
export function imbotAgentSpec(): Record<string, unknown> {
  return {
    _schemaVersion: IMBOT_SCHEMA_VERSION,
    description:
      "DeskFox IM 桥接 v3 极简档 — 只对 SSH 凭证 read + 真不可逆破坏 bash(rm -rf / Remove-Item / git --force / 云资源销毁 / 磁盘级)做 ask",
    permission: {
      read: { "*": "allow", "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow", "**/.ssh/**": "ask" },
      bash: {
        "*": "allow",
        "rm -rf *": "ask",
        "Remove-Item *": "ask",
        "rmdir *": "ask",
        "del *": "ask",
        "rd *": "ask",
        "git push --force*": "ask",
        "git push -f *": "ask",
        "aws s3 rb *": "ask",
        "aws ec2 terminate*": "ask",
        "dd *": "ask",
        "mkfs*": "ask",
        "fdisk *": "ask",
        "shutdown *": "ask",
      },
    },
  }
}

/**
 * 注入 / 升级 agent.imbot:
 *   - 无 imbot → 整体注入
 *   - `_schemaVersion` 缺失或 < 当前 → 覆盖管理键,保留其余用户键
 *   - ≥ 当前 → 不动(同版本零写盘;高版本 = 降级安装,不回退用户 config)
 *   - 形状异常(非 plain object)→ 不动(防覆盖丢 user 数据),caller 记日志
 * @returns config 是否被改动
 */
export function injectImbotAgent(config: Record<string, unknown>): boolean {
  const agent = (config.agent ??= {}) as Record<string, unknown>
  if (typeof agent !== "object" || agent === null) return false
  const existing = agent.imbot
  if (existing === undefined) {
    agent.imbot = imbotAgentSpec()
    return true
  }
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) return false
  const current = existing as Record<string, unknown>
  const version = typeof current._schemaVersion === "number" ? current._schemaVersion : 0
  if (version >= IMBOT_SCHEMA_VERSION) return false
  const spec = imbotAgentSpec()
  for (const key of IMBOT_MANAGED_KEYS) {
    current[key] = spec[key]
  }
  return true
}
