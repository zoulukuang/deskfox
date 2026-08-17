import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useSortable } from "@dnd-kit/solid/sortable"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { FileVisual } from "./session-sortable-tab"

export function SortableTabV2(props: {
  tab: string
  index: () => number
  temporary?: boolean
  onTabClose: (tab: string) => void
  onTabDoubleClick?: (tab: string) => void
  // FORK-BEGIN: REQ-111 点顶部当前文件 tab 收起预览器 [feat: session-presentation-input-batch] 2026-08-17
  //   按下时先快照激活 tab(见 session-tab-collapse.ts 坑 ①),点击时交由调用方判定。
  onTabPress?: (tab: string) => void
  onTabClick?: (tab: string) => void
  // FORK-END
}): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const closeTabKeybind = createMemo(() => command.keybindParts("tab.close"))
  const sortable = useSortable({
    get id() {
      return props.tab
    },
    get index() {
      return props.index()
    },
  })
  const path = createMemo(() => file.pathFromTab(props.tab))
  const content = createMemo(() => {
    const value = path()
    if (!value) return
    return <FileVisual path={value} temporary={props.temporary} />
  })
  return (
    <div ref={sortable.ref} class="h-full flex items-center">
      {/* FORK: REQ-111 —— 收起判定挂在外层 wrapper 上靠事件冒泡接,不往 Tabs.Trigger 上塞 onClick:
          那会落到 Kobalte.Trigger 的 props 里,是否与它自身的 onClick 合并属未定义行为
          (本批修的三条回归就是栽在"依赖 Kobalte 隐式行为")。
          [feat: session-presentation-input-batch] 2026-08-17 */}
      <div
        class="relative"
        on:pointerdown={{ handleEvent: () => props.onTabPress?.(props.tab), capture: true }}
        onClick={() => props.onTabClick?.(props.tab)}
      >
        <Tabs.Trigger
          value={props.tab}
          closeButton={
            <TooltipV2
              value={
                <>
                  {language.t("common.closeTab")}
                  <Show when={closeTabKeybind().length > 0}>
                    <KeybindV2 keys={closeTabKeybind()} variant="neutral" />
                  </Show>
                </>
              }
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
            </TooltipV2>
          }
          hideCloseButton
          onMiddleClick={() => props.onTabClose(props.tab)}
          onDblClick={() => props.onTabDoubleClick?.(props.tab)}
        >
          <Show when={content()}>{(value) => value()}</Show>
        </Tabs.Trigger>
      </div>
    </div>
  )
}
