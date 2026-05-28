// [fork-only] media-gen — 小米 MiMo 共享错误处理 + 类型
// [feat: media-gen-xiaomi] 2026-05-28
//
// 小米 MiMo API 走 OpenAI chat completions 兼容,错误形态是 { error: { code, message, param, type } }
// (跟 dashscope HTTP+code / minimax base_resp.status_code 都不一样)
// 4 个引擎(tts / tts-clone / tts-design / asr)共用此模块解析+友好提示。
//
// auth 头注意:小米用 "api-key: <key>",不是 "Authorization: Bearer <key>"(probe 阶段实测确认)

// Token Plan 套餐 base URL(user 的 tp- key 走这条);env 可改成 api.xiaomimimo.com 按量计费 base
export const XIAOMI_BASE = process.env.XIAOMI_BASE || "https://token-plan-cn.xiaomimimo.com/v1"

/** 归一化后的、带中文用户文案的错误 */
export class XiaomiError extends Error {
  constructor(
    public code: string,
    public friendly: string,
    public raw?: unknown,
    public param?: string,
  ) {
    super(friendly)
    this.name = "XiaomiError"
  }
}

/**
 * 已知 error.code / error.message 关键词 → 友好文案
 * 小米 error.code 是字符串("400" / "401" / "429" / 业务码)
 */
const PARAM_HINTS: Record<string, string> = {
  // probe 实测踩到的两条 — 用户应该看不到(adapter 内部规避),但留兜底防止 prompt 异常
  "audio.voice is not supported for voice design model":
    "VoiceDesign 模型不支持指定预设音色,声线由 user 描述决定。这条本不该外泄,如果看到请反馈。",
  "audio.voice must be a DataURL for voice clone model":
    "VoiceClone 的参考音频格式不对,需要 DataURL(data:audio/wav;base64,...)。adapter 应已自动构造。",
  "Not supported model": "该模型未在 Token Plan 暴露(可能已下线或仅按量计费),请换模型或检查套餐。",
}

/**
 * 提取小米 error 字段并翻译。优先匹配 param 文本(更具体),回落到 code。
 */
function translateXiaomiError(code: string, msg?: string, param?: string): string {
  // 先按 param 关键词命中(优先级最高,因为 message 都叫 "Param Incorrect")
  if (param) {
    for (const [key, hint] of Object.entries(PARAM_HINTS)) {
      if (param.includes(key)) return hint
    }
  }
  // 通用 HTTP / 业务码
  if (code === "401" || code === "403") return "小米 MiMo API Key 鉴权失败,确认 auth.json 里 `xiaomi-token-plan-cn` 的 key 还有效。"
  if (code === "429") return "调用频率超限(RPM 100 / TPM 10M 上限),请稍后重试。"
  if (msg?.includes("quota") || msg?.includes("额度")) return "Token Plan 额度耗尽,请等套餐重置或升级。"
  if (msg?.includes("audio") && msg?.includes("size")) return "音频文件过大(VoiceClone DataURL 上限 10MB,建议参考音频 < 7MB)。"
  if (msg?.includes("text") && msg?.includes("long")) return "文本过长,请精简后重试。"
  return `小米 MiMo 返回错误(${code})${msg ? ": " + msg : ""}${param ? ` [param: ${param}]` : ""}`
}

export async function readJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

/**
 * 检查 OpenAI 兼容 error 字段。无 error 则 OK 返回 void,否则抛 XiaomiError。
 * 不依赖 HTTP status(业务错误也常是 HTTP 200 或 400 但 body 同形)。
 */
export function checkErrorResp(json: any): void {
  const err = json?.error
  if (!err) return
  const code = String(err.code ?? "unknown")
  const msg = typeof err.message === "string" ? err.message : undefined
  const param = typeof err.param === "string" ? err.param : undefined
  throw new XiaomiError(code, translateXiaomiError(code, msg, param), json, param)
}

/** HTTP 层失败:401/403 → auth / 429 → rate / 其他给原始 status */
export function httpError(status: number, body: any): XiaomiError {
  // 优先看 body.error(很多时候 HTTP 400 也带详细 error)
  if (body?.error) {
    const code = String(body.error.code ?? status)
    const msg = body.error.message
    const param = body.error.param
    return new XiaomiError(code, translateXiaomiError(code, msg, param), body, param)
  }
  if (status === 401 || status === 403)
    return new XiaomiError("auth_failed", "小米 MiMo API Key 无效或无权限,请检查 xiaomi-token-plan-cn 配置。", body)
  if (status === 429) return new XiaomiError("rate_limit", "调用频率超限,请稍后重试。", body)
  return new XiaomiError(`http_${status}`, `小米 MiMo HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`, body)
}
