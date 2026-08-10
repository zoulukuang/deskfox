import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createSortable } from "@thisbeyond/solid-dnd"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Tabs } from "@opencode-ai/ui/tabs"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { getFilename } from "@opencode-ai/core/util/path"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"

export function FileVisual(props: { path: string; active?: boolean; temporary?: boolean }): JSX.Element {
  return (
    <div class="flex items-center gap-x-1.5 min-w-0">
      <Show
        when={!props.active}
        fallback={<FileIcon node={{ path: props.path, type: "file" }} class="size-4 shrink-0" />}
      >
        <span class="relative inline-flex size-4 shrink-0">
          <FileIcon node={{ path: props.path, type: "file" }} class="absolute inset-0 size-4 tab-fileicon-color" />
          <FileIcon node={{ path: props.path, type: "file" }} mono class="absolute inset-0 size-4 tab-fileicon-mono" />
        </span>
      </Show>
      <span class="text-14-medium truncate" classList={{ italic: props.temporary }}>
        {getFilename(props.path)}
      </span>
    </div>
  )
}

export function SortableTab(props: {
  tab: string
  temporary?: boolean
  onTabClose: (tab: string) => void
  onTabDoubleClick?: (tab: string) => void
  // FORK: 右键「关闭其他标签」回调,caller 传(关掉除本 tab 外所有已开 tab)[feat: file-tab-close-others] 2026-06-09
  onCloseOthers?: (tab: string) => void
}): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const sortable = createSortable(props.tab)
  const path = createMemo(() => file.pathFromTab(props.tab))
  const content = createMemo(() => {
    const value = path()
    if (!value) return
    return <FileVisual path={value} temporary={props.temporary} />
  })
  // FORK: tab 右键菜单(照搬 terminal tab 的 DropdownMenu 定位模式)[feat: file-tab-close-others] 2026-06-09
  const [store, setStore] = createStore({ menuOpen: false, menuPosition: { x: 0, y: 0 } })
  const openMenu = (e: MouseEvent) => {
    if (!props.onCloseOthers) return
    e.preventDefault()
    setStore("menuPosition", { x: e.clientX, y: e.clientY })
    setStore("menuOpen", true)
  }
  return (
    <div use:sortable class="h-full flex items-center" classList={{ "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative">
        <Tabs.Trigger
          value={props.tab}
          onContextMenu={openMenu}
          closeButton={
            <TooltipKeybind
              title={language.t("common.closeTab")}
              keybind={command.keybind("tab.close")}
              placement="bottom"
              gutter={10}
            >
              <IconButton
                icon="close-small"
                variant="ghost"
                class="h-5 w-5"
                onClick={() => props.onTabClose(props.tab)}
                aria-label={language.t("common.closeTab")}
              />
            </TooltipKeybind>
          }
          hideCloseButton
          onMiddleClick={() => props.onTabClose(props.tab)}
          onDblClick={() => props.onTabDoubleClick?.(props.tab)}
        >
          <Show when={content()}>{(value) => value()}</Show>
        </Tabs.Trigger>
        <DropdownMenu open={store.menuOpen} onOpenChange={(open) => setStore("menuOpen", open)}>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              class="fixed"
              style={{ left: `${store.menuPosition.x}px`, top: `${store.menuPosition.y}px` }}
            >
              <DropdownMenu.Item onSelect={() => props.onCloseOthers?.(props.tab)}>
                <Icon name="close-small" class="w-4 h-4 mr-2" />
                {language.t("common.closeOtherTabs")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </div>
  )
}
