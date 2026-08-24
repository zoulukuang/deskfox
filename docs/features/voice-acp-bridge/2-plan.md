feat-id: voice-acp-bridge
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划(待 1-spec 审签后展开)

> 占位。按规范,实施计划与决策轨迹在动工后实时追加;当前停在 spec 审签闸。

## 预排的实施顺序(草案,签后细化)

1. 桥骨架:ACP stdio server + `initialize`(先让 `qwenaudio setup` 认出来)
2. `session/new`/`prompt` → sidecar 翻译(TC-U1~U4),先第三层后 coordinator
3. coordinator:voice 目录 session + MCP 注册(TC-U8)+ 路由 prompt
4. 三分法判别 + 契约快照测试(TC-U5/U6)
5. `launch-config.ts` 切换 `--backend acp` + `ACP_*` env(TC-U7)
6. 集成用例 TC-E1~E8 → 真机 TC-M1~M3
