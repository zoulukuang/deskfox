import { createMemo, For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { DeskFoxWordmark } from "@/components/deskfox-wordmark"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { usePlatform } from "@/context/platform"
import { DateTime } from "luxon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const homedir = createMemo(() => sync.data.path.home)
  const recent = createMemo(() => {
    return sync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })

  const serverDotClass = createMemo(() => {
    const healthy = server.healthy()
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  function openProject(directory: string) {
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory)
        }
      } else if (result) {
        openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  return (
    <div class="mx-auto mt-55 w-full md:w-[552px] px-4 flex flex-col items-center">
      {/* FORK-BEGIN: 首页品牌化改造 — DeskFox wordmark + 常驻欢迎引导 + 钢蓝 CTA,
          有无最近项目都常驻显示(对齐 onboarding 稿) 2026-06-09 */}
      <DeskFoxWordmark class="block w-60 mx-auto opacity-50" />
      <Button
        size="large"
        variant="ghost"
        class="mt-4 mx-auto text-14-regular text-text-weak"
        onClick={() => dialog.show(() => <DialogSelectServer />)}
      >
        <div
          classList={{
            "size-2 rounded-full": true,
            [serverDotClass()]: true,
          }}
        />
        {server.name}
      </Button>
      <div class="mt-8 mx-auto flex flex-col items-center gap-2 text-center">
        <div class="text-20-medium deskfox-home-title">{language.t("home.welcome.title")}</div>
        <div class="text-14-regular text-text-weak">{language.t("home.welcome.description")}</div>
      </div>
      <Button
        size="large"
        variant="primary"
        icon="folder-add-left"
        class="deskfox-cta mt-[26px] mx-auto"
        onClick={chooseProject}
      >
        {language.t("home.welcome.open")}
      </Button>
      {/* FORK-END */}
      <Show when={sync.data.project.length > 0}>
        {/* FORK: 「最近项目」列表 — 引导/打开入口已上移常驻,此处去掉重复的「打开项目」头部按钮,只留标题+列表 2026-06-09 */}
        <div class="mt-18 w-full flex flex-col gap-4">
          <div class="text-14-medium text-text-strong pl-3">{language.t("home.recentProjects")}</div>
          <ul class="flex flex-col gap-2">
            <For each={recent()}>
              {(project) => (
                <Button
                  size="large"
                  variant="ghost"
                  class="text-14-mono text-left justify-between px-3"
                  onClick={() => openProject(project.worktree)}
                >
                  {project.worktree.replace(homedir(), "~")}
                  <div class="text-14-regular text-text-weak">
                    {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                  </div>
                </Button>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  )
}
