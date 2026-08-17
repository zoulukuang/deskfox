import type { Session } from "@opencode-ai/sdk/v2/client"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Icon } from "@opencode-ai/ui/icon"
// FORK: REQ-096 — 行内重命名输入框 + 归档 hover 图标移除(IconButton 不再使用)[feat: session-list-ux]
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/core/util/path"
import { Binary } from "@opencode-ai/core/util/binary"
import { A, useParams } from "@solidjs/router"
import { type Accessor, createMemo, createSignal, For, type JSX, Match, Show, Switch } from "solid-js"
import { produce } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
// FORK: REQ-096 — 会话行右键菜单 [feat: session-list-ux]
import { SessionRowMenu } from "./session-row-menu"
import { showToast } from "@/utils/toast"
// FORK: 新建会话清空首页创作 draft [feat: media-creation-mode]
import { creation } from "@/components/media-creation-store"
import { useLanguage } from "@/context/language"
import { getAvatarColors, type LocalProject, useLayout } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { messageAgentColor } from "@/utils/agent"
import { sessionTitle } from "@/utils/session-title"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import { childSessionOnPath, getProjectAvatarSource, hasProjectPermissions } from "./helpers"
// FORK: stuck-working-indicator-fix [feat: stuck-working-indicator-fix] 2026-06-06
import { deriveSessionWorking } from "./session-working"

export const ProjectIcon = (props: {
  project: LocalProject
  class?: string
  notify?: boolean
  working?: boolean
}): JSX.Element => {
  const serverSync = useServerSync()
  const notification = useNotification()
  const permission = usePermission()
  const dirs = createMemo(() => [props.project.worktree, ...(props.project.sandboxes ?? [])])
  const unseenCount = createMemo(() =>
    dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const hasError = createMemo(() => dirs().some((directory) => notification.project.unseenHasError(directory)))
  const hasPermissions = createMemo(() =>
    dirs().some((directory) => {
      return hasProjectPermissions(serverSync().session.data.permission, (item) => {
        if (serverSync().session.get(item.sessionID)?.directory !== directory) return false
        // FORK: REQ-078 与 composer 共享「本 instance 可 resolve」过滤,消灭幻影徽标
        //   [feat: permission-filter-concurrency] 2026-08-02
        return !permission.autoResponds(item, directory) && permission.canResolve(item, directory)
      })
    }),
  )
  const notify = createMemo(() => props.notify && (hasPermissions() || unseenCount() > 0))
  const name = createMemo(() => props.project.name || getFilename(props.project.worktree))

  return (
    <div class={`relative size-8 shrink-0 rounded ${props.class ?? ""}`}>
      <div class="size-full rounded overflow-clip">
        <Avatar
          fallback={name()}
          src={getProjectAvatarSource(props.project.id, props.project.icon)}
          {...getAvatarColors(props.project.icon?.color)}
          class="size-full rounded"
          classList={{ "badge-mask": notify() }}
        />
      </div>
      <Show when={notify()}>
        <div
          classList={{
            "absolute top-px right-px size-1.5 rounded-full z-10": true,
            "bg-surface-warning-strong": hasPermissions(),
            "bg-icon-critical-base": !hasPermissions() && hasError(),
            "bg-text-interactive-base": !hasPermissions() && !hasError(),
          }}
        />
      </Show>
      <Show when={props.working}>
        <div class="absolute bottom-px right-px size-3 rounded-full bg-background-base z-10 flex items-center justify-center">
          <Spinner class="size-[9px]" />
        </div>
      </Show>
    </div>
  )
}

export type SessionItemProps = {
  session: Session
  list: Session[]
  navList?: Accessor<Session[]>
  slug: string
  mobile?: boolean
  dense?: boolean
  showTooltip?: boolean
  showChild?: boolean
  level?: number
  sidebarExpanded: Accessor<boolean>
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
}

const SessionRow = (props: {
  session: Session
  slug: string
  mobile?: boolean
  dense?: boolean
  tint: Accessor<string | undefined>
  isWorking: Accessor<boolean>
  hasPermissions: Accessor<boolean>
  hasError: Accessor<boolean>
  unseenCount: Accessor<number>
  clearHoverProjectSoon: () => void
  sidebarOpened: Accessor<boolean>
  warmPress: () => void
  warmFocus: () => void
}): JSX.Element => {
  const title = () => sessionTitle(props.session.title)

  return (
    <A
      href={`/${props.slug}/session/${props.session.id}`}
      class={`flex items-center gap-2 min-w-0 w-full text-left focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
      onPointerDown={props.warmPress}
      onFocus={props.warmFocus}
      onClick={() => {
        if (props.sidebarOpened()) return
        props.clearHoverProjectSoon()
      }}
    >
      <Show when={props.isWorking() || props.hasPermissions() || props.hasError() || props.unseenCount() > 0}>
        <div
          class="shrink-0 size-6 flex items-center justify-center"
          style={{ color: props.tint() ?? "var(--icon-interactive-base)" }}
        >
          <Switch>
            <Match when={props.isWorking()}>
              <Spinner class="size-[15px]" />
            </Match>
            <Match when={props.hasPermissions()}>
              <div class="size-1.5 rounded-full bg-surface-warning-strong" />
            </Match>
            <Match when={props.hasError()}>
              <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
            </Match>
            <Match when={props.unseenCount() > 0}>
              <div class="size-1.5 rounded-full bg-text-interactive-base" />
            </Match>
          </Switch>
        </div>
      </Show>
      <span class="text-14-regular text-text-strong min-w-0 flex-1 truncate">{title()}</span>
    </A>
  )
}

export const SessionItem = (props: SessionItemProps): JSX.Element => {
  const params = useParams()
  const layout = useLayout()
  const language = useLanguage()
  const notification = useNotification()
  const permission = usePermission()
  const serverSync = useServerSync()
  // FORK: REQ-096 — 行内重命名 [feat: session-list-ux]
  const serverSDK = useServerSDK()
  const unseenCount = createMemo(() => notification.session.unseenCount(props.session.id))
  const hasError = createMemo(() => notification.session.unseenHasError(props.session.id))
  // FORK: 保留 setter — 下方 REQ-096 标题编辑局部更新用 2026-08-11
  const [sessionStore, setSessionStore] = serverSync().child(props.session.directory)
  const hasPermissions = createMemo(() => {
    return !!sessionPermissionRequest(
      sessionStore.session,
      serverSync().session.data.permission,
      props.session.id,
      (item) => {
        // FORK: REQ-078 共享 canResolve 过滤 [feat: permission-filter-concurrency] 2026-08-02
        return (
          !permission.autoResponds(item, props.session.directory) &&
          permission.canResolve(item, props.session.directory)
        )
      },
    )
  })
  // FORK: stuck-working-indicator-fix — 判定逻辑抽到 deriveSessionWorking 纯函数 [feat: stuck-working-indicator-fix]
  //   REQ-110(2026-08-17):数据源从 child store 换成**全局** session store。1.18 把
  //   session_status / message 的权威源挪到全局(child 的这些字段恒空:bootstrap 只写全局 +
  //   session.status/message.updated 在 event-reducer 里被 sessionContent:false 提前 return),
  //   于是判定恒 false —— 代码一行没少、类型全对、marker 全在,图标就是不亮。
  //   ⚠️ **保留** deriveSessionWorking 而不直接采上游 session_working(只看 status 不看 messages):
  //   2026-06-12 的 healClearedSessionOrphans(补盖被清会话的末条 assistant 残骸)当前**没有调用点**
  //   (同批已修复,见 bootstrap.ts),防卡死链路曾出现过缺口,这里不叠加第二个变更面。
  //   [feat: session-presentation-input-batch]
  const isWorking = createMemo(() =>
    deriveSessionWorking({
      hasPermissions: hasPermissions(),
      messages: serverSync().session.data.message[props.session.id],
      status: serverSync().session.data.session_status[props.session.id],
    }),
  )

  const tint = createMemo(() =>
    messageAgentColor(serverSync().session.data.message[props.session.id], sessionStore.agent),
  )
  const tooltip = createMemo(() => props.showTooltip ?? (props.mobile || !props.sidebarExpanded()))
  const currentChild = createMemo(() => {
    if (!props.showChild) return
    return childSessionOnPath(sessionStore.session, props.session.id, params.id)
  })

  const warm = (span: number, priority: "high" | "low") => {
    const nav = props.navList?.()
    const list = nav?.some((item) => item.id === props.session.id && item.directory === props.session.directory)
      ? nav
      : props.list

    props.prefetchSession(props.session, priority)

    const idx = list.findIndex((item) => item.id === props.session.id && item.directory === props.session.directory)
    if (idx === -1) return

    for (let step = 1; step <= span; step++) {
      const next = list[idx + step]
      if (next) props.prefetchSession(next, step === 1 ? "high" : priority)

      const prev = list[idx - step]
      if (prev) props.prefetchSession(prev, step === 1 ? "high" : priority)
    }
  }

  // FORK-BEGIN: REQ-096 — 行内重命名(blur/Enter 保存,Esc 放弃,空/未改恢复原名)[feat: session-list-ux]
  const [renaming, setRenaming] = createSignal(false)
  const [renameDraft, setRenameDraft] = createSignal("")
  const startRename = () => {
    setRenameDraft(sessionTitle(props.session.title) ?? "")
    setRenaming(true)
  }
  const commitRename = async () => {
    if (!renaming()) return
    const next = renameDraft().trim()
    const current = sessionTitle(props.session.title) ?? ""
    setRenaming(false)
    if (!next || next === current) return
    const ok = await serverSDK().client.session
      .update({ directory: props.session.directory, sessionID: props.session.id, title: next })
      .then(() => true)
      .catch(() => false)
    if (!ok) {
      showToast({ title: language.t("common.requestFailed"), variant: "error" })
      return
    }
    setSessionStore(
      produce((draft) => {
        const match = Binary.search(draft.session, props.session.id, (s) => s.id)
        if (match.found) draft.session[match.index].title = next
      }),
    )
  }
  // FORK-END

  const item = (
    <SessionRow
      session={props.session}
      slug={props.slug}
      mobile={props.mobile}
      dense={props.dense}
      tint={tint}
      isWorking={isWorking}
      hasPermissions={hasPermissions}
      hasError={hasError}
      unseenCount={unseenCount}
      clearHoverProjectSoon={props.clearHoverProjectSoon}
      sidebarOpened={layout.sidebar.opened}
      warmPress={() => warm(2, "high")}
      warmFocus={() => warm(2, "high")}
    />
  )

  // FORK: REQ-096 — 归档 hover 图标移除(误触重灾区,动作收进右键菜单);行内容抽为函数以便
  // 顶层行包 SessionRowMenu、子会话行保持原样 [feat: session-list-ux]
  const row = () => (
    <div
      data-session-id={props.session.id}
      class="group/session relative w-full min-w-0 rounded-md cursor-default pr-3 transition-colors hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[[data-expanded]]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active"
      style={{ "padding-left": `${8 + (props.level ?? 0) * 16}px` }}
    >
      <div class="flex min-w-0 items-center gap-1">
        <div class="min-w-0 flex-1">
          <Show
            when={!renaming()}
            fallback={
              <InlineInput
                ref={(el) => {
                  requestAnimationFrame(() => {
                    if (!el.isConnected) return
                    el.focus()
                    el.select()
                  })
                }}
                data-session-rename={props.session.id}
                value={renameDraft()}
                class="text-14-regular text-text-strong w-full min-w-0 my-1 rounded-[4px] pl-1"
                onInput={(event) => setRenameDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void commitRename()
                    return
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setRenaming(false)
                  }
                }}
                onBlur={() => void commitRename()}
              />
            }
          >
            <Show
              when={!tooltip()}
              fallback={
                <Tooltip
                  placement={props.mobile ? "bottom" : "right"}
                  value={sessionTitle(props.session.title)}
                  gutter={10}
                  class="min-w-0 w-full"
                >
                  {item}
                </Tooltip>
              }
            >
              {item}
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* FORK: REQ-096 — 顶层会话行挂右键菜单;子会话行(level>0)保持原样 [feat: session-list-ux] */}
      <Show when={!props.level} fallback={row()}>
        <SessionRowMenu session={props.session} onRename={startRename} archiveSession={props.archiveSession}>
          {row()}
        </SessionRowMenu>
      </Show>
      <Show when={currentChild()} keyed>
        {(child) => (
          <div class="w-full">
            <SessionItem {...props} session={child} level={(props.level ?? 0) + 1} />
          </div>
        )}
      </Show>
    </>
  )
}

export const NewSessionItem = (props: {
  slug: string
  mobile?: boolean
  dense?: boolean
  sidebarExpanded: Accessor<boolean>
  clearHoverProjectSoon: () => void
}): JSX.Element => {
  const layout = useLayout()
  const language = useLanguage()
  const label = language.t("command.session.new")
  const tooltip = () => props.mobile || !props.sidebarExpanded()
  const item = (
    <A
      href={`/${props.slug}/session`}
      end
      class={`flex items-center gap-2 min-w-0 w-full text-left focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
      onClick={() => {
        creation.resetDraft()
        if (layout.sidebar.opened()) return
        props.clearHoverProjectSoon()
      }}
    >
      <div class="shrink-0 size-6 flex items-center justify-center">
        <IconV2 name="edit" size="small" class="text-icon-weak" />
      </div>
      <span class="text-14-regular text-text-strong min-w-0 flex-1 truncate">{label}</span>
    </A>
  )

  return (
    <div class="group/session relative w-full min-w-0 rounded-md cursor-default transition-colors pl-2 pr-3 hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active">
      <Show
        when={!tooltip()}
        fallback={
          <Tooltip placement={props.mobile ? "bottom" : "right"} value={label} gutter={10} class="min-w-0 w-full">
            {item}
          </Tooltip>
        }
      >
        {item}
      </Show>
    </div>
  )
}

export const SessionSkeleton = (props: { count?: number }): JSX.Element => {
  const items = Array.from({ length: props.count ?? 4 }, (_, index) => index)
  return (
    <div class="flex flex-col gap-1">
      <For each={items}>
        {() => <div class="h-8 w-full rounded-md bg-surface-raised-base opacity-60 animate-pulse" />}
      </For>
    </div>
  )
}
