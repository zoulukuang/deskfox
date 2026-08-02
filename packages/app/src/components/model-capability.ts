// FORK: REQ-026 模型能力三态判定(纯逻辑,Logic 清单)
// [feat: model-capability-ui] 2026-08-02
//
// 供 ② 粘贴/拖图前端拦截 + ③ 模型选择器徽标共用。三态语义:
//   true  = 明确支持;false = 明确不支持(才拦截/不亮徽标);
//   "unknown" = 拿不到模型或字段全缺 → 保守放行(后端 ERROR 文本仍是兜底),徽标不显示。

export type CapabilityModelLike =
  | {
      capabilities?: {
        input?: { image?: boolean }
        toolcall?: boolean
        reasoning?: boolean
      }
      modalities?: { input?: string[] }
      tool_call?: boolean
      reasoning?: boolean
    }
  | null
  | undefined

export type CapabilityAnswer = boolean | "unknown"

export function modelSupportsImage(model: CapabilityModelLike): CapabilityAnswer {
  if (!model) return "unknown"
  const cap = model.capabilities?.input?.image
  if (cap !== undefined) return cap
  const raw = model.modalities?.input
  if (raw) return raw.includes("image")
  return "unknown"
}

export function modelSupportsTools(model: CapabilityModelLike): CapabilityAnswer {
  if (!model) return "unknown"
  const cap = model.capabilities?.toolcall
  if (cap !== undefined) return cap
  if (model.tool_call !== undefined) return model.tool_call
  return "unknown"
}

export function modelSupportsReasoning(model: CapabilityModelLike): CapabilityAnswer {
  if (!model) return "unknown"
  const cap = model.capabilities?.reasoning
  if (cap !== undefined) return cap
  if (model.reasoning !== undefined) return model.reasoning
  return "unknown"
}
