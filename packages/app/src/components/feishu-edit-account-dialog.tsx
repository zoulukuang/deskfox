// FORK: 飞书账号编辑弹窗 — 选 per-account model
// [feat: feishu-bridge] 2026-05-09

import { type Component, createMemo, createSignal, onMount, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Select } from "@opencode-ai/ui/select"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import "./feishu-edit-account-dialog.css"
import { useLanguage } from "@/context/language"
import {
  feishuListProviders,
  feishuPickWorkspaceDir,
  feishuUpdateAccountSettings,
  type ModelRef,
  type ProvidersResponse,
} from "@/utils/feishu-config"
// [feat: feishu-edit-dialog-ux] 2026-06-08 — model 选择纯逻辑(去"跟随默认"勾选,默认自动免费)
import {
  buildModelOptions,
  defaultModelForProvider,
  initialModelSelection,
  isAutoFree,
  toModelPayload,
} from "./feishu-edit-account-model"

export const FeishuEditAccountDialog: Component<{
  accountId: string
  /** [feat: feishu-edit-dialog-ux] 2026-06-08 飞书账号名(标题显示用,便于辨认) */
  botName?: string | null
  currentModel: ModelRef | null | undefined
  // [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25 — 删 currentEnableAutoGroupCreate prop
  /** [feat: feishu-group-mention-policy] 2026-05-24 */
  currentRequireMention?: boolean
  /** [feat: feishu-account-workspace] 2026-06-07 当前 workspace 覆盖值(null = 走全局默认) */
  currentWorkspace?: string | null
  /** [feat: feishu-edit-dialog-ux] 2026-06-08 实际生效的 workspace 绝对路径(空态显示用) */
  currentWorkspaceEffective?: string | null
  onSaved?: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  // [feat: feishu-edit-dialog-ux] 2026-06-08 — 去掉"跟随默认"勾选;首次默认 OpenCode Zen + 自动免费模型
  const init = initialModelSelection(props.currentModel)
  const [providerID, setProviderID] = createSignal(init.providerID)
  const [modelID, setModelID] = createSignal(init.modelID)
  // 标题用的账号标识:有 bot 名则"<名>(id)",否则纯 id
  const accountLabel = () =>
    props.botName?.trim() ? `${props.botName.trim()}(${props.accountId})` : props.accountId
  // [feat: feishu-group-mention-policy] 2026-05-24 默认 true(保守 — 大群只 @ 才响应)
  // [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25
  // GUI 显示语义反转("允许免@ 读取所有信息"),后端 requireMention 字段不变。
  // state 仍存后端字段语义(true=需要@),UI 上 checkbox.checked = !requireMention。
  const [requireMention, setRequireMention] = createSignal(
    props.currentRequireMention ?? true,
  )
  // [feat: feishu-account-workspace] 2026-06-07 — workspace state(空串 = 走全局默认)
  const [workspace, setWorkspace] = createSignal(props.currentWorkspace ?? "")
  const initialWorkspace = props.currentWorkspace ?? ""
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)

  const handlePickWorkspace = async () => {
    try {
      const picked = await feishuPickWorkspaceDir()
      if (picked) setWorkspace(picked)
    } catch (err) {
      setSaveError((err as Error).message ?? String(err))
    }
  }

  // ⚠️ 用 createSignal + 手动 fetch(避开 createResource 触发外层 Suspense fallback 导致整屏闪)
  // 同 file-tabs.tsx:1179 / settings-feishu.tsx 处理方式
  const [providersData, setProvidersData] = createSignal<ProvidersResponse | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string | null>(null)

  onMount(async () => {
    try {
      const data = await feishuListProviders()
      setProvidersData(data)
    } catch (err) {
      setLoadError((err as Error).message ?? String(err))
    } finally {
      setLoading(false)
    }
  })

  const providers = () => providersData()?.providers ?? []
  const currentProvider = () => providers().find((p) => p.id === providerID())
  const currentProviderModels = () => {
    const p = currentProvider()
    if (!p) return []
    return Object.values(p.models)
  }
  const providerOptions = createMemo(() =>
    providers().map((p) => ({ value: p.id, label: p.name || p.id })),
  )
  // [feat: feishu-edit-dialog-ux] 2026-06-08 — OpenCode Zen 置顶"自动免费"选项,其他 provider 不含
  const modelOptions = createMemo(() =>
    buildModelOptions(
      providerID(),
      currentProviderModels(),
      language.t("settings.feishu.edit.autoFreeModel"),
    ),
  )
  // 当前选中是否"自动免费模型"(用于下方 hint)
  const autoFreeSelected = () => isAutoFree(providerID(), modelID())

  const handleProviderChange = (newId: string) => {
    setProviderID(newId)
    // 选 provider 后默认 model:OpenCode Zen → 自动免费;其他 → 第一个真实 model
    const p = providers().find((pp) => pp.id === newId)
    setModelID(defaultModelForProvider(newId, p ? Object.values(p.models) : []))
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      // [feat: feishu-create-group-toggle-gui] 2026-05-24
      // [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25 — 删 enableAutoGroupCreate
      // [feat: feishu-edit-dialog-ux] 2026-06-08 — 始终存下拉里的选择(哨兵 __auto_free__ 也是普通
      // {provider_id, model_id},后端识别;不再有"跟随默认"=null 这条 GUI 路径)
      const modelPayload: ModelRef | null = toModelPayload(providerID(), modelID())
      // [feat: feishu-account-workspace] 2026-06-07 — 仅当 workspace 变化时才发(空串 = 清走默认)
      const workspaceChanged = workspace().trim() !== initialWorkspace.trim()
      await feishuUpdateAccountSettings(props.accountId, {
        model: modelPayload,
        // [feat: feishu-group-mention-policy] 2026-05-24
        requireMention: requireMention(),
        ...(workspaceChanged ? { workspace: workspace().trim() } : {}),
      })
      props.onSaved?.()
      dialog.close()
    } catch (err) {
      setSaveError((err as Error).message ?? String(err))
    } finally {
      setSaving(false)
    }
  }

  const canSave = () => !saving() && !!providerID() && !!modelID()

  return (
    <Dialog
      title={language.t("settings.feishu.edit.title")}
      description={language.t("settings.feishu.edit.description", { account: accountLabel() })}
    >
      {/* [feat: feishu-group-mention-policy] 2026-05-24 hot fix
        * 限制最大高度 + 内容溢出滚动,避免高级能力 hint 文案多 dialog 撑超屏 user
        * 看不到保存按钮。70vh 给 dialog 上下边距留 30vh,主流屏幕都能滚到底。
        */}
      <div class="flex flex-col gap-6 px-5 pb-5 max-h-[70vh] overflow-y-auto">
        <Show
          when={!loading()}
          fallback={
            <p class="text-14-regular text-text-weak py-4">
              {language.t("settings.feishu.bind.qrLoading")}
            </p>
          }
        >
          <Show when={loadError()}>
            <p class="text-14-regular text-text-warning">
              {language.t("settings.feishu.edit.loadFailed", { msg: loadError() ?? "" })}
            </p>
          </Show>

          <Show when={!loadError() && providers().length === 0}>
            <p class="text-14-regular text-text-warning">
              {language.t("settings.feishu.edit.noProviders")}
            </p>
          </Show>

          <Show when={!loadError() && providers().length > 0}>
            <form
              class="flex flex-col items-start gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                void handleSave()
              }}
            >
              {/* 模型 分隔块标题 [feat: feishu-create-group-toggle-gui] 2026-05-24 */}
              <div class="flex items-center gap-2 self-stretch">
                <span class="text-13-medium text-text-weak">
                  {language.t("settings.feishu.edit.modelSectionTitle")}
                </span>
                <div class="flex-1 h-px bg-border-weak" />
              </div>

              {/* [feat: feishu-edit-dialog-ux] 2026-06-08 — 去掉"跟随默认"勾选;首次默认 OpenCode Zen
                * + 自动免费模型,用户直接在下拉里看到默认值,可改可不改 */}
              {/* provider + model — 始终可用 */}
              <div class="flex flex-col gap-3 self-stretch">
                <div class="flex flex-col gap-1.5">
                  <span class="text-13-regular text-text-weak">
                    {language.t("settings.feishu.edit.providerLabel")}
                  </span>
                  <Select
                    class="feishu-edit-select"
                    options={providerOptions()}
                    current={providerOptions().find((o) => o.value === providerID())}
                    value={(o) => o.value}
                    label={(o) => o.label}
                    onSelect={(o) => o && handleProviderChange(o.value)}
                    placeholder={language.t("settings.feishu.edit.providerPlaceholder")}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                    triggerStyle={{ width: "100%" }}
                  />
                </div>

                <div class="flex flex-col gap-1.5">
                  <span
                    class="text-13-regular"
                    classList={{
                      "text-text-weak": !!providerID(),
                      "text-text-weaker": !providerID(),
                    }}
                  >
                    {language.t("settings.feishu.edit.modelLabel")}
                  </span>
                  <Select
                    class="feishu-edit-select"
                    options={modelOptions()}
                    current={modelOptions().find((o) => o.value === modelID())}
                    value={(o) => o.value}
                    label={(o) => o.label}
                    onSelect={(o) => o && setModelID(o.value)}
                    placeholder={language.t("settings.feishu.edit.modelPlaceholder")}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                    triggerStyle={{ width: "100%" }}
                    disabled={!providerID()}
                  />
                  {/* 自动免费模型说明 — 仅选中时显示一行,非技术用户也懂 */}
                  <Show when={autoFreeSelected()}>
                    <p class="text-12-regular text-text-weak">
                      {language.t("settings.feishu.edit.autoFreeModel.hint")}
                    </p>
                  </Show>
                </div>
              </div>

              {/* FORK: 工作目录区域整体上移到「高级能力」之上 [feat: feishu-settings-workspace-above-advanced] 2026-06-09 */}
              {/* 工作目录 分隔块 [feat: feishu-account-workspace] 2026-06-07 */}
              <div class="flex items-center gap-2 self-stretch">
                <span class="text-13-medium text-text-weak">
                  {language.t("settings.feishu.edit.workspaceSectionTitle")}
                </span>
                <div class="flex-1 h-px bg-border-weak" />
              </div>

              <div class="flex flex-col gap-2 self-stretch">
                {/* 当前值 + 选择/恢复默认 */}
                <div class="flex items-center gap-2">
                  <span
                    class="text-13-regular flex-1 truncate"
                    classList={{
                      "text-text-weak": !!workspace().trim(),
                      "text-text-weaker": !workspace().trim(),
                    }}
                    title={workspace().trim() || props.currentWorkspaceEffective || undefined}
                  >
                    {/* [feat: feishu-edit-dialog-ux] 2026-06-08 — 空态显示真实默认绝对路径而非抽象字样 */}
                    {workspace().trim() ||
                      (props.currentWorkspaceEffective
                        ? language.t("settings.feishu.edit.workspace.defaultPath", {
                            path: props.currentWorkspaceEffective,
                          })
                        : language.t("settings.feishu.edit.workspace.default"))}
                  </span>
                  <Button
                    class="w-auto shrink-0"
                    type="button"
                    size="small"
                    variant="secondary"
                    onClick={() => void handlePickWorkspace()}
                  >
                    {language.t("settings.feishu.edit.workspace.pick")}
                  </Button>
                  <Show when={!!workspace().trim()}>
                    <Button
                      class="w-auto shrink-0"
                      type="button"
                      size="small"
                      variant="secondary"
                      onClick={() => setWorkspace("")}
                    >
                      {language.t("settings.feishu.edit.workspace.clear")}
                    </Button>
                  </Show>
                </div>
                {/* P4 提示:对话记忆跟着目录走 */}
                <p class="text-13-regular text-text-weak">
                  {language.t("settings.feishu.edit.workspace.hintFollow")}
                </p>
                {/* [feat: feishu-session-project-visibility] REQ-086 — 未设项目目录 = 会话不进
                  * 桌面项目列表,显著提示引导设置(存量无 workspace 账号不自动迁移,靠这条引导)*/}
                <Show when={!workspace().trim()}>
                  <p class="text-13-regular text-text-warning">
                    {language.t("settings.feishu.edit.workspace.projectListWarning")}
                  </p>
                </Show>
                {/* A1 安全提示:仅当设了真实项目目录时显示 */}
                <Show when={!!workspace().trim()}>
                  <p class="text-13-regular text-text-warning">
                    {language.t("settings.feishu.edit.workspace.security")}
                  </p>
                </Show>
              </div>

              {/* 高级能力 分隔块 [feat: feishu-create-group-toggle-gui] 2026-05-24 */}
              <div class="flex items-center gap-2 self-stretch">
                <span class="text-13-medium text-text-weak">
                  {language.t("settings.feishu.edit.advancedSectionTitle")}
                </span>
                <div class="flex-1 h-px bg-border-weak" />
              </div>

              {/* /group 命令用法说明 [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25 */}
              {/* 替换了旧的"允许 AI 自动创建新群" checkbox — flag 已删,建群统一走 user 显式 /group */}
              <div class="flex flex-col gap-1 self-stretch">
                <p class="text-13-regular text-text-weak">
                  {language.t("settings.feishu.edit.groupCommand.info")}
                </p>
              </div>

              {/* 允许 AI 免@ 读取群里所有信息 [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25 */}
              {/* GUI 语义反转 — checkbox.checked = !requireMention,save 时 set 回 requireMention */}
              <div class="flex flex-col gap-1 self-stretch">
                <label class="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!requireMention()}
                    onChange={(e) => setRequireMention(!e.currentTarget.checked)}
                  />
                  <span class="text-14-medium">
                    {language.t("settings.feishu.edit.allowReadAll.label")}
                  </span>
                </label>
                <p class="text-13-regular text-text-weak pl-6">
                  {language.t("settings.feishu.edit.allowReadAll.hint")}
                </p>
              </div>

              {/* error */}
              <Show when={saveError()}>
                <p class="text-14-regular text-text-warning">{saveError()}</p>
              </Show>

              {/* primary action — 左对齐,跟 dialog-connect-provider 一致 */}
              <Button
                class="w-auto"
                type="submit"
                size="large"
                variant="primary"
                disabled={!canSave()}
              >
                {saving()
                  ? language.t("settings.feishu.edit.saving")
                  : language.t("settings.feishu.edit.save")}
              </Button>
            </form>
          </Show>
        </Show>
      </div>
    </Dialog>
  )
}
