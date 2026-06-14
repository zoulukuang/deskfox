feat-id: llm-stream-idle-timeout
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# llm-stream-idle-timeout — changelog

## 改动清单

| 文件 | 性质 | 行数 |
|---|---|---|
| `packages/opencode/src/provider/stream-timeout.ts` | fork-only 新增(默认值 + 纯函数) | +28 |
| `packages/opencode/test/provider/stream-timeout.test.ts` | fork-only 新增(7 用例,含 bug-repro) | +97 |
| `packages/opencode/src/provider/provider.ts` | 上游文件,FORK marker ×3(import / 接线 / wrapSSE export+签名) | +8 -2 |
| `packages/opencode/src/config/provider.ts` | 上游文件,FORK-BEGIN/END(schema false 关闭 + 文档修正) | +16 -4 |
| `docs/features/llm-stream-idle-timeout/*` | 三文档 | — |

新增:上游 ≈ 149:18,远高于 3:1 健康基线。

## commit

- (本笔 commit,grep `[feat: llm-stream-idle-timeout]` 反查)fix(provider): SSE 流空闲 120s 默认超时 — 死流快速失败不再永久"思考中" [bug-repro] [override-blacklist]

## 影响范围

- 所有直连 HTTP provider 的流式请求:SSE 相邻 chunk 间隔 >120s 自动 abort → 走正常错误收尾(盖 `time.completed`,前端可见可重试),不再产生 `tokens.output=0` 永久残骸。
- 正常流(间隔 <120s)零变化;`options.chunkTimeout` 用户值优先;`false` 显式关闭。
- claude-code 插件通道(子进程)不走此路径,不受影响(其输出停滞另案,见 OPENCODE-PLAN 需求池)。

## 回归测试

- 新测试 7/7 pass(bun test `test/provider/stream-timeout.test.ts`)。
- `test/provider/` 278 pass + 2 预存 fail(均甄别非 regression,证据见 2-plan.md);`test/config/` 0 fail;monorepo typecheck 16/16。

## 回退方法

`git revert <hash>` 单笔可逆(P4):新文件删除 + 上游文件 3 处 FORK 块还原,无数据迁移。

## 起源

2026-06-11 user 报"多个会话卡死、运行极慢"。诊断:4 会话 13 条 `tokens.output=0` 残骸(xiaomi/alibaba-cn/getbot),sidecar 吊 3 条死 ESTABLISHED 连接;根因 = chunkTimeout 默认关闭 + timeout 文档默认从未实现 = 死流无限挂。上游同日核实未修(具 PR 价值)。完整诊断链:OPENCODE-PLAN `需求池/上游同步战略-Electron转向.md` 关联段。
