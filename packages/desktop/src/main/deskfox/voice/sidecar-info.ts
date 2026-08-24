// [fork-only] voice-acp-bridge — sidecar 连接信息的进程内共享点 [feat: voice-acp-bridge] 2026-08-24
//
// 语音桥要连的是 **DeskFox 自己的 sidecar**,而它的地址和密码是运行期才有的:
// 端口是启动时挑的空闲口、密码是 `randomUUID()`,**都不落盘**(`main/index.ts:499-501`)。
// 所以不能硬编码 4096,也没有配置文件可读 —— 只能由主进程在 sidecar 就绪那一刻交出来。
//
// 为什么是这么一个小模块而不是把 Deferred 传来传去:`registerDeskfoxIpc()` 在 `app.whenReady`
// 之后就注册了,而 sidecar 要更晚才起。IPC handler 需要的是"用的时候去取",不是"注册时拿到"。
// 一个模块级 setter/getter 是这里最省事、也最不侵入上游的做法(R1 三级跳第 2 级:
// 新文件 + 上游两处各 1 行注入)。

export interface SidecarInfo {
  readonly url: string
  readonly username: string
  readonly password: string
}

let current: SidecarInfo | null = null

/** sidecar 就绪时由 `main/index.ts` 调一次(v1 / v2 两条分支各一处)。 */
export function publishSidecarInfo(info: SidecarInfo): void {
  current = info
}

/** 拿连接信息;sidecar 还没起来时返回 null,调用方据此拒绝启动语音并说明原因。 */
export function getSidecarInfo(): SidecarInfo | null {
  return current
}
