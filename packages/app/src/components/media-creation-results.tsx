// [fork-only] 创作模式结果区:轻量卡片(提示词 + 输入缩略图 + 小结果 + 已保存路径 + 打开)
// [feat: media-creation-mode] 2026-05-27
// 重构:不再用占满屏的大播放器;文件已落盘到本地分类文件夹,这里只给轻量提示 + 打开入口。

import { For, Show, createEffect } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import { creation } from "./media-creation-store"

const openFile = (p: string) => void invoke("open_path", { path: p, appName: null }).catch(() => {})
const revealFolder = (p: string) => void invoke("reveal_in_folder", { path: p }).catch(() => {})

export function MediaCreationResults() {
  let scroller: HTMLDivElement | undefined
  createEffect(() => {
    creation.cards.length
    requestAnimationFrame(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    })
  })
  return (
    <Show when={creation.cards.length > 0}>
      <div ref={scroller} class="flex flex-col gap-2 pb-2 max-h-[50vh] overflow-y-auto">
        <For each={creation.cards}>
          {(card) => (
            <div class="rounded-[10px] border border-border-weak-base bg-background-base p-3">
              <div class="text-13-medium text-text-weak mb-1.5">
                {card.modelName} ·{" "}
                {card.status === "running"
                  ? (card.progress ?? "生成中…")
                  : card.status === "error"
                    ? "失败"
                    : "完成"}
              </div>

              {/* 用户提示词 */}
              <Show when={card.prompt}>
                <div class="text-13-regular text-text-base mb-1.5 whitespace-pre-wrap">{card.prompt}</div>
              </Show>

              {/* 输入参考图缩略图(如有)*/}
              <Show when={card.inputThumb}>
                <img src={card.inputThumb} alt="" class="max-h-16 rounded mb-1.5 border border-border-weak-base" />
              </Show>

              <Show when={card.status === "error"}>
                <div class="text-13-regular text-text-base">{card.error}</div>
              </Show>

              <Show when={card.status === "done" && card.result}>
                {/* 结果(小尺寸省空间;完整看用"打开")*/}
                <Show when={card.result?.kind === "image"}>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={card.result?.urls ?? []}>
                      {(u) => <img src={u} alt="" class="max-h-32 rounded" />}
                    </For>
                  </div>
                </Show>
                <Show when={card.result?.kind === "video"}>
                  <video src={card.result?.url} controls class="max-h-40 rounded" />
                </Show>
                <Show when={card.result?.kind === "audio"}>
                  <audio src={card.result?.url} controls class="w-full" />
                </Show>
                <Show when={card.result?.kind === "text"}>
                  <div class="text-14-regular text-text-base whitespace-pre-wrap">{card.result?.text}</div>
                </Show>

                {/* 已保存路径 + 打开入口 */}
                <Show when={(card.result?.localPaths?.length ?? 0) > 0}>
                  <div class="flex items-center gap-2 mt-2 text-12-regular text-text-weak">
                    <span class="truncate flex-1">已保存:{card.result?.localPaths?.[0]}</span>
                    <button
                      class="shrink-0 text-text-interactive-base hover:underline"
                      onClick={() => openFile(card.result!.localPaths![0]!)}
                    >
                      打开
                    </button>
                    <button
                      class="shrink-0 text-text-interactive-base hover:underline"
                      onClick={() => revealFolder(card.result!.localPaths![0]!)}
                    >
                      文件夹
                    </button>
                  </div>
                </Show>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
