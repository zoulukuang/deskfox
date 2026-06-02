import { createMemo, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { createSortable } from "@thisbeyond/solid-dnd"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { ProjectIcon, type SessionItemProps } from "./sidebar-items"
import { displayName } from "./helpers"

// FORK-BEGIN: REQ-041 界面完整重排(图标栏锚左 + 解耦)2026-06-02
// 图标条与会话面板彻底隔离:删除两套悬停预览(此前 sidebar 关时的 overlay peek + sidebar
// 开时的 HoverCard「最近会话」卡片)+ 鼠标瞄准(aim)接线;点项目图标只切项目,绝不开合
// 会话栏(会话栏开合只归顶部 sidebar.toggle 按钮)。接口因此去掉所有 hover 相关字段。
export type ProjectSidebarContext = {
  currentDir: Accessor<string>
  currentProject: Accessor<LocalProject | undefined>
  navigateToProject: (directory: string) => void
  closeProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  workspacesEnabled: (project: LocalProject) => boolean
  workspaceIds: (project: LocalProject) => string[]
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  sessionProps: Omit<SessionItemProps, "session" | "list" | "slug" | "mobile" | "dense">
}

export const ProjectDragOverlay = (props: {
  projects: Accessor<LocalProject[]>
  activeProject: Accessor<string | undefined>
}): JSX.Element => {
  const project = createMemo(() => props.projects().find((p) => p.worktree === props.activeProject()))
  return (
    <Show when={project()}>
      {(p) => (
        <div class="bg-background-base rounded-xl p-1">
          <ProjectIcon project={p()} />
        </div>
      )}
    </Show>
  )
}

const ProjectTile = (props: {
  project: LocalProject
  selected: Accessor<boolean>
  active: Accessor<boolean>
  dirs: Accessor<string[]>
  navigateToProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  workspacesEnabled: (project: LocalProject) => boolean
  closeProject: (directory: string) => void
  setMenu: (value: boolean) => void
  language: ReturnType<typeof useLanguage>
}): JSX.Element => {
  const notification = useNotification()
  const unseenCount = createMemo(() =>
    props.dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )

  const clear = () =>
    props
      .dirs()
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))

  return (
    <ContextMenu modal onOpenChange={(value) => props.setMenu(value)}>
      <ContextMenu.Trigger
        as="button"
        type="button"
        aria-label={displayName(props.project)}
        data-action="project-switch"
        data-project={base64Encode(props.project.worktree)}
        classList={{
          "flex items-center justify-center size-10 p-1 rounded-lg overflow-hidden transition-colors cursor-default": true,
          "bg-transparent border-2 border-icon-strong-base hover:bg-surface-base-hover": props.selected(),
          "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
            !props.selected() && !props.active(),
          "bg-surface-base-hover border border-border-weak-base": !props.selected() && props.active(),
        }}
        onClick={() => {
          // FORK: REQ-041 — 点图标只切项目,不再 toggle 会话栏开合(点已选中项目 = 无操作)
          if (props.selected()) return
          props.navigateToProject(props.project.worktree)
        }}
      >
        <ProjectIcon project={props.project} notify />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <ContextMenu.Item onSelect={() => props.showEditProjectDialog(props.project)}>
            <ContextMenu.ItemLabel>{props.language.t("common.edit")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Item
            data-action="project-workspaces-toggle"
            data-project={base64Encode(props.project.worktree)}
            disabled={props.project.vcs !== "git" && !props.workspacesEnabled(props.project)}
            onSelect={() => props.toggleProjectWorkspaces(props.project)}
          >
            <ContextMenu.ItemLabel>
              {props.workspacesEnabled(props.project)
                ? props.language.t("sidebar.workspaces.disable")
                : props.language.t("sidebar.workspaces.enable")}
            </ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Item
            data-action="project-clear-notifications"
            data-project={base64Encode(props.project.worktree)}
            disabled={unseenCount() === 0}
            onSelect={clear}
          >
            <ContextMenu.ItemLabel>{props.language.t("sidebar.project.clearNotifications")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            data-action="project-close-menu"
            data-project={base64Encode(props.project.worktree)}
            onSelect={() => props.closeProject(props.project.worktree)}
          >
            <ContextMenu.ItemLabel>{props.language.t("common.close")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}

export const SortableProject = (props: {
  project: LocalProject
  mobile?: boolean
  ctx: ProjectSidebarContext
  sortNow: Accessor<number>
}): JSX.Element => {
  const language = useLanguage()
  const sortable = createSortable(props.project.worktree)
  const selected = createMemo(() => props.ctx.currentProject()?.worktree === props.project.worktree)
  const dirs = createMemo(() => props.ctx.workspaceIds(props.project))
  const [state, setState] = createStore({
    menu: false,
  })

  const active = createMemo(() => state.menu)

  return (
    // @ts-ignore
    <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
      <ProjectTile
        project={props.project}
        selected={selected}
        active={active}
        dirs={dirs}
        navigateToProject={props.ctx.navigateToProject}
        showEditProjectDialog={props.ctx.showEditProjectDialog}
        toggleProjectWorkspaces={props.ctx.toggleProjectWorkspaces}
        workspacesEnabled={props.ctx.workspacesEnabled}
        closeProject={props.ctx.closeProject}
        setMenu={(value) => setState("menu", value)}
        language={language}
      />
    </div>
  )
}
// FORK-END
