feat-id: llm-stream-idle-timeout
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# llm-stream-idle-timeout — plan

## 实施方案(R1 三级跳:第 2 级,新文件 + 上游 ≤5 行接线)

1. **fork-only 新文件** `packages/opencode/src/provider/stream-timeout.ts`:
   `DEFAULT_CHUNK_TIMEOUT_MS = 120_000` + `effectiveChunkTimeout(configured)` 纯函数(undefined→默认 / false→关 / 正数→用户值 / 非法→关)。
2. **provider.ts 接线 3 处**(全部 FORK marker):
   - import `effectiveChunkTimeout`
   - `const chunkTimeout = effectiveChunkTimeout(options["chunkTimeout"])`(原:裸读 options,undefined = 永不超时)
   - `wrapSSE` 加 export(供单测)+ `ms` 形参放宽 `number | undefined`(首行本有防御,改诚实签名)
3. **config/provider.ts schema**:`chunkTimeout` 允许 `Literal(false)` 显式关闭(对齐 timeout 形态);修正 `timeout` 描述谎言("Default is 300000" → 实际无默认)。
4. **单测** `packages/opencode/test/provider/stream-timeout.test.ts`:R8 清单 7 用例,含 bug-repro(停滞 ReadableStream 复现死连接,断言超时窗口内 reject 而非永久挂)。

## 决策轨迹

- **为什么不给总 `timeout` 补默认**:5min 总超时会误杀健康长回复(大模型一轮流式可超 5min)。chunk 间隔超时语义正确:流在动就不杀。这大概率也是上游写了文档却一直没实现默认值的原因 —— 我们选择把文档改诚实,而不是把危险默认实现出来。
- **为什么 120s**:覆盖重负载 provider 的排队/思考静默(实测 my-life 正常轮间隔 5-8s,留 15-24 倍裕量);差的网络中间盒 idle 驱逐多在 60-300s 段,120s 能在用户耐心耗尽前给出明确失败。可 per-provider 调。
- **非法值(0/负数/字符串)→ 关闭而非回退默认**:显式配置错了不应静默变成 120s,schema 校验在更早处把关。
- **typecheck 踩坑**:接线后 `chunkTimeout` 从 `any` 变 `number | undefined`,`wrapSSE(res, chunkTimeout, ctl)` TS2345。修法:放宽 wrapSSE 形参(它首行本来就防御非 number),不在调用点加断言。

## 测试甄别记录(R9)

- 新测试 7/7 pass(含 bug-repro)。
- `test/provider/` 回归:278 pass,2 fail 均甄别为**预存非 regression**:
  - `ModelsDev get() returns {}`:记忆已知本地环境问题(models-snapshot.js gitignored,CI 不撞);
  - `plugin config enabled and disabled providers are honored`(5s 超时):stash 回 main 原始状态**同样 fail**,与本改动无关(本机网络拉 models.dev 失败,sidecar 日志同款报错)。
- `test/config/` 回归:156 ran,0 fail。
- monorepo typecheck:16/16 pass。

## 上游 PR 计划

上游 2026-06-11 核实该区域未动(`provider.ts`/`config/provider.ts` 仅行号位移),本补丁可平移。待 fork 内验证(dev 渠道真机冒烟)后向 anomalyco/opencode 提 PR,标题方向:"feat(provider): default chunkTimeout to 120s so stalled SSE streams fail fast instead of hanging forever"。

## 遗留

- `packages/sdk/openapi.json` 仓内已预存 641 行漂移(office-pdf 等历史 feat 未再生成),本笔不混入;单独 `chore: generate` 提案。
- 超时触发后目前走"报错收尾"路径;"自动透明重试"是 retry 机制的既有能力边界,不在本笔扩展。
