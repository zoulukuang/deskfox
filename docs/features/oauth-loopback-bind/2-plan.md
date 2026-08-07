feat-id: oauth-loopback-bind
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 改动清单

| 文件 | 改动 | 性质 |
|---|---|---|
| `packages/opencode/src/plugin/digitalocean.ts:187` | `listen(OAUTH_PORT, "127.0.0.1", () => {` + `// FORK:` marker | 改上游(黑名单) |
| `packages/opencode/src/plugin/openai/codex.ts:305` | 同上 | 改上游(黑名单) |
| `packages/opencode/src/mcp/oauth-callback.ts:155` | `listen(currentPort, "127.0.0.1", () => {` + `// FORK:` marker | 改上游(黑名单) |
| `packages/opencode/test/security/oauth-loopback-bind.test.ts` | **新增**:T1 裸 listen 守卫 + T4 redirect URI 字面量守卫 +(可选)T2/T3 集成 | 新文件(黑名单路径) |
| `docs/governance/UPSTREAM-MERGE-GUIDE.md` | §5 追加 5.6 复查 grep | fork-only 文档 |

FORK marker 文案(三处一致,便于 grep):

```ts
// FORK: REQ-019 OAuth 回调 server 绑环回地址,勿绑 0.0.0.0(R6 网络监听安全)2026-08-07
```

## 施工顺序

1. 先写守卫测试(T1/T4)—— 此时 T1 应**红**(3 处命中),形成 bug-repro 证据。
2. 改三处 `listen`,T1 转绿。
3. 补 T2/T3 集成测试(无非环回 IPv4 时 skip)。
4. `UPSTREAM-MERGE-GUIDE.md` §5.6 追加。
5. `bun turbo typecheck --filter='!./packages/console/*'` + `cd packages/opencode && bun test test/security`(顺带跑 mcp 相关既有测试)。
6. 真机 T5(MCP OAuth 一条);T6 无账号则记未验。
7. R4 复核报告 → user 审 → commit。

## 决策轨迹

- **为什么 fork 侧先改不等上游**(2026-08-07 user 拍板):这是我们当前实际暴露的端口;上游 PR 周期不可控,而改动只有 3 行、有上游自家写法可照抄,merge 冲突风险极低。上游 PR 降为可选。
- **为什么守卫测试而不只写进 merge checklist**:checklist 靠人执行,漏一次就退化;测试在 CI/本地跑就红,是**机器执行**的那一半。两者都要 —— 测试拦"改坏了",checklist 拦"merge 后没人跑测试"的情形并给出修法指引。
- **守卫测试为什么用静态 grep 而不是运行时断言**:三处 `listen` 都埋在带副作用的 OAuth 流程里(`ensureRunning` 尚可调,plugin 两处需构造完整 plugin 上下文)。静态守卫覆盖率 100% 且零副作用;运行时只对最容易起的 MCP 那条做 best-effort 补充。
- **T4(redirect URI 不变)为什么值得写**:本 spec 最大的功能风险就是"顺手把 localhost 改成 127.0.0.1",一改就是线上 `redirect_uri mismatch`。守卫把这条口头约束变成机器约束。
- **测试文件放 `packages/opencode/test/`**:与既有 opencode 测试同栖(turbo `opencode#test` 覆盖);虽仍在黑名单路径,但与三处改动同属**一笔** override,不额外消耗配额。先例:`session-heal-stat-timeout` 同样把测试放在该目录下。

## 风险 / 回退

| 风险 | 评估 | 处置 |
|---|---|---|
| codex / digitalocean 浏览器回跳走 `::1` 直连失败 | 低(浏览器有 happy-eyeballs 回落,实测 200 OK) | 真机验;真失败则双绑 `::1` 或该处退回并记录 |
| 上游同文件后续大改致 merge 冲突 | 低(单行 + FORK marker) | 按 UPSTREAM-MERGE-GUIDE §4.3 三原则解 |
| 守卫测试误伤上游合法的非 OAuth `listen` | 低-中(正则只匹配 `listen(x, () => )` 两参形态) | 命中即人工判断;必要时在测试里维护白名单常量并注明理由 |
| 回退 | 3 行 + 1 测试 + 1 文档 | `git revert` 一笔(P4) |

## 待办追踪

- [ ] 守卫测试(先红)
- [ ] 三处 listen + FORK marker
- [ ] T2/T3 集成(可 skip)
- [ ] UPSTREAM-MERGE-GUIDE §5.6
- [ ] typecheck + opencode 相关测试
- [ ] 真机 T5
- [ ] R4 复核报告 → user 审 → commit → 回填 3-changelog
