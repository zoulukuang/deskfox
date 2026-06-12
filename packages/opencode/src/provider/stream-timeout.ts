// FORK-ONLY: llm-stream-idle-timeout [feat: llm-stream-idle-timeout] 2026-06-11
//
// 直连 provider 的 LLM 流式请求默认没有任何超时:SSE 流挂死(NAT/LB/中间盒静默丢
// 连接,两端均无感知)时请求永久悬挂 → 会话永久"思考中",留下 tokens.output=0 残骸。
// 上游 #16366 引入了 chunkTimeout + wrapSSE 机制但默认关闭(undefined),等于没有。
//
// 本模块给 chunkTimeout 补默认值 120s:相邻 SSE chunk 间隔超过该值即 abort,走正常
// 错误路径收尾(盖 time.completed + 前端可见可重试)。语义上只杀"停滞的流",不杀
// 健康的长回复(区别于总超时 —— 总超时 5min 会误杀大模型的长流式输出,故不补)。
// 用户仍可 per-provider 配 options.chunkTimeout 覆盖,或显式 false 关闭。
// 详见 docs/features/llm-stream-idle-timeout/

export const DEFAULT_CHUNK_TIMEOUT_MS = 120_000

/**
 * 解析 provider options 里的 chunkTimeout 配置为生效值。
 * - 未配置(undefined/null)→ 默认 120s(本修复的核心:默认开启)
 * - 显式 false → undefined(关闭,对齐 timeout 的 opt-out 形态)
 * - 正数 → 用户值优先
 * - 0/负数/非法类型 → undefined(沿用上游 wrapSSE 的 `>0` 才生效语义;
 *   显式配置但不合法不应静默变成默认值,schema 校验会在更早处报错)
 */
export function effectiveChunkTimeout(configured: unknown): number | undefined {
  if (configured === undefined || configured === null) return DEFAULT_CHUNK_TIMEOUT_MS
  if (configured === false) return undefined
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) return configured
  return undefined
}
