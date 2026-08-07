feat-id: oauth-loopback-bind
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-019 上游 OAuth callback server 绑 0.0.0.0

> 来源:`OPENCODE-PLAN/需求计划/2026-08-07.md`(小成本确定性收口批,IN SCOPE 第 2 条)
> 规模:**Tiny→Medium**(代码 3 行,但触黑名单 + 加守卫测试 + 改治理文档)
> 核查基线:fork HEAD `26511dc6b4`(main)

## 需求

上游三处 OAuth callback HTTP server 调 `listen(port, cb)` 不带 hostname → Node 默认监听 `0.0.0.0`,把回调端口暴露到所有网卡(LAN/公网)。违反本仓 **R6 网络监听安全**(2026-05-10 立,起因是同类问题引发 Win 防火墙弹窗 + LAN 可探测)。

OAuth callback 服务的用途只有"本机浏览器回跳",**没有任何监听外网的理由**;窗口期内 LAN 上任何人都能连到该端口并投递构造的 `code`/`state`。

## 定位(2026-08-07 重新 grep,行号未漂)

```
packages/opencode/src/plugin/digitalocean.ts:187    oauthServer!.listen(OAUTH_PORT, () => {
packages/opencode/src/plugin/openai/codex.ts:305    oauthServer!.listen(OAUTH_PORT, () => {
packages/opencode/src/mcp/oauth-callback.ts:155     server!.listen(currentPort, () => {
```

**关键证据:上游自己就有正确写法** —— `packages/opencode/src/plugin/xai.ts:502` 是 `server.listen(OAUTH_PORT, OAUTH_HOST, ...)`,`xai.ts:35` `const OAUTH_HOST = "127.0.0.1"`。
→ 这三处是**遗漏而非设计选择**;照 xai 写法补,与上游风格一致,未来 merge 冲突面最小。

**在扩散**:2 处 → 3 处,新增的 `digitalocean.ts` 是上游后加的 —— 越晚做,要补的口越多。

## redirect URI 主机名不一致(施工必读的坑)

| 位置 | redirect URI | 绑 127.0.0.1 的风险 |
|---|---|---|
| `mcp/oauth-callback.ts` | `http://127.0.0.1:${port}${path}`(`mcp/oauth-provider.ts:40`) | **零风险**,本来就是 IP 字面量 |
| `plugin/openai/codex.ts` | `http://localhost:1455/auth/callback`(硬编码 3 处:241 / 283 / 311) | `localhost` 可能先解析到 `::1` |
| `plugin/digitalocean.ts` | `http://localhost:1456/auth/callback`(`redirectUri()` 46-47) | 同上 |

本机实测:`localhost` 解析顺序 `::1` 优先;绑 `127.0.0.1` 后直连 `::1` 会 `ECONNREFUSED`,但走 happy-eyeballs 的客户端(含浏览器)会自动回落 `127.0.0.1`,`fetch http://localhost:PORT` 实测 200 OK。→ **风险低但非零**。

**🚫 明确不要做**:不要顺手把 codex / digitalocean 的 redirect URI 改成 `127.0.0.1`。`redirect_uri` 必须与 provider 端注册值**逐字匹配**,擅自改大概率换来 `redirect_uri mismatch`,把安全小修变成功能故障。

**兜底(仅当真机 OAuth 验不过才动)**:在 `::1` 上再起一个 server 双绑;或该处退回不绑并在 changelog 记录原因。

## 方案(定稿)

1. **fork 侧直接改三处**,加 `"127.0.0.1"` 参数 + `// FORK:` marker(R2 单点改格式),不等上游。
2. 新增**守卫测试**:断言 `packages/opencode/src` 下不存在"裸 listen"(`.listen(x, () => ...)` 形态)。上游未来再引入第四处、第五处时**测试就红**,不必等人肉 merge 检查。
3. **把定位 grep 固化进** `docs/governance/UPSTREAM-MERGE-GUIDE.md` **§5 Merge 后 checklist**(现有 5.0–5.5,追加 5.6):

   ```bash
   # 5.6 REQ-019 OAuth loopback bind 复查(上游持续复制 listen 不带 hostname 的写法)
   grep -rnE '\.listen\([^,)]+,\s*\(\)' packages/opencode/src
   # 期望:0 命中。有命中 = 上游新增了裸 listen,按 REQ-019 补 "127.0.0.1"(参考 plugin/xai.ts:502)
   ```
4. **上游 PR 降为可选附带动作**,不作为本条完成条件,也不等它 merge。

## 测试用例清单(R8,动工前锁定)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| T1 | grep 守卫:`packages/opencode/src` 下裸 `listen(port, cb)` 命中数 | unit(静态守卫) | 0;新增裸 listen 时 fail(含失败提示指向本 spec) |
| T2 | `mcp/oauth-callback.ts` `ensureRunning()` 起服务后,从**非环回本机 IP** 连该端口 | 集成(best-effort) | `ECONNREFUSED`;无非环回 IPv4 的环境自动 skip |
| T3 | 同上,连 `127.0.0.1` | 集成 | 连得上,回调可达 |
| T4 | 三处 redirect URI 字面量未变 | unit(静态断言) | 与改前逐字一致(防"顺手改" regression) |
| T5 | 真机跑通一次真实 OAuth 回调 —— 优先 MCP 那条(redirect 本就是 `127.0.0.1`,零风险) | 真机 | 授权成功 |
| T6 | codex / digitalocean 真机 | 真机(条件) | 无账号则**记录未验** + 写明 localhost→127.0.0.1 回落依据 |

## 验收标准

- [ ] 三处 `listen` 均带 `"127.0.0.1"`,各带 `// FORK:` marker
- [ ] 三处 redirect URI **保持不动**
- [ ] T1 / T4 守卫测试入库并全绿;T2/T3 通过或按环境 skip
- [ ] T5 真机跑通(至少 MCP 一条);T6 未验则在 3-changelog 明记
- [ ] **`UPSTREAM-MERGE-GUIDE.md` §5.6 已落地**(本需求的长期价值,漏了等于白改)
- [ ] commit 带 `[override-blacklist: ...]` + `[feat: oauth-loopback-bind]`

## 治理约束(R2 / R4 / R6)

- `packages/opencode/` 整包在 pre-commit 黑名单(`.husky/pre-commit:17`)→ 三处改动 **+ 新增守卫测试文件**都会被拦,须 R4 override(1 笔 commit 算 1 笔配额)。
- **wrapper 不可行性(R4 论证要点)**:`listen()` 的 hostname 参数在上游函数体内,无外部注入点;fork 侧唯一替代是复制整个 OAuth 流程到 fork-only 文件并劫持 provider 注册 —— 代价数百行且每次 sync 都要跟,远劣于 3 行 + FORK marker。上游有 `xai.ts` 同款写法,冲突面最小。
- R6 的 pre-commit §4.5 拦的是**新增**裸监听;本次是给既有调用补 hostname,方向一致,不需要 `[network-bind-public:]` 例外。

## 边界 / 明确不做

- 不改 redirect URI(见上,会 `redirect_uri mismatch`)。
- 不做双绑 `::1`(仅作兜底方案,真机验不过才动)。
- 不顺手治理 `packages/opencode/src` 内其他 `Server.listen()`(那是 opencode server 主监听,自有 hostname 处理链路,超出本条范围)。
