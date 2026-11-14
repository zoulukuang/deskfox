feat-id: daily-file-links
status: approved-for-commit
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-162 提交前 R4 复核（2026-11-14，笑南的电脑）

实际 diff 已在 `fix/daily-file-links` 工作区准备，尚未提交。唯一黑名单文件为 `packages/opencode/src/session/llm/request.ts`；新增 `file-delivery.ts` 和专属测试属于 fork-only。

按当前 `.husky/pre-commit` 实际正则及 `upstream-base` 核对：app 的 `context/file/path.ts`、e2e 文件均不命中黑名单；desktop `src/main/deskfox/*`、session-ui 新增预览 Markdown renderer 也不命中。opencode 的 helper/test 虽在黑名单目录，但 upstream-base 不存在，享 fork-only 豁免。没有修改 packages/ui 或 session-ui 的既有 Markdown 文件。

## 为什么 wrapper 不能单独接入

`LLMRequestPrep.prepare` 是 AI SDK、原生 runtime、OAuth instructions 和 workflow 的请求汇合点，返回的 `system/messages` 被各通道消费。外部 helper 不被这里调用就不能生效；只改单一 provider prompt 无法覆盖其他通道；system-only 还会在丢弃 system 的 provider bridge 中失效。故把约定及不可变消息包装留在新 fork helper，黑名单文件只作 5 行有效注入：import、system 数组增加约定、构造 delivery 请求副本、两处原 `input.messages` 换成 `delivery`。

## 实际行为与风险

- 已定位/生成的具体文件输出 Markdown 链接，目标是逐段编码绝对路径，保留 `/` 和 Windows 盘符，不使用 `file://`，不虚构未知路径；用户明确格式优先。
- system 加同一约定；最后一条用户消息的请求副本追加应用标记，便于忽略 system 的桥接看到提示。原消息/历史、工具调用与结果、image/file parts 均不改写，不增加用户轮次。重复包装幂等。
- 统一谓词排除 small 内部请求、compaction 代理和用户明确 json_schema 结构化输出，避免压缩摘要里的精确路径和结构输出被 Markdown 约定干扰。
- 代价是每次普通请求多一些提示 token，且 provider 的缓存身份会随请求文本增量变化。不能保证模型总会服从，也不能保证第三方桥接自行重写用户文本后仍保留提示。
- 不启用新 provider、不安装插件、不改鉴权/权限/工具执行、不迁移历史。整体可 revert。本轮未进行真实模型抽查，仍须按测试矩阵验收。

## 验证

`bun test ./test/session/file-delivery.test.ts`：9 pass / 0 fail。3 个 helper 测试验证最后用户消息不可变、混合 image/file parts、后续工具消息保留和幂等；6 个实际 `LLMRequestPrep.prepare` 用例验证普通请求、OAuth instructions、workflow、small、compaction、json_schema。测试检查去除 system 后 user 文本仍含提示，但不冒充真实插件桥接/模型验证。

opencode 包 `bun typecheck` 在加入排除谓词后通过；完整 pre-push 也已通过（29类型检查、六包测试）。A/B 已分笔普通提交，C 本 diff 仍冻结在 staged 待批准。真实 provider/桌面双端验收仍有缺口，不以这些检查代替。

请主 agent 按仓库 CLAUDE.md R4 将上述具体 diff 交用户二次确认后，才能提交 request.ts。Large B 施工审签不替代这笔提交确认。预定 commit 标记 `[override-blacklist: shared request file links]`。

## R4 授权回执（2026-11-14）

用户明确回复「批准三组提交与推送」，主 agent 已传达本组 C 冻结补丁批准。提交前核对 cached diff SHA256 为 `49c053338dc79441d7eca3b4a125e66980a0ac939822e4e319760fd30ef2510b`，与已审补丁一致；本次仅追加授权记录，没有改变已验产品代码。按 R4 例外使用 `--no-verify` 提交黑名单注入，commit message 明示 override；完整 pre-push 不跳过，按主 agent 协调顺序执行后推送。
