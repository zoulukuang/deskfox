// FORK-ONLY: REQ-102 语音派活顶部栏入口 [feat: voice-dispatch-minimal] 2026-08-21
//
// 点一下起 Gateway、再点一下停;状态从主进程拿(进程与 DASHSCOPE key 都不过 renderer)。
// 判定逻辑在 @/utils/voice-dispatch(纯函数可单测),本组件只负责取状态 + 渲染 + 触发。
//
// 交互契约(1-spec §4·S3):
//   · 未安装 qwen-audio-agent → **按钮禁用 + tooltip 说清装法**,不能点了没反应
//   · 没开项目 / 项目不是 git 仓库根 → 同上(R3 护栏:语音会以全开权限改真文件)
//   · 起停过程中禁用,避免连点起两个 Gateway
import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { invoke, isDesktopApp } from "@/utils/native"
import { useLanguage } from "@/context/language"
import { isBusy, nextAction, tooltipKey, type VoiceStatus } from "@/utils/voice-dispatch"

export function VoiceDispatchButton(props: { directory?: string }) {
  const language = useLanguage()
  const [status, setStatus] = createSignal<VoiceStatus>({ state: "off", detail: "" })
  const [pending, setPending] = createSignal(false)

  const refresh = async () => {
    try {
      setStatus(await invoke<VoiceStatus>("voice_status", { workspace: props.directory ?? "" }))
    } catch {
      // 拿不到状态就保持原样 —— 入口是锦上添花,不该因它报错影响标题栏
    }
  }

  onMount(() => {
    if (!isDesktopApp()) return
    void invoke<{ ready: boolean; issue: string }>("voice_probe").then(refresh).catch(refresh)
    // 起停是秒级的,轮询够用;等 S3 之后要更实时再上事件推送
    const timer = setInterval(() => void refresh(), 5000)
    onCleanup(() => clearInterval(timer))
  })

  const toggle = async () => {
    if (pending()) return
    setPending(true)
    try {
      const action = nextAction(status())
      if (action === "start") setStatus(await invoke<VoiceStatus>("voice_start", { workspace: props.directory ?? "" }))
      else if (action === "stop") setStatus(await invoke<VoiceStatus>("voice_stop"))
    } catch (e) {
      setStatus({ state: "error", detail: String((e as { message?: string })?.message ?? e) })
    } finally {
      setPending(false)
    }
  }

  return (
    <Show when={isDesktopApp()}>
      <Tooltip
        placement="bottom"
        openDelay={400}
        value={`${language.t(tooltipKey(status()))}${status().detail ? ` — ${status().detail}` : ""}`}
      >
        <Button
          variant="ghost"
          class="titlebar-icon w-8 h-6 p-0 box-border shrink-0 mr-1 [app-region:no-drag]"
          disabled={nextAction(status()) === "none" || pending() || isBusy(status())}
          aria-label={language.t(tooltipKey(status()))}
          data-voice-state={status().state}
          onClick={() => void toggle()}
        >
          {/* 内联 SVG 而不是走 @opencode-ai/ui 的 Icon:图标集里没有麦克风,而 packages/ui/ 在
              黑名单里 —— 为一个图标花一笔 R4 override 不值。20x20 viewBox / currentColor
              与 Icon 的既有约定保持一致,视觉上跟隔壁终端图标同一套。 */}
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 2.5C8.9 2.5 8 3.4 8 4.5V10c0 1.1.9 2 2 2s2-.9 2-2V4.5c0-1.1-.9-2-2-2Z"
              stroke="currentColor"
              stroke-linecap="square"
            />
            <path d="M5 9.5v.5a5 5 0 0 0 10 0v-.5M10 15v2.5M7 17.5h6" stroke="currentColor" stroke-linecap="square" />
            <Show when={status().state !== "on"}>
              <path d="M3.5 3.5l13 13" stroke="currentColor" stroke-linecap="square" />
            </Show>
          </svg>
        </Button>
      </Tooltip>
    </Show>
  )
}
