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
        onClick={(event) => {
          // FORK: REQ-130 —— × 在 DOM 上是本 wrapper 的后代(tabs.tsx 把 close button 渲染成
          //   Kobalte.Trigger 的兄弟、同在 tabs-trigger-wrapper 内),点它必然冒泡到这里。
          //   出事时序:pointerdown 快照 activeTabAtPress=本 tab → × 的 onClick 关掉该 tab →
          //   click 冒到 wrapper → decideTabCollapse 三条件全真 → reviewPanel.close(),
          //   于是"关掉一个标签"变成"整个预览区收起"。× 本来就不是"点 tab",命中即 return。
          //   两条既有判据正好当回归锚:关**非激活** tab 本来就不收(activeAtPress≠tab),
          //   ⌘W 不经 click 故本来就不受影响 —— 修完三者行为一致。
          //   [feat: release-closeout-2026-09] 2026-09-17
          if ((event.target as Element | null)?.closest?.('[data-slot="tabs-trigger-close-button"]')) return
          props.onTabClick?.(props.tab)
        }}
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
