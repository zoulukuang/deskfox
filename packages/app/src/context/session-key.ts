// FORK: REQ-041 后续 — 文件 tab 项目级存储 key 的纯函数(零依赖,便于单测)。
// sessionKey 形如 `${dir}` 或 `${dir}/${sessionId}`(dir 为 base64)。文件 tab 按「项目 dir」段
// 存储:同项目不同会话(dir/idA、dir/idB)→ 同一 key → 共享一套文件 tab,切会话不变;
// 切项目(dirA、dirB)→ 不同 key → 各自一套。2026-06-02
export const projectTabKey = (sessionKey: string) => sessionKey.split("/")[0] || sessionKey
