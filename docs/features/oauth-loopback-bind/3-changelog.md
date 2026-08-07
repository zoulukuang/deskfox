feat-id: oauth-loopback-bind
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志 — REQ-019 OAuth callback server 绑环回地址

**规模**:Tiny(代码 3 行)+ 配套(2 测试文件 + 治理文档)
**分支**:`feat/small-cost-cleanup-batch`
**commit**:`6fe215459f`(R4 override,user 2026-08-07 审批通过)
**R4 override**:**需要**(`packages/opencode/` 整包在 pre-commit 黑名单)—— 论证见文末

## 实际改动

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/opencode/src/plugin/digitalocean.ts:187` | `listen(OAUTH_PORT, "127.0.0.1", …)` + FORK marker | +3 |
| `packages/opencode/src/plugin/openai/codex.ts:305` | 同上 | +3 |
| `packages/opencode/src/mcp/oauth-callback.ts:155` | `listen(currentPort, "127.0.0.1", …)` + FORK marker | +3 |
| `packages/opencode/test/security/oauth-loopback-bind.test.ts` | 新增:静态守卫 3 测(裸 listen 全仓扫描 / 三处 hostname / redirect URI 不变) | +80 |
| `packages/opencode/test/security/oauth-loopback-runtime.test.ts` | 新增:运行时 2 测(127.0.0.1 连得上 / LAN IP 连不上) | +65 |
| `docs/governance/UPSTREAM-MERGE-GUIDE.md` | §5 追加 5.6 merge 后复查 grep | +7 |

FORK marker 三处一致(便于 grep):`// FORK: REQ-019 OAuth 回调 server 绑环回地址,勿绑 0.0.0.0(R6 网络监听安全;写法同 plugin/xai.ts:502)`

## 影响范围

- 三处 OAuth 回调 server 从 `0.0.0.0`(Node 默认)收到 `127.0.0.1`,窗口期内不再被同网段探测/投递。
- **三处 redirect URI 一字未改**(codex / digitalocean 仍是 `http://localhost:PORT/...`,MCP 仍是 `127.0.0.1`)—— 改了会 `redirect_uri mismatch`;这条已写成守卫测试。
- 上游 `plugin/xai.ts` 本来就正确,未动。

## 回归测试

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --filter='!./packages/console/*'` | 22/22 ✅ |
| 新增守卫 + 运行时测试 | **5 pass / 0 fail** |
| `packages/opencode` 的 `test/mcp` + `test/plugin`(`--timeout 30000`) | **209 pass / 0 fail** |
| **bug-repro 反证** | 撤回 MCP 那处修改后重跑运行时测试 → **LAN IP 实测 `connected`**(证明修前端口确实暴露在网卡上),恢复后转绿 |

> ⚠️ 用默认 5s timeout 跑 `test/plugin` 会看到 `workspace-adapter` 超时 1 例 —— 那是 timeout 设置问题(包脚本本身用 `--timeout 30000`),非本次 regression。

## 真机 OAuth 回调

| 用例 | 结果 |
|---|---|
| T5 MCP 回调链路(redirect 本就是 `127.0.0.1`,零风险) | ✅ 运行时测试实起 server + 实连 `127.0.0.1` 通;完整 OAuth 授权流需真实 MCP provider,**未跑** |
| T6 codex / digitalocean 真机 | ⏸ **未验**(无对应账号)。依据:`localhost` 在本机解析 `::1` 优先,但浏览器/fetch 走 happy-eyeballs 会回落 `127.0.0.1`(本机实测 `fetch http://localhost:PORT` 200 OK)。若真机验不过,兜底方案是 `::1` 双绑或该处退回并记录(见 1-spec) |

## 回退方法

`git revert <commit>`。三处各 1 行,回退后恢复默认 `0.0.0.0` 绑定(即恢复 R6 违规状态)。

## 长期价值(本条真正的重点)

1. **机器闸**:`test/security/oauth-loopback-bind.test.ts` 扫全 `packages/opencode/src`,上游新出现第四、第五处裸 listen 时直接红。
2. **人工闸**:`UPSTREAM-MERGE-GUIDE.md §5.6` 同款 grep,merge 后 checklist 里带修法指引。
3. 上游 PR 为可选附带动作,不作为完成条件(2026-08-07 user 拍板)。

---

## R4 override 复核报告(single-person 二次确认用)

**① wrapper 替代不可行性**
`listen()` 的 hostname 参数在上游函数体内部,fork 侧无任何注入点(端口/回调都由上游模块自持)。唯一"不改上游"的替代是把整条 OAuth 流程复制进 fork-only 文件并劫持 provider 注册 —— 数百行且每次 sync 都要跟,代价远超 3 行 + FORK marker。上游自家 `plugin/xai.ts:502` 就是同款写法,冲突面最小。
测试文件放 `packages/opencode/test/` 同样触黑名单,但与三处改动属**同一笔** override,不额外消耗配额。

**② 风险评估**
- 安全收益:确定(实测证明修前 LAN 可连、修后被拒)。
- 功能风险:MCP 那条零风险(redirect 本就是 IP);codex / digitalocean 依赖客户端 `localhost → 127.0.0.1` 回落,风险低但非零,已写明兜底方案与"绝不改 redirect URI"的守卫。
- 上游冲突:3 处单行 + 注释,机械冲突。

**③ 逐文件论证**
| 文件 | 为什么必须动 |
|---|---|
| `plugin/digitalocean.ts` / `plugin/openai/codex.ts` / `mcp/oauth-callback.ts` | 违规监听本体,hostname 只能就地补 |
| `test/security/*.test.ts`(新) | R5 要求 + 本条长期价值所在;opencode 包的测试只能放该包 test 目录 |

**commit message 将标**:`[override-blacklist: listen hostname 在上游函数体内无注入点,3 行就地补 + FORK marker,复制整条 OAuth 流程的 wrapper 方案代价数百行]`
