import { useServerSync } from "@/context/server-sync"
import { decode64 } from "@/utils/base64"
// FORK: 引入 getbot 内置元数据 2026-04-26
import { GETBOT_PROVIDER_ID, GETBOT_PROVIDER_NAME } from "@/utils/getbot"
import { useParams } from "@solidjs/router"
import { Iterable, pipe } from "effect"
import type { Accessor } from "solid-js"
import { selectProviderCatalog } from "./provider-catalog"

export const popularProviders = [
  // FORK: getbot 紧跟 opencode/zen 之后(model 选择器自然顺序);provider 弹窗里另外 override 把它顶到首位 2026-04-26
  "opencode",
  GETBOT_PROVIDER_ID,
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
const popularProviderSet = new Set(popularProviders)

// FORK-BEGIN: 未配置时注入合成 getbot 项，让其在 provider 弹窗中可见 2026-04-26
// export: 连接弹窗(dialog-connect-provider)直连 getbot 时也用它兜底,避免 provider() 为 undefined 崩溃
export const GETBOT_SYNTHETIC = {
  id: GETBOT_PROVIDER_ID,
  name: GETBOT_PROVIDER_NAME,
  source: "custom" as const,
  env: [],
  options: {},
  models: {},
}

function withGetbot<T extends { id: string }>(list: readonly T[]): T[] {
  if (list.some((p) => p.id === GETBOT_PROVIDER_ID)) return list as T[]
  return [GETBOT_SYNTHETIC as unknown as T, ...list]
}
// FORK-END

export function useProviders(directory?: Accessor<string | undefined>) {
  const serverSync = useServerSync()
  const params = useParams()
  const dir = () => (directory ? directory() : decode64(params.dir))
  const providers = () => {
    const value = dir()
    const projectStore = value ? serverSync().child(value)[0] : undefined
    if (directory)
      return selectProviderCatalog({
        explicit: true,
        directory: value,
        catalog: projectStore && { ready: projectStore.provider_ready, providers: projectStore.provider },
      })
    return selectProviderCatalog({
      explicit: false,
      directory: value,
      catalog: projectStore && { ready: projectStore.provider_ready, providers: projectStore.provider },
      global: serverSync().data.provider,
    })
  }
  return {
    // FORK: all() 保持上游 Map(消费者用 .get/.values/.size);getbot 合成项只注入 popular() + provider 弹窗自身 [feat: electron-replatform]
    all: () => providers().all,
    default: () => providers().default,
    // FORK: 上游 providers().all 现为 Map → 先转数组再 withGetbot 注入合成项,过滤热门(popularProviderSet 已含 getbot)[feat: electron-replatform]
    popular: () =>
      withGetbot(pipe(providers().all, Iterable.map(([, p]) => p), (v) => Array.from(v))).filter((p) =>
        popularProviderSet.has(p.id),
      ),
    connected: () => {
      const connected = new Set(providers().connected)
      return pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.filter((p) => connected.has(p.id)),
        (v) => Array.from(v),
      )
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return [
        ...Iterable.filter(
          providers().all,
          ([id]) =>
            connected.has(id) &&
            (id !== "opencode" || Object.values(providers().all.get(id)?.models ?? {}).some((m) => m.cost?.input)),
        ),
      ]
    },
  }
}
