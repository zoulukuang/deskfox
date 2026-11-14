// [fork-only] Local voice acceptance must not take over the installed app's deep links.
// [feat: voice-main-integration] 2026-11-14
import type { App } from "electron"

export function registerDeskfoxProtocol(
  app: Pick<App, "isPackaged" | "setAsDefaultProtocolClient">,
  channel: string,
): void {
  if (!app.isPackaged || channel === "local") return
  app.setAsDefaultProtocolClient("opencode")
}
