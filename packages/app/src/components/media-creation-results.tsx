// [fork-only] 创作模式结果区:渲染生成卡片(进行中/图片/视频/音频/文字/失败)
// [feat: media-creation-mode] 2026-05-26
// 结果本地渲染(不写入 opencode session,§8.2);OSS 链接公网可访问,CSP 已 null 直接加载。

import { For, Show } from "solid-js"
import { creation } from "./media-creation-store"

export function MediaCreationResults() {
  return (
    <Show when={creation.cards.length > 0}>
      <div class="flex flex-col gap-2 pb-2">
        <For each={creation.cards}>
          {(card) => (
            <div class="rounded-[10px] border border-border-weak-base bg-background-base p-3">
              <div class="text-13-medium text-text-weak mb-2">
                {card.modelName} ·{" "}
                {card.status === "running"
                  ? (card.progress ?? "生成中…")
                  : card.status === "error"
                    ? "失败"
                    : "完成"}
              </div>
              <Show when={card.status === "error"}>
                <div class="text-13-regular text-text-base">{card.error}</div>
              </Show>
              <Show when={card.result?.kind === "image"}>
                <div class="flex flex-wrap gap-2">
                  <For each={card.result?.urls ?? []}>
                    {(u) => <img src={u} alt="" class="max-w-[220px] rounded-md" />}
                  </For>
                </div>
              </Show>
              <Show when={card.result?.kind === "video"}>
                <video src={card.result?.url} controls class="max-w-[360px] rounded-md" />
              </Show>
              <Show when={card.result?.kind === "audio"}>
                <audio src={card.result?.url} controls />
              </Show>
              <Show when={card.result?.kind === "text"}>
                <div class="text-14-regular text-text-base whitespace-pre-wrap">{card.result?.text}</div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
