import { For, Show, type Accessor, type JSX } from "solid-js"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { type LocalProject } from "@/context/layout"

// FORK-BEGIN: REQ-041 界面完整重排(图标栏锚左 + 解耦)2026-06-02
// 图标条从「焊死在会话面板旁的 flex 兄弟」抽成独立组件 SidebarRail,桌面端由 layout
// 单独绝对定位到屏幕最左(left-0 w-16),与会话面板(right-0)彻底隔离 —— 两者之间
// 不再有 hover 预览 / 鼠标瞄准 / 图标控折叠 的任何联动。SidebarContent 仅保留给移动端
// 抽屉(rail + panel 合并版)使用。
interface SidebarRailProps {
  mobile?: boolean
  projects: Accessor<LocalProject[]>
  renderProject: (project: LocalProject) => JSX.Element
  handleDragStart: (event: unknown) => void
  handleDragEnd: () => void
  handleDragOver: (event: DragEvent) => void
  openProjectLabel: JSX.Element
  openProjectKeybind: Accessor<string | undefined>
  onOpenProject: () => void
  renderProjectOverlay: () => JSX.Element
  settingsLabel: Accessor<string>
  settingsKeybind: Accessor<string | undefined>
  onOpenSettings: () => void
  helpLabel: Accessor<string>
  onOpenHelp: () => void
}

export const SidebarRail = (props: SidebarRailProps): JSX.Element => {
  const placement = () => (props.mobile ? "bottom" : "right")

  return (
    <div
      data-component="sidebar-rail"
      class="w-16 shrink-0 h-full bg-background-base flex flex-col items-center overflow-hidden"
    >
      <div class="flex-1 min-h-0 w-full">
        <DragDropProvider
          onDragStart={props.handleDragStart}
          onDragEnd={props.handleDragEnd}
          onDragOver={props.handleDragOver}
          collisionDetector={closestCenter}
        >
          <DragDropSensors />
          <ConstrainDragXAxis />
          <div class="h-full w-full flex flex-col items-center gap-3 px-3 py-3 overflow-y-auto no-scrollbar">
            <SortableProvider ids={props.projects().map((p) => p.worktree)}>
              <For each={props.projects()}>{(project) => props.renderProject(project)}</For>
            </SortableProvider>
            <Tooltip
              placement={placement()}
              value={
                <div class="flex items-center gap-2">
                  <span>{props.openProjectLabel}</span>
                  <Show when={!props.mobile && !!props.openProjectKeybind()}>
                    <span class="text-icon-base text-12-medium">{props.openProjectKeybind()}</span>
                  </Show>
                </div>
              }
            >
              <IconButton
                icon="plus"
                variant="ghost"
                size="large"
                onClick={props.onOpenProject}
                aria-label={typeof props.openProjectLabel === "string" ? props.openProjectLabel : undefined}
              />
            </Tooltip>
          </div>
          <DragOverlay>{props.renderProjectOverlay()}</DragOverlay>
        </DragDropProvider>
      </div>
      <div class="shrink-0 w-full pt-3 pb-6 flex flex-col items-center gap-2">
        <TooltipKeybind placement={placement()} title={props.settingsLabel()} keybind={props.settingsKeybind() ?? ""}>
          <IconButton
            icon="settings-gear"
            variant="ghost"
            size="large"
            onClick={props.onOpenSettings}
            aria-label={props.settingsLabel()}
          />
        </TooltipKeybind>
        <Tooltip placement={placement()} value={props.helpLabel()}>
          <IconButton
            icon="help"
            variant="ghost"
            size="large"
            onClick={props.onOpenHelp}
            aria-label={props.helpLabel()}
          />
        </Tooltip>
      </div>
    </div>
  )
}

// 移动端抽屉:图标条 + 会话面板合并版(桌面端不再走这里,两块由 layout 各自独立定位)
export const SidebarContent = (props: { rail: JSX.Element; renderPanel: () => JSX.Element }): JSX.Element => {
  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden">
      {props.rail}
      <div class="flex-1 flex h-full min-h-0 min-w-0 overflow-hidden">{props.renderPanel()}</div>
    </div>
  )
}
// FORK-END
