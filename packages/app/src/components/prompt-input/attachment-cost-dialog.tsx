import { onCleanup, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"

export function useAttachmentCostDialog() {
  const dialog = useDialog()
  const language = useLanguage()
  return (bytes: number, convertible: boolean) =>
    new Promise<"send" | "reference" | "cancel">((resolve) => {
      const finish = (result: "send" | "reference" | "cancel") => {
        resolve(result)
        dialog.close()
      }
      void dialog.show(
        () => {
          onCleanup(() => resolve("cancel"))
          return (
            <Dialog title={language.t("attachment.cost.title")}>
              <div class="px-6 pb-6 flex flex-col gap-4" data-testid="attachment-cost-dialog">
                <p>{language.t("attachment.cost.description", { size: (bytes / 1024).toFixed(1) })}</p>
                <p>{language.t("attachment.cost.textRange")}</p>
                <div class="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={() => finish("cancel")}>
                    {language.t("common.cancel")}
                  </Button>
                  <Show when={convertible}>
                    <Button variant="secondary" onClick={() => finish("reference")}>
                      {language.t("attachment.cost.reference")}
                    </Button>
                  </Show>
                  <Button onClick={() => finish("send")}>{language.t("attachment.cost.send")}</Button>
                </div>
              </div>
            </Dialog>
          )
        },
        () => resolve("cancel"),
      )
    })
}
