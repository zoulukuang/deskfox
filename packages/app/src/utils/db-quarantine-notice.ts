// FORK-ONLY: REQ-084① 数据库隔离提示(纯逻辑)[feat: voice-preclear-batch] 2026-08-18
//
// 主进程在启动最早期检测到「db 的 schema 比本内核超前」(通常是同机另装的上游 opencode 把共享库
// 迁到了更新的版本),会把库隔离挪开让应用能正常起来。用户视角必须解释清楚两件事:
//   ① 为什么历史会话不见了;② 数据没被删,在哪能找回。
// 决策逻辑放这里(可单测);组件 db-quarantine-monitor.tsx 只做取数 + 弹 toast。

export interface DbQuarantineNotice {
  /** migrate = 迁移期未迁入(原件留在旧目录);startup = 启动期已挪开(原地改名保留)。 */
  kind: "migrate" | "startup"
  dbNames: string[]
  dir?: string
}

export interface QuarantineToast {
  variant: "default" | "success" | "error"
  title: string
  description?: string
  /**
   * 常驻不自动消失。这条通知**一辈子只弹一次**(主进程取走即清),内容里还带着用户需要
   * 复制的恢复路径 —— 走默认 5 秒自动消失等于「去倒杯水回来就再也找不到数据在哪」。
   * 2026-08-19 发版前 review 抓出。
   */
  persistent?: boolean
}

/**
 * 把主进程通知转成 toast 文案。无通知 / 空清单 → undefined(不弹)。
 * 文案原则:不吓人、不甩术语,直说「发生了什么 + 数据还在哪 + 现在能正常用」。
 */
export function toQuarantineToast(notice: DbQuarantineNotice | null | undefined): QuarantineToast | undefined {
  if (!notice || notice.dbNames.length === 0) return undefined
  const where = notice.dir ? `原文件保留在:${notice.dir}` : "原文件已保留,未删除。"
  if (notice.kind === "startup") {
    return {
      variant: "default",
      persistent: true,
      title: "历史数据与当前版本不兼容,已另存备份",
      description:
        `检测到本机数据库来自更新版本的 OpenCode/DeskFox,当前版本打不开它。` +
        `为保证应用能正常启动,已将其改名备份并以空数据库启动 —— 历史会话暂时看不到,但文件没有被删除。${where}`,
    }
  }
  return {
    variant: "default",
    persistent: true,
    title: "部分历史数据未迁入(与当前版本不兼容)",
    description:
      `迁移到 DeskFox 专属目录时,发现原数据库来自更新版本、当前版本无法打开,因此未迁移它;` +
      `账号与配置已正常迁入。原文件完整保留在旧目录,升级到更新版本后可手动取回。${where}`,
  }
}
