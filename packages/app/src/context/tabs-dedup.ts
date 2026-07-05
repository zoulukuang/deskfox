// FORK: REQ-072 会话侧栏项目维度 — sessionHasOpenTab 抽成纯模块(Logic 清单单测) 2026-07-05
// 从 tabs.tsx 抽出:tabs.tsx transitive import 会拉起 @solidjs/router 的 client-only API,
// solid-server 测试环境下 import 即崩,无法单测。本模块只 `import type`(全部编译期擦除、零
// runtime 依赖)→ 可在测试里独立 import。
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "./server"
import type { Tab } from "./tabs"

// REQ-072: 按 server + session.id 去重(session.id 全局唯一)。原用 base64Encode(session.directory)
// 做目录维度去重,改名/挪位项目的会话 session.directory=旧路径 → 与当前有效目录失配 → 误判「未开」
// → 开出重复 tab。改按 id 去重根治(打开走当前有效目录 slug,不用 session.directory,不踩 stale-path)。
export function sessionHasOpenTab(tabs: Tab[], server: ServerConnection.Key, session: Session) {
  return tabs.some((tab) => tab.type === "session" && tab.server === server && tab.sessionId === session.id)
}
