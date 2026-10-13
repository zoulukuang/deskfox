import { useI18n } from "@opencode-ai/ui/context/i18n"
import { shareBrand } from "@opencode-ai/branding/share"

const copy = {
  en: {
    title: "This share is unavailable",
    description: "It may have been removed or the link may be incorrect.",
    home: "Return to home",
  },
  zh: { title: "此分享不可用", description: "分享可能已被删除，或链接有误。", home: "返回首页" },
}

export default function ShareNotFound() {
  const i18n = useI18n()
  const text = () => (i18n.locale().startsWith("zh") ? copy.zh : copy.en)
  return (
    <main class="mx-auto max-w-xl p-8 text-center">
      <h1 class="text-24-medium my-8">{text().title}</h1>
      <p>{text().description}</p>
      <a class="block my-8 underline" href={shareBrand.home}>
        {text().home}
      </a>
    </main>
  )
}
