// FORK: REQ-098 share 分享页 e2e 的固定数据 [feat: chat-tilde-del-fix] 2026-08-08
// 假后端(SSR)与 spec(WebSocket mock)共用同一份,保证两条链路说的是同一个会话。
const SESSION_ID = "ses_share_tilde"
const MESSAGE_ID = "msg_share_tilde"
const T0 = 1_700_000_000_000

/** 真正会触发 bug 的形态:同一行两个「数字~数字」区间(单区间修前就不会被划)。 */
export const RANGE_TEXT = "预计在 4.80~5.05 区间内震荡,突破 5.20~5.35 的概率低"
/** 不回归:标准 GFM 删除线仍要产出 <del>。 */
export const STRIKE_TEXT = "~~这段确实要划掉~~"

export const SHARE_FIXTURE = {
  info: {
    id: SESSION_ID,
    title: "REQ-098 share regression",
    version: "0.0.1",
    slug: "req098",
    projectID: "proj_req098",
    directory: "/tmp/req098",
    time: { created: T0, updated: T0 },
  },
  message: {
    id: MESSAGE_ID,
    sessionID: SESSION_ID,
    role: "assistant",
    modelID: "claude-opus-4-6",
    providerID: "opencode",
    system: [] as string[],
    path: { cwd: "/tmp/req098", root: "/tmp/req098" },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: T0 + 1_000, completed: T0 + 2_000 },
  },
  parts: [
    { id: "prt_range", sessionID: SESSION_ID, messageID: MESSAGE_ID, type: "text", text: RANGE_TEXT },
    { id: "prt_strike", sessionID: SESSION_ID, messageID: MESSAGE_ID, type: "text", text: STRIKE_TEXT },
  ],
}

/** WebSocket 推送帧(顺序同真实后端:info → message → part…)。 */
export function shareFrames() {
  const { info, message, parts } = SHARE_FIXTURE
  return [
    { key: `session/info/${info.id}`, content: info },
    { key: `session/message/${info.id}/${message.id}`, content: { ...message, parts } },
    ...parts.map((part) => ({ key: `session/part/${info.id}/${message.id}/${part.id}`, content: part })),
  ].map((frame) => JSON.stringify(frame))
}
