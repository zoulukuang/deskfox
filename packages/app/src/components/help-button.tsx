import { Icon } from "@opencode-ai/ui/v2/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"

export function HelpButton() {
  // FORK: 上游右下角「?」帮助气泡内容还是 Lorem ipsum 占位、未完成,原本仅 dev 渠道显示;
  //   dev 预览版可对外发,占位文案外泄不专业 → 改成始终不显示(把渠道判断换成永真条件,保留下方实现待日后放开)
  //   [feat: titlebar-icons-rearrange] 2026-06-13
  if (import.meta.env.VITE_OPENCODE_CHANNEL !== "__disabled-until-real-content__") return null

  const [state, setState] = /* persisted(Persist.global("help-button"), */ createStore({ dismissed: false }) /* ) */
  const [shown, setShown] = createSignal(false)

  return (
    <Show when={!state.dismissed}>
      <div class="fixed bottom-4 right-4 z-50 hidden md:block">
        <Popover
          open={shown()}
          onOpenChange={setShown}
          triggerAs="button"
          triggerProps={{
            type: "button",
            "aria-label": "Help",
            class:
              "size-7 rounded-full bg-background-base shadow-[var(--shadow-lg-border-base)] flex items-center justify-center text-text-base hover:text-text-strong transition-colors",
          }}
          trigger={<span aria-hidden="true">?</span>}
          class="[&_[data-slot=popover-body]]:p-0 w-[320px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
          gutter={8}
          placement="top-end"
        >
          <Show when={shown()}>
            <div class="relative flex flex-col gap-1 w-[320px] p-4 rounded-xl bg-background-strong shadow-[var(--shadow-lg-border-base)]">
              <button
                type="button"
                aria-label="Close"
                class="absolute top-3.5 right-3.5 size-6 rounded-md flex items-center justify-center text-text-base hover:text-text-strong hover:bg-surface-raised-base-hover transition-colors"
                onClick={() => {
                  setShown(false)
                  setState("dismissed", true)
                }}
              >
                <Icon name="xmark-small" />
              </button>
              <span class="text-14-regular text-text-strong">Lorem ipsum dolor sit amet</span>
              <p class="text-12-regular text-text-weak">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et
                dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.
              </p>
            </div>
          </Show>
        </Popover>
      </div>
    </Show>
  )
}
