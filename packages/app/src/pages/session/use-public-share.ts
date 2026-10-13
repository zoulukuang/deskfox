import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { publishPublicShare } from "@/utils/public-share"

export function usePublicShare() {
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  return (sessionID: string) => {
    const client = sdk().client
    const server = serverSDK()
    return publishPublicShare({
      locale: language.locale(),
      server: server.server.http,
      protocol: server.protocol,
      fetch: platform.fetch ?? fetch,
      unsupported: language.t("share.public.unsupported"),
      unavailable: language.t("share.public.unavailable"),
      publish: (shareTarget) => client.session.share({ sessionID, shareTarget }),
    })
  }
}
