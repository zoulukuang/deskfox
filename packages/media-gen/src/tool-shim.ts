// [fork-only] media-gen — 本地 tool() 替身
// [feat: media-gen-alibaba] 2026-05-26
//
// 为什么不直接用 @opencode-ai/plugin 的 tool:它的值导入会把 `effect`(巨大)拖进 bundle。
// 官方 tool() 本质就是 `return input` + `tool.schema = z`,这里等价复刻,
// 类型用 type-only import(编译期擦除,不进 bundle)。结构上与 ToolDefinition 兼容。

import { z } from "zod"
import type { ToolContext } from "@opencode-ai/plugin"

type Shape = Record<string, z.ZodTypeAny>
export type ToolResult = string | { output: string; metadata?: Record<string, unknown> }

export function tool<A extends Shape>(input: {
  description: string
  args: A
  execute: (args: z.infer<z.ZodObject<A>>, ctx: ToolContext) => Promise<ToolResult>
}) {
  return input
}
tool.schema = z
