// FORK-ONLY: actual scoped SDK + document preview regression fixture [feat: daily-file-links] 2026-11-14
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { AppBaseProviders } from "@/app"
import { PlatformProvider } from "@/context/platform"
import { ServerConnection, ServerProvider, useServer } from "@/context/server"
import { GlobalProvider } from "@/context/global"
import { ServerSDKProvider } from "@/context/server-sdk"
import { SDKProvider } from "@/context/sdk"
import { createDocumentLinkOpener } from "@/pages/session/document-link"
import "@/index.css"

const parameters = new URLSearchParams(location.search)
const local: ServerConnection.Any = { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } }
const remote: ServerConnection.Any = { type: "http", http: { url: "http://127.0.0.1:4096" } }
const wsl: ServerConnection.Any = {
  type: "sidecar",
  variant: "wsl",
  distro: "Ubuntu",
  http: { url: "http://127.0.0.1:4096" },
}
const scoped = parameters.get("scope") === "remote" ? remote : parameters.get("scope") === "wsl" ? wsl : local

function Probe() {
  const global = useServer()
  const open = createDocumentLinkOpener()
  const [error, setError] = createSignal("")
  return (
    <>
      <p>Global server: {global.current?.type}</p>
      <button
        onClick={() =>
          void open(parameters.get("path") ?? "", parameters.get("fragment") ?? "").catch((cause) =>
            setError(cause.message),
          )
        }
      >
        Open artifact
      </button>
      <p role="alert">{error()}</p>
    </>
  )
}

render(
  () => (
    <PlatformProvider
      value={{ platform: "web", openExternal: () => {}, restart: async () => {}, notify: async () => {} }}
    >
      <AppBaseProviders locale="en">
        <ServerProvider defaultServer={ServerConnection.key(local)} servers={[local, remote, wsl]}>
          <GlobalProvider>
            <ServerSDKProvider server={() => scoped}>
              <SDKProvider directory="/test/project">
                <Probe />
              </SDKProvider>
            </ServerSDKProvider>
          </GlobalProvider>
        </ServerProvider>
      </AppBaseProviders>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
