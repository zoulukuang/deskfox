// FORK: 飞书账号编辑弹窗 — model 选择纯逻辑(Logic 清单,可单测)
// [feat: feishu-edit-dialog-ux] 2026-06-08
//
// 把弹窗里的"初始选择 / 下拉选项 / 保存 payload / 切换默认"四段纯逻辑抽出来,组件只剩 view。

import type { ModelRef } from "@/utils/feishu-config"

/**
 * "自动免费模型"哨兵 —— **必须与 adapter message-pipeline.ts 的 AUTO_FREE_PROVIDER / AUTO_FREE_MODEL_ID 同值**。
 * account.model 存 { provider_id:"opencode", model_id:"__auto_free__" } 表示:永远用 OpenCode Zen
 * 当下第一个免费模型(后端发请求前实时解析,opencode 换了免费模型也自动跟上)。
 */
export const AUTO_FREE_PROVIDER_ID = "opencode"
export const AUTO_FREE_MODEL_ID = "__auto_free__"

export interface SelectOption {
  value: string
  label: string
}

/** 该选择是否为"自动免费模型"哨兵 */
export function isAutoFree(providerID: string, modelID: string): boolean {
  return providerID === AUTO_FREE_PROVIDER_ID && modelID === AUTO_FREE_MODEL_ID
}

/**
 * 弹窗打开时的初始 provider/model 选择:
 * - 未设(null/undefined,首次进入)→ 默认 OpenCode Zen + 自动免费
 * - 已设(含哨兵 / 具体 model)→ 原样回显
 */
export function initialModelSelection(current: ModelRef | null | undefined): {
  providerID: string
  modelID: string
} {
  if (current?.provider_id && current?.model_id) {
    return { providerID: current.provider_id, modelID: current.model_id }
  }
  return { providerID: AUTO_FREE_PROVIDER_ID, modelID: AUTO_FREE_MODEL_ID }
}

/**
 * 模型下拉选项:OpenCode Zen 在真实模型前置顶"自动免费"选项;其他 provider 不含自动。
 */
export function buildModelOptions(
  providerID: string,
  models: Array<{ id: string; name?: string }>,
  autoLabel: string,
): SelectOption[] {
  const real = models.map((m) => ({ value: m.id, label: m.name || m.id }))
  if (providerID === AUTO_FREE_PROVIDER_ID) {
    return [{ value: AUTO_FREE_MODEL_ID, label: autoLabel }, ...real]
  }
  return real
}

/** 切换 provider 时的默认 model:opencode → 自动免费;其他 → 第一个真实 model。 */
export function defaultModelForProvider(
  providerID: string,
  models: Array<{ id: string }>,
): string {
  if (providerID === AUTO_FREE_PROVIDER_ID) return AUTO_FREE_MODEL_ID
  return models[0]?.id ?? ""
}

/** 保存 payload:哨兵也是普通 { provider_id, model_id },后端识别。 */
export function toModelPayload(providerID: string, modelID: string): ModelRef {
  return { provider_id: providerID, model_id: modelID }
}
