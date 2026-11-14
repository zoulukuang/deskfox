// [fork-only] REQ-102 ACP 子进程插件门控 [feat: voice-dispatch-minimal] 2026-08-21
//
// 问题:语音派活会起一个 `opencode acp` 子进程,它和主实例读同一份 config,于是**把飞书适配器
// 又加载一遍** —— 再开 5 条 WSS 跟主实例抢消息。这不是理论风险:REQ-102 §3.5 三次裸探针确实
// 拉起了 5 个飞书 WSS 账号并覆写了 `~/.opencode/feishu-plugin-server.json`。
// 而本适配器**没有任何单实例锁**,`feishu-wss-dedup.json` 只是消息级去重、不是进程互斥,
// 短命的 ACP 子进程完全可能截走本该主实例处理的消息。
//
// 解法(D-B):在插件入口自己判定并早返回空 hooks。判定依据 `OPENCODE_CLIENT` ——
// `packages/opencode/src/cli/cmd/acp.ts:23` 在 `Server.listen`(:25)**之前**就把它设成 "acp",
// 而插件是在 `Server.listen` 内部才加载的,所以这里必然读得到。
// 这样做零上游侵入(R1 第 1 级),不用去动 `plugin/index.ts` 那个全仓唯一的插件加载收口点。
//
// ⚠️ 本文件在 `packages/media-gen/src/acp-gate.ts` 有一份**语义相同的副本**:两个包之间没有
// 共享的 fork 工具包,为十来行逻辑互相依赖更糟。行为漂移由 media-gen 侧的守卫单测盯着。

/** 本插件的 id —— 与注入 config 的插件目录名一致(`.../plugin/feishu-bridge`)。 */
export const FEISHU_PLUGIN_ID = "feishu-bridge"

/** ACP 子进程里默认放行的插件 id(逗号分隔可用 `DESKFOX_ACP_PLUGINS` 覆盖)。 */
export const DEFAULT_ACP_PLUGIN_ALLOWLIST = "media-gen"

/**
 * 这个插件在当前进程里该不该跳过。
 * - 不在 ACP 子进程里 → 永远不跳过(主实例、TUI、CLI 行为完全不变)
 * - 在 ACP 子进程里 → 只放行白名单内的;`*` 放行全部;空串放行零个
 */
export function shouldSkipInAcp(pluginId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OPENCODE_CLIENT !== "acp") return false
  const raw = env.DESKFOX_ACP_PLUGINS ?? DEFAULT_ACP_PLUGIN_ALLOWLIST
  if (raw.trim() === "*") return false
  const allow = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return !allow.includes(pluginId)
}
