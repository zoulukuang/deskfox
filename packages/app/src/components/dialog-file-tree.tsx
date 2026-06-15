import { createSignal, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"

// FORK: #6 同名冲突解决 — 替换 / 保留两者 / 跳过(+ 应用到后续全部)[feat: file-tree-ux-polish-p2] 2026-06-13
export type ConflictAction = "replace" | "keepBoth" | "skip"

export function DialogFileTreeConflict(props: {
  name: string
  onResolve: (action: ConflictAction, applyToAll: boolean) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [applyToAll, setApplyToAll] = createSignal(false)
  const pick = (action: ConflictAction) => {
    props.onResolve(action, applyToAll())
    dialog.close()
  }
  return (
    <Dialog title={language.t("fileTree.conflict.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[400px]">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("fileTree.conflict.message", { name: props.name })}
          </span>
          <span class="text-12-regular text-text-weak">{language.t("fileTree.conflict.detail")}</span>
        </div>
        <Checkbox checked={applyToAll()} onChange={setApplyToAll}>
          {language.t("fileTree.conflict.applyToAll")}
        </Checkbox>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => pick("skip")}>
            {language.t("fileTree.conflict.skip")}
          </Button>
          <Button variant="secondary" size="large" onClick={() => pick("keepBoth")}>
            {language.t("fileTree.conflict.keepBoth")}
          </Button>
          <Button variant="primary" size="large" onClick={() => pick("replace")}>
            {language.t("fileTree.conflict.replace")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

type PromptProps = {
  title: string
  label: string
  defaultValue?: string
  placeholder?: string
  confirmLabel: string
  validate?: (value: string) => string | undefined
  onConfirm: (value: string) => Promise<void>
}

export function DialogFileTreePrompt(props: PromptProps) {
  const dialog = useDialog()
  const language = useLanguage()
  const [value, setValue] = createSignal(props.defaultValue ?? "")
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()

  const submit = async () => {
    if (submitting()) return
    const trimmed = value().trim()
    if (!trimmed) {
      setError(language.t("fileTree.dialog.validation.empty"))
      return
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setError(language.t("fileTree.dialog.validation.invalidChar"))
      return
    }
    const validationError = props.validate?.(trimmed)
    if (validationError) {
      setError(validationError)
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      await props.onConfirm(trimmed)
      dialog.close()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message.startsWith("already_exists:")) {
        setError(language.t("fileTree.dialog.validation.duplicate"))
      } else {
        showToast({ variant: "error", title: language.t("fileTree.toast.operationFailed"), description: message })
        setError(message)
      }
      setSubmitting(false)
    }
  }

  return (
    <Dialog title={props.title} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[360px]">
        <TextField
          autofocus
          label={props.label}
          value={value()}
          placeholder={props.placeholder}
          onChange={(v) => {
            setValue(v)
            if (error()) setError(undefined)
          }}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void submit()
            }
          }}
          error={error()}
          validationState={error() ? "invalid" : undefined}
        />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()} disabled={submitting()}>
            {language.t("fileTree.dialog.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={() => void submit()} disabled={submitting()}>
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

type ConfirmProps = {
  title: string
  message: string
  detail?: string
  confirmLabel: string
  onConfirm: () => Promise<void>
}

export function DialogFileTreeConfirm(props: ConfirmProps) {
  const dialog = useDialog()
  const language = useLanguage()
  const [submitting, setSubmitting] = createSignal(false)

  const submit = async () => {
    if (submitting()) return
    setSubmitting(true)
    try {
      await props.onConfirm()
      dialog.close()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      showToast({ variant: "error", title: language.t("fileTree.toast.operationFailed"), description: message })
      setSubmitting(false)
    }
  }

  return (
    <Dialog title={props.title} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[360px]">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">{props.message}</span>
          <Show when={props.detail}>
            <span class="text-12-regular text-text-weak">{props.detail}</span>
          </Show>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()} disabled={submitting()}>
            {language.t("fileTree.dialog.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={() => void submit()} disabled={submitting()}>
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
