// FORK-ONLY file: REQ-096 会话行右键菜单(重命名/分享/归档/删除)+ 目录感知删除确认
// [feat: session-list-ux]
// 模式先例:sidebar-project.tsx 的 Kobalte ContextMenu(应用层菜单,i18n 跟随);
// 接管后 Electron 原生 "Copy Link" 英文菜单在会话行不再出现。
// 动作集与会话头部 ⋯ 菜单对齐(文案 key 复用),但语义按侧栏场景落地:
// - 重命名 → 行内 inline 编辑(由 sidebar-items.tsx 提供 onRename)
// - 分享 → share + 复制链接 + toast(完整分享管理仍在头部 popover)
// - 归档 → 复用 layout 的 archiveSession(带撤销 toast)
// - 删除 → 目录感知确认框(头部 DialogDeleteSession 绑当前路由 sdk,跨目录行不可复用)

import type { Session } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Binary } from "@opencode-ai/core/util/binary"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useNavigate, useParams } from "@solidjs/router"
import { createMemo, Show, type JSX } from "solid-js"
import { produce } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { sessionTitle } from "@/utils/session-title"
import { showToast } from "@/utils/toast"

async function copyText(value: string): Promise<boolean> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (clipboard?.writeText) {
    const ok = await clipboard.writeText(value).then(
      () => true,
      () => false,
    )
    if (ok) return true
  }
  if (typeof document === "undefined") return false
  const body = document.body
  if (!body) return false
  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  body.removeChild(textarea)
  return copied
}

function DialogDeleteSessionRow(props: { session: Session }) {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const navigate = useNavigate()
  const params = useParams()

  const name = createMemo(() => sessionTitle(props.session.title) ?? language.t("command.session.new"))

  const handleDelete = async () => {
    const session = props.session
    const result = await serverSDK().client.session
      .delete({ directory: session.directory, sessionID: session.id })
      .then((x) => x.data)
      .catch(() => {
        showToast({
          title: language.t("session.delete.failed.title"),
          variant: "error",
        })
        return false
      })
    if (!result) {
      dialog.close()
      return
    }

    const [store, setStore] = serverSync().child(session.directory)
    // 连带子会话一起从本地 store 清掉(服务端级联删除)
    const removed = new Set<string>([session.id])
    let grew = true
    while (grew) {
      grew = false
      for (const item of store.session ?? []) {
        if (!item.parentID || removed.has(item.id) || !removed.has(item.parentID)) continue
        removed.add(item.id)
        grew = true
      }
    }
    const sessions = store.session ?? []
    const index = sessions.findIndex((s) => s.id === session.id)
    const nextSession = sessions[index + 1] ?? sessions[index - 1]
    setStore(
      produce((draft) => {
        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )
    if (removed.has(params.id ?? "") && params.dir === base64Encode(session.directory)) {
      if (nextSession && !removed.has(nextSession.id)) navigate(`/${params.dir}/session/${nextSession.id}`)
      else navigate(`/${params.dir}/session`)
    }
    dialog.close()
  }

  return (
    <Dialog title={language.t("session.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("session.delete.confirm", { name: name() })}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={handleDelete}>
            {language.t("session.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function SessionRowMenu(props: {
  session: Session
  onRename: () => void
  archiveSession: (session: Session) => Promise<void>
  children: JSX.Element
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const [store] = serverSync().child(props.session.directory, { bootstrap: false })
  const shareEnabled = createMemo(() => store.config?.share !== "disabled")

  const share = async () => {
    const session = props.session
    const existing = (store.session ?? []).find((s) => s.id === session.id)?.share?.url
    const url =
      existing ??
      (await serverSDK().client.session
        .share({ directory: session.directory, sessionID: session.id })
        .then((res) => res.data?.share?.url)
        .catch(() => undefined))
    if (!url) {
      showToast({
        title: language.t("toast.session.share.failed.title"),
        description: language.t("toast.session.share.failed.description"),
        variant: "error",
      })
      return
    }
    // 同步共享状态回 store(share.url 供下次直接复制)
    const [, setStore] = serverSync().child(session.directory)
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, session.id, (s) => s.id)
        if (match.found) draft.session[match.index].share = { url }
      }),
    )
    if (!(await copyText(url))) {
      showToast({ title: language.t("toast.session.share.copyFailed.title"), variant: "error" })
      return
    }
    showToast({
      title: existing ? language.t("session.share.copy.copied") : language.t("toast.session.share.success.title"),
      description: language.t("toast.session.share.success.description"),
      variant: "success",
    })
  }

  const copyLink = async () => {
    const url = new URL(
      `/${base64Encode(props.session.directory)}/session/${props.session.id}`,
      location.href,
    ).toString()
    if (!(await copyText(url))) {
      showToast({ title: language.t("toast.session.share.copyFailed.title"), variant: "error" })
      return
    }
    showToast({ title: language.t("session.share.copy.copied"), variant: "success" })
  }

  return (
    <ContextMenu modal={false}>
      <ContextMenu.Trigger as="div" class="contents" data-session-menu={props.session.id}>
        {props.children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <ContextMenu.Item data-action="session-rename" onSelect={() => props.onRename()}>
            <ContextMenu.ItemLabel>{language.t("common.rename")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <Show when={shareEnabled()}>
            <ContextMenu.Item data-action="session-share" onSelect={() => void share()}>
              <ContextMenu.ItemLabel>{language.t("session.share.action.share")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </Show>
          {/* 复制会话内部链接(oc://renderer/<b64dir>/session/<id>,与原 Electron 原生菜单 Copy Link
              同格式;dump-session 等工作流以此引用会话)— user 2026-08-07 要求补回 */}
          <ContextMenu.Item data-action="session-copy-link" onSelect={() => void copyLink()}>
            <ContextMenu.ItemLabel>{language.t("session.share.copy.copyLink")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Item data-action="session-archive" onSelect={() => void props.archiveSession(props.session)}>
            <ContextMenu.ItemLabel>{language.t("common.archive")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            data-action="session-delete"
            onSelect={() => dialog.show(() => <DialogDeleteSessionRow session={props.session} />)}
          >
            <ContextMenu.ItemLabel>{language.t("common.delete")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}
