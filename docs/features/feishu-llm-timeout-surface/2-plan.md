feat-id: feishu-llm-timeout-surface
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 步骤

1. **新建 `prompt-dispatcher.test.ts`**(R5 复现测试)— 测 timeout-empty 现在的行为(resolve "")并标 `[bug-repro]`,初版让它 fail 证明 bug 存在,然后改代码使其 pass
2. **改 `prompt-dispatcher.ts`** — `register()` 返回类型从 `Promise<string>` 改 `Promise<DispatchResult>`,timeout 无 partial 时 reject 而非 resolve("")
3. **改 `message-pipeline.ts::runOpencode`** — 接 `DispatchResult`,所有 `return ""` 改 `throw`
4. **改 `message-pipeline.ts::friendlyErrorReply`** — 加 5 类 pattern
5. **改 `message-pipeline.ts::handle/handleMergeForward`** — empty reply 兜底发 fallback 文本
6. **改 `friendly-error.test.ts`** — 修原 `Network timeout` 用例期望,加 5 类新 case
7. **改 `message-pipeline.test.ts`** — 加 1 个"runOpencode throw → friendlyErrorReply → sendFeishuText"的 e2e 测试
8. **typecheck + 全测**:`bun run typecheck` + `cd packages/adapter-feishu-lark && bun test src/feishu/__tests__`
9. **写 3-changelog.md + 改动日志.md 索引**
10. **commit + 问 user push**

## 决策轨迹

### 决策 1:DispatchResult 类型 vs sentinel error
- 选 `DispatchResult { reply, source }` 显式区分
- 备选:走 reject + 自定义 Error class — 拒,因为 timeout-partial 是"半成功",用 reject 表达不自然
- 备选:不改类型,直接在 runOpencode 里加 timer 比较 — 拒,会引入两次 timeout 控制,失控风险

### 决策 2:empty reply 在 runOpencode throw vs handle 发 fallback
- 选**双层防御**:runOpencode 主路径 throw(走 friendlyErrorReply 友好包装),handle empty reply 也兜底发 fallback 文本
- 理由:runOpencode throw 是主治,handle fallback 是兜底防御(万一某分支返了空字符串没 throw)
- 不去掉 handle 里 empty 判断,因为 sendFeishuText 不能传空 string(飞书 API 报错)

### 决策 3:friendlyErrorReply 不动主体结构
- 沿用 if-elseif 链(简单清晰,5 个新 case 不至于上升到 dispatch map)
- 每个新 case 末尾保留 `(原始错误:${msg})` 便于线下诊断
