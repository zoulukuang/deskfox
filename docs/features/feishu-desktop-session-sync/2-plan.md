feat-id: feishu-desktop-session-sync
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 飞书↔桌面同 session 协同呈现 — 2-plan(实施计划 + 决策轨迹)

> 开发中实时追加 note,记录踩坑 / 方案推翻。

## 实施顺序(底座先行,可自主部分先落)

1. **P0 施工前钉死**(阻塞第 2/6 项):跑 ①10 分钟 auth 实验 + ⑥端点实测(均需真飞书环境,待 user 协助 / 授权)。
2. **P1 昵称底座**(REQ-055):`contact-name-resolver.ts` + 缓存 + 回落 + 单测 U7/U8。
3. **P2 helper 重构**(第 1/2/4 项):抽 `getOrCreateSession`,4 处调用点统一,停 archive + 回读 store + botName title;单测 U1-U4。
4. **P3 昵称两个消费面**(第 6 项 + REQ-055 面):`senderTag` 查表 U9 + 群 session 呈现面。
5. **P4 授权反向失效**(第 5 项):plugin.ts 订阅 + `handleExternalResolve`;单测 U5/U6。
6. **P5 前端核实**(第 3 项):确认 0 改动;若需微调再评估。
7. **P6 真机验收**:一套「飞书发起→桌面续聊→授权双端→重启接续」操作脚本覆盖 E1-E8。

## 决策轨迹

- 2026-07-06 建 spec。已 grep 核实:4 处 archive(899/1082/1337/1589)+ 4 处 title(888/1074/1329/1581)完全吻合 REQ-073;`ChatSessionStore.get()` 本就读盘持久化值,pipeline 查找漏回读(第 2 项修法印证);`this.opts.account.botName` 现成(第 4 项数据免费);`PermissionCardController` 有 `replaceWithSettledCard`/`cleanup`/`replyToOpencode` 分离,`handleExternalResolve` 复用前两者跳过第三(第 5 项修法清晰)。
- 2026-07-06 第一批落地(未 commit):P2 helper 重构(第 1/4 项)+ P4 授权反向失效(第 5 项)一并完成,7 单测 + 747 全量回归绿。**第 2 项 store 回读刻意推迟**到 ① auth 实验有结论(避免历史 session 401 造成续聊回归);helper 内已预留回读点。
- P1 昵称底座(第 6 项/REQ-055)**未动**:端点「疑为反向接口」,须先跑 ⑥ 真凭证实测钉死,否则易建错。等 user 提供真飞书环境。
- 待 user 审签 1-spec + 跑 ①⑥⑦ 钉死实验后再进第 2/6 项与真机验收。
