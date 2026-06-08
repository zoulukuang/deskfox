---
feat-id: coldstart-toast-race
status: done
related: ./3-changelog.md
---

# 3-changelog — coldstart-toast-race

> Small 规模(helper + 3 toast 站点 guard + 单测),按规范只写 3-changelog.md。

## 背景 / 现象

用户启动新装的 DeskFox(本机 dev 包)时,屏幕连续弹三条 toast:
1. **加载文件失败** — `error sending request for url (http://127.0.0.1:64796/file/content?path=…skillhub.md…)`
2. **无法加载 Downloads 的会话** — `error sending request for url (http://127.0.0.1:64796/session?directory=…Downloads…)`
3. **后台已恢复 — 可以继续使用了**

## 根因

诊断(`server.rs` 看门狗 + `app.tsx` ConnectionGate):

- `ConnectionGate`(app.tsx:173)**已**把主 UI gate 在健康检查后(10s 宽限阻塞 + ConnectionError 重试页),正常冷启动请求不会在 sidecar 未 ready 时发出。
- 真实序列:① sidecar healthy → gate 放行 → app 渲染、恢复 Downloads 会话 + 开 skillhub.md ② sidecar **随后**假死 → **sidecar 看门狗(REQ-049 Layer③)**判定无响应、同 port 重启 ③ **重启窗口**里前端那些请求以连接级错误(`error sending request for url`,Tauri/reqwest 后端不可达)失败 → 各弹一条红 toast ④ 看门狗 ready → 第三条「后台已恢复」。
- **症结**:看门狗已全权负责「后台引擎重启中 / 后台已恢复 / 多次重启失败」的用户提示,但 `global-sync` / `file` context 在那个窗口里**对每个失败请求又各弹一条红 toast** —— 冗余噪音,且看起来像真故障。

## 修法

后端可用性的 UX 统一交看门狗,**各请求站点遇到「连接级后端不可达」瞬时错不再各弹 toast**(仍 console 记录)。

| 文件 | 改动 |
|---|---|
| `packages/app/src/utils/server-errors.ts` | 新增纯函数 `isBackendUnreachableError(error)` — 吃 `Error` / `string`,正则识别连接级不可达(`error sending request` / `failed to fetch` / `networkerror` / `connection refused` / `econnrefused` / `tcp connect error` / `connection closed before message completed`);**不含 HTTP 4xx/5xx**(后端在、业务/服务故障,应正常 surface) |
| `packages/app/src/context/global-sync.tsx` | 会话列表 `.catch`:`isBackendUnreachableError(err)` 则 `return` 不弹 toast |
| `packages/app/src/context/file.tsx` | `setLoadError`(文件加载)+ 文件树 `onError`(文件列表)两处同样 guard;加 helper import |
| `packages/app/src/utils/server-errors.test.ts` | +6 单测(实测 reqwest 错 Error/string 形态 + web fetch 变体 + 大小写 + 4xx/5xx 不误判 + 空输入安全)|

**未动** `file-tabs.tsx:1499`(SVG 渲染错,非连接错,本就该 surface)。

## 设计取舍

- **只 suppress 不做重载 wiring**:后端恢复由既有机制自愈 —— `server.tsx` `startHealthPolling` 持续轮询 + `global-sync` `bootstrap.refetch`;看门狗同 port 重启后新请求自动通。不为此扩成跨 context 的「恢复后强制重载」反应式接线(避免过度工程,符合元原则 稳定 > 简洁)。
- **suppress 安全**:渲染态下「后端不可达」≈ 看门狗重启窗口(真·从未起来会被 ConnectionGate 挡在 ConnectionError 页,不走这些 toast);终态失败由看门狗「多次重启失败」toast 兜底。故 suppress 不会吞掉真故障。
- **per-call-site 而非 SDK fetch 层**:mirror 既有 `isStaleSessionError` 模式,精准、低风险,不影响应当 surface 错误的其它请求。

## 验证

- `isBackendUnreachableError` 6 新单测 + 文件原 9 测 = **server-errors 15 pass / 0 fail**。
- app 包全量 **814 pass / 0 fail**(+6 新,0 回归)。
- monorepo typecheck **16/16**。
- ⚠️ 端到端「重启窗口 toast 静默」靠看门狗真触发(intermittent),未在自动化覆盖;helper 单测覆盖实测错误字符串识别,集成为简单 `if(...) return` 前置守卫。

## 规模 / 影响

- **Small**:4 文件(1 helper + 2 context + 1 test),净 ~70 行,全 fork-only(server-errors.ts 为 fork helper 文件,context 两处加 FORK marker)。
- **回退**:`git revert` 本 commit;恢复后仅是「重启窗口重新弹冗余 toast」,无功能影响。
- **0 改上游产品代码 / 0 R4 override / 0 黑名单**。
- [bug-repro: sidecar 看门狗重启窗口里前端各请求各弹冗余「加载失败」红 toast — 连接级不可达应静默交看门狗统管]
