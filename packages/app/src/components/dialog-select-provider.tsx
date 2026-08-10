import { type Accessor, Component, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/tag"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { useLanguage } from "@/context/language"
import { DialogCustomProvider } from "./dialog-custom-provider"

import { GETBOT_PROVIDER_ID, GETBOT_PROVIDER_NAME } from "@/utils/getbot" // FORK: getbot 合成项 [feat: electron-replatform]
const CUSTOM_ID = "_custom"

export const DialogSelectProvider: Component<{ directory?: Accessor<string | undefined> }> = (props) => {
  const dialog = useDialog()
  const providers = useProviders(props.directory)
  const language = useLanguage()

  const popularGroup = () => language.t("dialog.provider.group.popular")
  const otherGroup = () => language.t("dialog.provider.group.other")
  const customLabel = () => language.t("settings.providers.tag.custom")
  const note = (id: string) => {
    if (id === "getbot") return language.t("dialog.provider.getbot.tagline") // FORK: getbot tagline 2026-04-26
    if (id === "anthropic") return language.t("dialog.provider.anthropic.note")
    if (id === "openai") return language.t("dialog.provider.openai.note")
    if (id.startsWith("github-copilot")) return language.t("dialog.provider.copilot.note")
    if (id === "opencode-go") return language.t("dialog.provider.opencodeGo.tagline")
  }

  return (
    <Dialog title={language.t("command.provider.connect")} transition>
      <List
        class="px-3"
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="plus-small"
        key={(x) => x?.id}
        items={() => {
          language.locale()
          const all = providers.all()
          const list: { id: string; name: string }[] = [
            { id: CUSTOM_ID, name: customLabel() },
            ...all.values(),
          ]
          // FORK: getbot 合成项在弹窗层注入(all() 保持上游 Map);置顶/Tag 逻辑在 sortBy/Tag 处 [feat: electron-replatform]
          if (!all.has(GETBOT_PROVIDER_ID)) list.push({ id: GETBOT_PROVIDER_ID, name: GETBOT_PROVIDER_NAME })
          return list
        }}
        filterKeys={["id", "name"]}
        groupBy={(x) => (popularProviders.includes(x.id) ? popularGroup() : otherGroup())}
        sortBy={(a, b) => {
          if (a.id === CUSTOM_ID) return -1
          if (b.id === CUSTOM_ID) return 1
          // FORK: provider 弹窗里 getbot 强制置顶(盈利核心,与 popularProviders 自然顺序解耦) 2026-04-26
          if (a.id === "getbot") return -1
          if (b.id === "getbot") return 1
          if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
            return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
          return a.name.localeCompare(b.name)
        }}
        sortGroupsBy={(a, b) => {
          const popular = popularGroup()
          if (a.category === popular && b.category !== popular) return -1
          if (b.category === popular && a.category !== popular) return 1
          return 0
        }}
        onSelect={(x) => {
          if (!x) return
          if (x.id === CUSTOM_ID) {
            dialog.show(() => <DialogCustomProvider back="providers" directory={props.directory} />)
            return
          }
          dialog.show(() => <DialogConnectProvider provider={x.id} directory={props.directory} />)
        }}
      >
        {(i) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
            <span>{i.name}</span>
            <Show when={i.id === "opencode"}>
              <div class="text-14-regular text-text-weak">{language.t("dialog.provider.opencode.tagline")}</div>
            </Show>
            <Show when={i.id === CUSTOM_ID}>
              <Tag>{language.t("settings.providers.tag.custom")}</Tag>
            </Show>
            <Show when={i.id === "opencode"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
            <Show when={note(i.id)}>{(value) => <div class="text-14-regular text-text-weak">{value()}</div>}</Show>
            <Show when={i.id === "opencode-go"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
            {/* FORK: getbot 推荐 Tag 2026-04-26 */}
            <Show when={i.id === "getbot"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
