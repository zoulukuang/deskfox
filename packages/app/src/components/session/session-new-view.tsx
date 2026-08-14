import { Show, createMemo } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { Icon } from "@opencode-ai/ui/icon"
// FORK: 直接从 branding 包 import 以拿到 variant prop 的类型 2026-04-26
import { Mark } from "@opencode-ai/branding/logo"
// FORK: 跟上游 shared → core rename 走 2026-05-03
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
// FORK: 创作结果卡在首页(无 session)也要显示 —— 否则创作模式在首页生成成功后,
// 卡片只 push 进模块级 store 却无处渲染(MediaCreationResults 原本只挂在 session 的
// message-timeline 里),用户要先发一句 chat 建出 session 才看到。[feat: media-creation-mode]
import { creation } from "@/components/media-creation-store"
import { MediaCreationResults } from "@/components/media-creation-results"

const MAIN_WORKTREE = "main"
const CREATE_WORKTREE = "create"
const ROOT_CLASS = "size-full flex flex-col"

interface NewSessionViewProps {
  worktree: string
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()

  const sandboxes = createMemo(() => sync().project?.sandboxes ?? [])
  const options = createMemo(() => [MAIN_WORKTREE, ...sandboxes(), CREATE_WORKTREE])
  const current = createMemo(() => {
    const selection = props.worktree
    if (options().includes(selection)) return selection
    return MAIN_WORKTREE
  })
  const projectRoot = createMemo(() => sync().project?.worktree ?? sdk().directory)
  const isWorktree = createMemo(() => {
    const project = sync().project
    if (!project) return false
    return sdk().directory !== project.worktree
  })

  const label = (value: string) => {
    if (value === MAIN_WORKTREE) {
      if (isWorktree()) return language.t("session.new.worktree.main")
      const branch = sync().data.vcs?.branch
      if (branch) return language.t("session.new.worktree.mainWithBranch", { branch })
      return language.t("session.new.worktree.main")
    }

    if (value === CREATE_WORKTREE) return language.t("session.new.worktree.create")

    return getFilename(value)
  }

  return (
    <div class={ROOT_CLASS}>
      <div class="h-12 shrink-0" aria-hidden />
      {/* FORK: 有创作卡时改顶对齐 + 可滚动(否则 justify-center 会把溢出内容两端裁掉);
          无卡时维持原居中 hero 布局。[feat: media-creation-mode] */}
      <div
        class="flex-1 min-h-0 px-6 pb-30 overflow-y-auto flex flex-col items-center text-center"
        classList={{ "justify-center": creation.cards().length === 0 }}
      >
        <div class="w-full max-w-200 flex flex-col items-center text-center gap-4">
          <div class="flex flex-col items-center gap-6">
            {/* FORK: DeskFox branded variant + 加大 2x 2026-04-26 */}
            <Mark variant="branded" class="w-20" />
            <div class="text-20-medium text-text-strong">{language.t("session.new.title")}</div>
          </div>
          <div class="w-full flex flex-col gap-4 items-center">
            <div class="flex items-start justify-center gap-3 min-h-5">
              <div class="text-12-medium text-text-weak select-text leading-5 min-w-0 max-w-160 break-words text-center">
                {getDirectory(projectRoot())}
                <span class="text-text-strong">{getFilename(projectRoot())}</span>
              </div>
            </div>
            <div class="flex items-start justify-center gap-1.5 min-h-5">
              <Icon name="branch" size="small" class="mt-0.5 shrink-0" />
              <div class="text-12-medium text-text-weak select-text leading-5 min-w-0 max-w-160 break-words text-center">
                {label(current())}
              </div>
            </div>
            <Show when={sync().project}>
              {(project) => (
                <div class="flex items-start justify-center gap-3 min-h-5">
                  <div class="text-12-medium text-text-weak leading-5 min-w-0 max-w-160 break-words text-center">
                    {language.t("session.new.lastModified")}&nbsp;
                    <span class="text-text-strong">
                      {DateTime.fromMillis(project().time.updated ?? project().time.created)
                        .setLocale(language.intl())
                        .toRelative()}
                    </span>
                  </div>
                </div>
              )}
            </Show>
          </div>
        </div>
        {/* FORK: 创作结果卡(首页/无 session 场景);session 内由 message-timeline 渲染同一份 store */}
        <Show when={creation.cards().length > 0}>
          <div class="w-full max-w-200 mt-6 text-left">
            <MediaCreationResults />
          </div>
        </Show>
      </div>
    </div>
  )
}
