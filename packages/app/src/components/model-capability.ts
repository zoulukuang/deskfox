// FORK: REQ-026 模型能力三态判定(纯逻辑,Logic 清单)
// [feat: model-capability-ui] 2026-08-02
//
// 供粘贴/拖图前端拦截使用。三态语义:
//   true  = 明确支持;false = 明确不支持(才拦截);
//   "unknown" = 拿不到模型或字段全缺 → 保守放行(后端 ERROR 文本仍是兜底)。
// 注:选择器徽标已撤(挤爆行宽,user 2026-08-02 拍板),tools/reasoning 判定随之删除;
// 如需恢复从本 feat 的首版 commit(ce948764fd)取回。

export type CapabilityModelLike =
  | {
      capabilities?: { input?: { image?: boolean } }
      modalities?: { input?: string[] }
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
