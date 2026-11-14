// [fork-only] voice-acp-bridge — ACP session ↔ sidecar session 的映射与建立 [feat: voice-acp-bridge] 2026-08-24
//
// 桥要同时满足两条**看起来矛盾**的要求,本文件是它们的交汇点:
//
//   · 1-spec §3.2「每次网关启动重建 coordinator」—— 不重建的话,老 coordinator 的历史里堆满
//     "自己动手干"的样例,few-shot 会压过路由引导,像样的调研任务也不肯开独立 session
//     (voice-dispatch-minimal 时代的真实故障)。
//   · qwen 的 **resume 必须幂等** —— 它不只在启动时 resume:**每一轮 coordinator prompt 之前**
//     都会对同一个存活 session 再 resume 一次,目的只是重新注入 MCP
//     (`acp-backend-adapter.mjs:1036-1046`)。每次都重建的话,一轮对话就换一条 session,
//     等于什么历史都留不住。
//
// 解法是按**桥进程的生命周期**记账:某个 ACP sessionId 第一次出现时建一条新的 sidecar session
// 并记住映射,之后同一个 id 一律复用。桥进程 = qwen 网关的子进程,网关重启桥就重启,映射自然清空 ——
// "每次启动重建"就这么免费拿到了,而进程内的重复 resume 完全幂等。
//
// 另一半职责是**决定 session 落在哪个目录**,那是递归防护的地基(§3.1):
//   · coordinator → `ACP_DESKFOX_VOICE_DIR` 独立目录,派活 MCP 只注册在这里;
//   · 第三层任务 → 用户当前项目(§3.5:以 DeskFox 正在看的为准,不用 qwen 给的启动期 cwd)。

import { looksLikeCoordinator } from "./mcp"

export interface SessionRecord {
  /** qwen 认的 id。对外一律用它,哪怕内部换过 sidecar session。 */
  readonly acpId: string
  /** sidecar 里真实的 session id(`ses_...`) */
  readonly sidecarId: string
  /** 建这条 session 用的目录;之后所有 HTTP 调用与事件订阅都必须用**同一个字符串** */
  readonly directory: string
  readonly coordinator: boolean
}

export interface ResolveDirectoryInput {
  /** qwen 在 session/new 里给的 cwd(来自 ACP_WORKSPACE,启动时钉死) */
  readonly requestedCwd: string
  /** coordinator 专用目录 */
  readonly voiceDir: string
  /** DeskFox 此刻打开的项目;空表示读不到 */
  readonly activeProject: string
  readonly coordinator: boolean
}

/**
 * 这条 session 该落在哪个目录。
 *
 * 第三层优先用 DeskFox 当前项目 —— 这就是"切了项目语音就跟着切"的实现。
 * 代价写在 1-spec §3.5:qwen 自己的 delegation 记录里 directory 显示的还是它给的值,
 * 与实际可能不一致。**只影响 qwen 侧日志显示,不影响任何功能**,记为已知差异。
 */
export function resolveSessionDirectory(input: ResolveDirectoryInput): string {
  if (input.coordinator) return input.voiceDir
  const active = String(input.activeProject ?? "").trim()
  if (active) return active
  return String(input.requestedCwd ?? "").trim()
}

export interface SessionStoreDeps {
  readonly voiceDir: string
  /** 读 DeskFox 当前项目;每次建 session 都重新读,所以切项目能跟上 */
  readonly readActiveProject: () => string
  /** 真去 sidecar 建一条 session,返回它的 id */
  readonly createSidecarSession: (directory: string, coordinator: boolean) => Promise<string>
  readonly log: (message: string) => void
}

export interface SessionStore {
  /** `session/new`:总是建一条新的 */
  create(params: { cwd?: unknown; mcpServers?: unknown }): Promise<SessionRecord>
  /**
   * `session/resume` / `session/load`:第一次见到这个 id 就建新的并绑上去(= 透明换新),
   * 之后复用。**返回的记录里 acpId 恒等于 qwen 请求的那个 id**,它对内部换没换毫无感知。
   */
  resume(params: { sessionId?: unknown; cwd?: unknown; mcpServers?: unknown }): Promise<SessionRecord>
  get(acpId: string): SessionRecord | undefined
  all(): readonly SessionRecord[]
  /** 有没有已经建好的 coordinator(用于日志与自检) */
  coordinator(): SessionRecord | undefined
}

export function createSessionStore(deps: SessionStoreDeps): SessionStore {
  const byAcpId = new Map<string, SessionRecord>()

  const build = async (acpId: string | null, cwd: unknown, mcpServers: unknown): Promise<SessionRecord> => {
    const coordinator = looksLikeCoordinator(mcpServers)
    const directory = resolveSessionDirectory({
      requestedCwd: typeof cwd === "string" ? cwd : "",
      voiceDir: deps.voiceDir,
      activeProject: coordinator ? "" : deps.readActiveProject(),
      coordinator,
    })
    if (!directory) {
      throw new Error("[voice-bridge] 无法确定 session 目录:qwen 没给 cwd,DeskFox 也没有打开的项目")
    }
    const sidecarId = await deps.createSidecarSession(directory, coordinator)
    const record: SessionRecord = { acpId: acpId ?? sidecarId, sidecarId, directory, coordinator }
    byAcpId.set(record.acpId, record)
    deps.log(
      `建立 session:acp=${record.acpId} sidecar=${sidecarId} dir=${directory} ` +
        `role=${coordinator ? "coordinator(语音沟通)" : "task(第三层任务)"}`,
    )
    return record
  }

  return {
    async create(params): Promise<SessionRecord> {
      return await build(null, params?.cwd, params?.mcpServers)
    },

    async resume(params): Promise<SessionRecord> {
      const acpId = String(params?.sessionId ?? "").trim()
      if (!acpId) throw new Error("[voice-bridge] session/resume 缺 sessionId")
      const known = byAcpId.get(acpId)
      if (known) {
        // 幂等路径:同一轮对话里 qwen 每次 prompt 前都会来这一趟,不能有任何副作用
        deps.log(`复用 session:acp=${acpId} sidecar=${known.sidecarId}`)
        return known
      }
      // 第一次见:这是网关重启后拿着上次的 id 回来了。透明换新 —— 建新的、绑旧 id。
      deps.log(`session/resume 请求了未知 id ${acpId},透明换新(1-spec §3.2:每次启动重建 coordinator)`)
      return await build(acpId, params?.cwd, params?.mcpServers)
    },

    get(acpId: string): SessionRecord | undefined {
      return byAcpId.get(acpId)
    },

    all(): readonly SessionRecord[] {
      return [...byAcpId.values()]
    },

    coordinator(): SessionRecord | undefined {
      return [...byAcpId.values()].find((r) => r.coordinator)
    },
  }
}
