import { createEffect } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { createAttachmentCostMonitor } from "./attachment-cost-monitor"

export function useAttachmentCostMonitor(ready: () => boolean) {
  const sync = useSync()
  const sdk = useSDK()
  const params = useParams()
  const command = useCommand()
  const language = useLanguage()
  const observe = createAttachmentCostMonitor()
  createEffect(() => {
    const id = params.id
    if (!id || !ready()) return
    const scope = sdk().scope
    const warning = observe({
      key: JSON.stringify([scope, id]),
      messages: sync().data.message[id] ?? [],
      idle: (sync().data.session_status[id]?.type ?? "idle") === "idle",
      reset: sync().session.get(id)?.revert?.messageID,
    })
    if (!warning) return
    const act = (name: string) => {
      if (params.id === id && sdk().scope === scope) command.trigger(name)
    }
    showToast({
      title: language.t("attachment.cost.jumpTitle"),
      description: language.t("attachment.cost.jumpDescription", {
        previous: warning.previous.toLocaleString(language.intl()),
        current: warning.current.toLocaleString(language.intl()),
      }),
      actions: [
        { label: language.t("command.session.new"), onClick: () => act("session.new") },
        { label: language.t("command.session.compact"), onClick: () => act("session.compact") },
      ],
    })
  })
}
