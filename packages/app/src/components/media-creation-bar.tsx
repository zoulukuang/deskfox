// [fork-only] 创作模式工具栏组件:模式菜单(右)+ 生成模型下拉(左,随模式出现)
// [feat: media-creation-mode] 2026-05-26
// 复用 opencode 现成的 <Select>(跟 agent/model 同款),零自创样式;措辞/i18n 后调。

import { Show } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { creation, type MediaCapability, type MediaModel } from "./media-creation-store"

type ModeOpt = { value: MediaCapability | "chat"; label: string }

/** 底部工具栏最右:统一模式菜单(Chat + 各创作能力)*/
export function MediaModeMenu() {
  const options = (): ModeOpt[] => [
    { value: "chat", label: "Chat" },
    ...creation.availableModes().map((m) => ({ value: m.capability, label: m.label })),
  ]
  const current = (): ModeOpt => {
    const key = creation.createMode() ?? "chat"
    return options().find((o) => o.value === key) ?? { value: "chat", label: "Chat" }
  }
  return (
    <Select<ModeOpt>
      size="normal"
      variant="ghost"
      options={options()}
      current={current()}
      value={(o) => o.value}
      label={(o) => o.label}
      onSelect={(o) => creation.setMode(!o || o.value === "chat" ? null : o.value)}
      class="text-13-regular text-text-base media-mode-select"
      triggerProps={{ "data-action": "media-mode" }}
    />
  )
}

/** 创作模式左侧:当前能力的生成模型下拉(替代 agent/model)*/
export function MediaCreationControls() {
  return (
    <Show when={creation.createMode()}>
      {(cap) => (
        <>
          <Select<MediaModel>
            size="normal"
            variant="ghost"
            options={creation.modelsFor(cap())}
            current={creation.selectedModel(cap())}
            value={(m) => m.id}
            label={(m) => m.model}
            onSelect={(m) => m && creation.selectModel(cap(), m.id)}
            class="text-13-regular text-text-base max-w-[260px]"
            triggerProps={{ "data-action": "media-model" }}
          />
          {/* 音色选择(仅语音合成等带 voices 的模型出现)*/}
          <Show when={(creation.selectedModel(cap())?.params?.voices?.length ?? 0) > 0}>
            <Select<string>
              size="normal"
              variant="ghost"
              options={creation.selectedModel(cap())?.params?.voices ?? []}
              current={creation.currentVoice(cap())}
              onSelect={(v) => v && creation.setVoice(v)}
              class="text-13-regular text-text-base"
              triggerProps={{ "data-action": "media-voice" }}
            />
          </Show>
          {/* FORK: VoiceDesign 声线描述输入框(仅 tts_design 模型出现)[feat: media-gen-xiaomi] 2026-05-28 */}
          <Show when={creation.selectedModel(cap())?.params?.voiceDesignHint}>
            <input
              type="text"
              value={creation.voiceDesignHint()}
              onInput={(e) => creation.setVoiceDesignHint(e.currentTarget.value)}
              placeholder="声线描述(例:中年男声沉稳)"
              data-action="media-voice-design-hint"
              class="text-13-regular text-text-base bg-transparent border border-border-weak-base rounded-md px-2 py-1 max-w-[260px] focus:outline-none focus:border-border-strong-base"
            />
          </Show>
        </>
      )}
    </Show>
  )
}
