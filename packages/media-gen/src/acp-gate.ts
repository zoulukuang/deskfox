// [fork-only] REQ-102 ACP 子进程插件门控 [feat: voice-dispatch-minimal] 2026-08-21
//
// 语音派活会起一个 `opencode acp` 子进程,它和主实例读同一份 config,于是把本插件也加载一遍。
// 对 media-gen 来说这件事**要分两半看**:
//
//   · **tools 要保留** —— 语音派「帮我生成一张图」这类活,靠的就是它们;而 tools 是直接调
//     `generateImage` 等函数,不经过本地 server(`server.ts` 的角色是"前端 ↔ 引擎通道",
//     给 DeskFox webview fetch 用的)。所以 ACP 里保留 tools 零副作用。
//
//   · **server 不能再起** —— 端口是**固定的 51737**(`server.ts:26`,P1 取舍),主实例已经占着;
//     子进程再起一个必然撞端口(spike 实测的 "media-gen 端口冲突" 噪声就是它),还会覆写
//     `~/.opencode/media-gen-server.json` 这个前端用来找 server 的发现文件。
//
// 所以本文件给两个判定,而不是一个 all-or-nothing 开关。
//
// ⚠️ `shouldSkipInAcp` 在 `packages/adapter-feishu-lark/src/acp-gate.ts` 有一份**逐字相同的副本**:
// 两个包之间没有共享的 fork 工具包,为十来行逻辑互相依赖更糟。漂移由本包 `acp-gate.test.ts`
// 的守卫用例逐字比对两份实现来盯。

/** 本插件的 id —— 与注入 config 的插件目录名一致(`.../plugin/media-gen`)。 */
export const MEDIA_GEN_PLUGIN_ID = "media-gen"

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

/**
 * 该不该起本地生成服务。ACP 子进程里一律不起 —— 见文件头第二条:
 * 固定端口 51737 已被主实例占着,再起只有撞端口和覆写发现文件两个结果,而 tools 不需要它。
 */
export function shouldStartMediaServer(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCODE_CLIENT !== "acp"
}
