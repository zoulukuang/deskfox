import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, Show, createMemo, splitProps } from "solid-js"
import { Icon, type IconProps } from "./icon"
import "./button-v2.css"

export interface ButtonV2Props
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  size?: "small" | "normal" | "large"
  variant?: "neutral" | "contrast" | "ghost" | "ghost-muted"
  icon?: IconProps["name"]
}

export function ButtonV2(props: ButtonV2Props) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList"])
  // FORK: REQ-054 — 允许外部传入 data-component 覆盖默认值,否则硬编码会使锚点选择器失效 2026-06-18
  // splitProps 先抽出 "data-component";若调用方传了就用传入值,否则回落到默认 "button-v2"。
  const [dataAttrs, restWithoutData] = splitProps(rest, ["data-component" as keyof typeof rest])
  const resolvedIcon = createMemo(() => split.icon)
  return (
    <Kobalte
      {...restWithoutData}
      data-component={(dataAttrs as { "data-component"?: string })["data-component"] ?? "button-v2"}
      data-size={split.size || "normal"}
      data-variant={split.variant || "neutral"}
      data-icon={resolvedIcon()}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Show when={resolvedIcon()}>
        <Icon name={resolvedIcon()!} />
      </Show>
      {props.children}
    </Kobalte>
  )
}
