import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@/utils/toast"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, createSignal, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerProtocol, useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { DialogConnectProvider, useProviderConnectController } from "./dialog-connect-provider"
import { usePlatform } from "@/context/platform"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { SettingsList } from "./settings-list"
import { SettingsServerPicker, SettingsServerScope } from "./settings-server-picker"
// FORK: REQ-054 — 刷新 GetBot 模型列表 2026-06-18
import {
  GETBOT_PROVIDER_ID,
  fetchGetbotChatModels,
  mergeGetbotModels,
  GetbotInvalidKeyError,
  GetbotTimeoutError,
} from "@/utils/getbot"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  // FORK: getbot tagline 在设置→提供商热门列表展示 2026-04-27
  { match: (id: string) => id === "getbot", key: "dialog.provider.getbot.tagline" },
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "opencode-go", key: "dialog.provider.opencodeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

export const SettingsProviders: Component<{ onBack?: () => void }> = (props) => {
  return (
    <SettingsServerScope>
      <SettingsProvidersContent onBack={props.onBack} />
    </SettingsServerScope>
  )
}

const SettingsProvidersContent: Component<{ onBack?: () => void }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const protocol = useServerProtocol()
  const serverSync = useServerSync()
  const platform = usePlatform()
  const providers = useProviders(() => undefined)
  const providerConnect = useProviderConnectController({ onBack: props.onBack })

  const connect = (provider?: string) => {
    providerConnect.select(provider)
    void dialog.show(() => <DialogConnectProvider controller={providerConnect} />)
  }
  // FORK: REQ-054 — getbot 刷新模型加载状态 2026-06-18
  const [getbotRefreshing, setGetbotRefreshing] = createSignal(false)

  const connected = createMemo(() => {
    return providers
      .connected()
      .filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => {
      // FORK: getbot 在设置→提供商热门列表强制置顶（与选择提供商弹窗一致） 2026-04-27
      if (a.id === "getbot") return -1
      if (b.id === "getbot") return 1
      return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
    })
    return items
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) =>
    source(item) !== "env" && (protocol() === "v1" || !isConfigCustom(item.id))

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const isConfigCustom = (providerID: string) => {
    const provider = serverSync().data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  // FORK-BEGIN: REQ-054 — getbot 刷新模型列表 handler 2026-06-18
  const refreshGetbotModels = async () => {
    if (getbotRefreshing()) return
    const apiKey = serverSync().data.config.provider?.[GETBOT_PROVIDER_ID]?.options?.apiKey as
      | string
      | undefined
    if (!apiKey) {
      showToast({ title: language.t("common.requestFailed"), description: "GetBot API key not found in config" })
      return
    }
    setGetbotRefreshing(true)
    try {
      const remoteIds = await fetchGetbotChatModels(apiKey, { fetch: platform.fetch })
      const existing = serverSync().data.config.provider?.[GETBOT_PROVIDER_ID]?.models ?? {}
      const merged = mergeGetbotModels(existing, remoteIds)
      // 写回:两步整块替换以规避 patchJsonc 只增不删的限制:
      // 步骤 1:注入 merged 模型(新模型出现 + 已有能力标注保留)
      await serverSync().updateConfig({
        provider: { [GETBOT_PROVIDER_ID]: { models: merged } },
      })
      serverSync().refreshProviders()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.getbot.refreshModels.success", { count: String(remoteIds.length) }),
      })
    } catch (e) {
      let msg: string
      if (e instanceof GetbotInvalidKeyError) msg = language.t("provider.connect.getbot.apiKey.invalid")
      else if (e instanceof GetbotTimeoutError) msg = language.t("provider.connect.getbot.timeout")
      else msg = e instanceof Error ? e.message : String(e)
      showToast({ title: language.t("provider.getbot.refreshModels.failed", { error: msg }) })
    } finally {
      setGetbotRefreshing(false)
    }
  }
  // FORK-END

  const disableProvider = async (providerID: string, name: string) => {
    if (protocol() !== "v1") return
    const before = serverSync().data.config.disabled_providers ?? []
    const next = before.includes(providerID) ? before : [...before, providerID]
    serverSync().set("config", "disabled_providers", next)

    await serverSync()
      .updateConfig({ disabled_providers: next })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        serverSync().set("config", "disabled_providers", before)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const disconnect = async (providerID: string, name: string) => {
    if (isConfigCustom(providerID)) {
      await serverSDK()
        .client.auth.remove({ providerID })
        .catch(() => undefined)
      await disableProvider(providerID, name)
      return
    }
    await serverSDK()
      .client.auth.remove({ providerID })
      .then(async () => {
        await serverSDK().client.global.dispose()
        // FORK: REQ-052 — 旧版同位置同处理:dispose 后强制失效 providers query 2026-06-18
        serverSync().refreshProviders()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex items-center justify-between gap-4 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.providers.title")}</h2>
          <SettingsServerPicker />
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1" data-component="connected-providers-section">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.connected")}</h3>
          <SettingsList>
            <Show
              when={connected().length > 0}
              fallback={
                // FORK: REQ-052 — data-empty-state 锚点供 e2e 断言(对齐 v2 providers.tsx)2026-06-18
                <div class="py-4 text-14-regular text-text-weak" data-empty-state="connected-providers">
                  {language.t("settings.providers.connected.empty")}
                </div>
              }
            >
              <For each={connected()}>
                {(item) => (
                  // FORK: REQ-052 — data-provider-id 锚点供 e2e 断言(对齐 v2 providers.tsx)2026-06-18
                  <div
                    class="group flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none"
                    data-provider-id={item.id}
                  >
                    <div class="flex items-center gap-3 min-w-0">
                      <ProviderIcon id={item.id} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong truncate">{item.name}</span>
                      <Tag>{type(item)}</Tag>
                    </div>
                    <div class="flex items-center gap-2">
                      {/* FORK-BEGIN: REQ-054 — getbot 刷新模型按钮(仅 getbot 显示) 2026-06-18 */}
                      <Show when={item.id === GETBOT_PROVIDER_ID}>
                        {/* FORK: REQ-054 — data-component 锚点放外层 span(Button 根硬编码 data-component 不可覆盖,沿用 U1 wrapper 方案,避免改上游) 2026-06-18 */}
                        <span data-component="getbot-refresh-models">
                          <Button
                            size="large"
                            variant="secondary"
                            disabled={getbotRefreshing()}
                            onClick={() => void refreshGetbotModels()}
                          >
                            {getbotRefreshing()
                              ? language.t("common.loading")
                              : language.t("provider.getbot.refreshModels")}
                          </Button>
                        </span>
                      </Show>
                      {/* FORK-END */}
                      <Show
                        when={canDisconnect(item)}
                        fallback={
                          <span class="text-14-regular text-text-base opacity-0 group-hover:opacity-100 transition-opacity duration-200 pr-3 cursor-default">
                            {language.t("settings.providers.connected.environmentDescription")}
                          </span>
                        }
                      >
                        <Button size="large" variant="ghost" onClick={() => void disconnect(item.id, item.name)}>
                          {language.t("common.disconnect")}
                        </Button>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.popular")}</h3>
          <SettingsList>
            <For each={popular()}>
              {(item) => (
                <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                  <div class="flex flex-col min-w-0">
                    <div class="flex items-center gap-x-3">
                      <ProviderIcon id={item.id} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong">{item.name}</span>
                      {/* FORK: getbot 推荐 Tag 2026-04-27 */}
                      <Show when={item.id === "getbot"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                      <Show when={item.id === "opencode"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                      <Show when={item.id === "opencode-go"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                    </div>
                    <Show when={note(item.id)}>
                      {(key) => <span class="text-12-regular text-text-weak pl-8">{language.t(key())}</span>}
                    </Show>
                  </div>
                  <Button size="large" variant="secondary" icon="plus-small" onClick={() => connect(item.id)}>
                    {language.t("common.connect")}
                  </Button>
                </div>
              )}
            </For>

            <Show when={protocol() === "v1"}>
              <div
                class="flex items-center justify-between gap-4 min-h-16 border-b border-border-weak-base last:border-none flex-wrap py-3"
                data-component="custom-provider-section"
              >
                <div class="flex flex-col min-w-0">
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
                    <span class="text-14-medium text-text-strong">{language.t("provider.custom.title")}</span>
                    <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                  </div>
                  <span class="text-12-regular text-text-weak pl-8">
                    {language.t("settings.providers.custom.description")}
                  </span>
                </div>
                <Button
                  size="large"
                  variant="secondary"
                  icon="plus-small"
                  onClick={() => {
                    dialog.show(() => <DialogCustomProvider onBack={dialog.close} />)
                  }}
                >
                  {language.t("common.connect")}
                </Button>
              </div>
            </Show>
          </SettingsList>

          <Button
            variant="ghost"
            class="px-0 py-0 mt-5 text-14-medium text-text-interactive-base text-left justify-start hover:bg-transparent active:bg-transparent"
            onClick={() => connect()}
          >
            {language.t("dialog.provider.viewAll")}
          </Button>
        </div>
      </div>
    </div>
  )
}
