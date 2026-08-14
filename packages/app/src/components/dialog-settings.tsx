import { Component, createSignal, startTransition } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsServers } from "./settings-servers"
// FORK: 飞书桥接 Settings Tab(C1.4)[feat: feishu-bridge] 2026-05-08
import { SettingsFeishu } from "./settings-feishu"
// FORK: 设置页脚显示 DeskFox <Platform> + installer 版本号(YYYY.M.D.N), 2026-05-06
// installer-versions.json 由 bump-installer-version.{ps1,sh} 在每次 bump 时同步更新对应平台 key
import installerVersions from "@opencode-ai/branding/installer-versions.json"

export const DialogSettings: Component<{ defaultValue?: string }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const [tab, setTab] = createSignal(props.defaultValue ?? "general")

  const showProviders = () => {
    void dialog.show(() => <DialogSettings defaultValue="providers" />)
  }

  // FORK: 设置页脚 — DeskFox <Platform> + installer 版本号
  const platformLabel =
    platform.os === "macos" ? "macOS"
    : platform.os === "windows" ? "Windows"
    : platform.os === "linux" ? "Linux"
    : ""
  // FORK: 按 channel 读独立号线(规范 §3.2bis Dev 领先模式):prod 读裸 <plat> key,
  // dev/beta 读独立 dev-<plat>/beta-<plat> key(installer-versions.json 是 channel×platform 两维)。
  // 换基座前 Tauri build-deskfox.ps1 有此逻辑,electron 漏迁致 dev 版误显 prod 号线 → 此处补回。
  const versions = installerVersions as Record<string, string>
  const channel = import.meta.env.VITE_OPENCODE_CHANNEL // "dev" | "beta" | "prod" | undefined
  const platKey =
    platform.os === "macos" ? "macos"
    : platform.os === "windows" ? "windows"
    : "linux"
  const verKey = channel === "dev" || channel === "beta" ? `${channel}-${platKey}` : platKey
  const installerVer = versions[verKey] ?? versions[platKey] ?? platform.version

  return (
    <Dialog size="x-large" transition>
      <Tabs
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value))}
        class="h-full settings-dialog"
      >
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full gap-4">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="servers">
                      <Icon name="server" />
                      {language.t("status.popover.tab.servers")}
                    </Tabs.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                    </Tabs.Trigger>
                    {/* FORK: 飞书桥接 Tab(C1.4)[feat: feishu-bridge] 2026-05-08 */}
                    <Tabs.Trigger value="feishu">
                      <Icon name="comment" />
                      {language.t("settings.tab.feishu")}
                    </Tabs.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{platformLabel ? `DeskFox for ${platformLabel}` : "DeskFox"}</span>
              <span class="text-11-regular">v{installerVer}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="servers" class="no-scrollbar">
          <SettingsServers />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders onBack={showProviders} />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
        {/* FORK: 飞书桥接 Tab Content(C1.4)[feat: feishu-bridge] 2026-05-08 */}
        <Tabs.Content value="feishu" class="no-scrollbar">
          <SettingsFeishu />
        </Tabs.Content>
      </Tabs>
    </Dialog>
  )
}
