// FORK-ONLY: REQ-084① 数据库隔离提示(取数 + 展示壳)[feat: voice-preclear-batch] 2026-08-18
// 决策逻辑在 @/utils/db-quarantine-notice(纯函数可单测);本组件只负责取一次性通知并弹 toast。
import { onMount } from "solid-js"
import { invoke, isDesktopApp } from "@/utils/native"
import { showToast } from "@/utils/toast"
import { toQuarantineToast, type DbQuarantineNotice } from "@/utils/db-quarantine-notice"

export function DbQuarantineMonitor() {
  onMount(() => {
    if (!isDesktopApp()) return
    // 一次性:主进程取走即清,重启后若问题已解决自然不再有。
    void invoke<DbQuarantineNotice | null>("get_db_quarantine_notice")
      .then((notice) => {
        const toast = toQuarantineToast(notice)
        if (toast) showToast(toast)
      })
      .catch(() => {
        // 取不到就算了 —— 提示是锦上添花,绝不能因它报错影响启动。
      })
  })
  return null
}
