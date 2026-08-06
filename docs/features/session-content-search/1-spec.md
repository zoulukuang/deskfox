feat-id: session-content-search
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-095 会话记录内容搜索 — 1-spec

> 源:OPENCODE-PLAN `需求池/会话记录内容搜索.md`(2026-08-06 审议版)。
> user 2026-08-06 拍板:方案整体 / R4 Q3 第 2 笔配额 / 首版排除 tool 输出与 reasoning / 档位 Large,四项全部认可。

## 需求

用户与模型的历史沟通记录(session 消息正文)支持全文搜索:输入关键词(含中文子串)→ 定位到包含该内容的会话及具体消息。

## 范围

1. **入口**:复用 ⌘K 命令面板,新增「会话内容」结果分组;命中显示会话标题 + 高亮片段 + 时间。
2. **范围**:索引全局建一份;查询默认过滤当前项目,结果底部固定「在所有项目中搜索 →」一键扩全局(全局模式显示所属项目)。
3. **搜索面**:消息正文(user text + assistant text);reasoning / tool 输出 / synthetic / ignored 首版排除,预留 kind 列。
4. **跳转**:点击 → `/{b64(directory)}/session/{sessionID}#message-{anchorMessageID}`,复用现有 hash 定位 + 自动 loadMore。
5. **中文**:FTS5 `tokenize='trigram'`;1–2 字查询回退 LIKE。

## 架构(要点)

- **数据层**:`session_fts`(content 表)+ `session_fts_idx`(FTS5 external-content 虚表)+ 6 个触发器(part 表 AI/AU/AD → content 表;content 表 AI/AD/AU → idx)。**不走上游 migration 体系**(fresh DB 只跑 schema.gen 不跑 migrations,drizzle 表达不了 FTS5),走 fork-only 幂等 bootstrap(`CREATE ... IF NOT EXISTS` + 增量 backfill + meta 版本表,首次搜索时惰性执行,进程级闩)。
- **能力探测**:bootstrap 前探测 FTS5+trigram;不可用 → search 返回 `unavailable`,前端隐藏分组。
- **接口**:`GET /session/search`(挂现有 SessionApi group,静态路径先于 `/:sessionID`,同 `/session/status` 先例);schema 收 fork-only 文件 `groups/session-search.ts`;SDK regen 出 `client.session.search`。
- **前端**:`dialog-select-file.tsx` 新 content source(去抖 200ms,`skipFilter` 绕过客户端 fuzzy);snippet 定界符(私用区字符)拆分渲染高亮;scope 信号切换全局(List 的 createResource 源是响应式的,自动重查)。
- **结果语义**:只搜根会话(`parent_id IS NULL`,与面板会话列表一致);含 archived 会话(标记弱化显示);按 (session, anchor_message) 去重取最优命中。

## 验收标准

- [ ] 关键词能命中任意历史会话的消息正文(含中文子串),结果含高亮片段
- [ ] 点击结果跳转对应会话并滚动定位到该消息(含未加载历史的深位消息)
- [ ] 千级会话/万级消息规模搜索响应 < 1s
- [ ] 新消息落库后即时可搜(触发器增量)
- [ ] FTS 不可用环境优雅降级(分组隐藏,不崩)

## R8 测试用例清单(动工前锁定)

Unit(Logic 清单,行覆盖 ≥80%):
- [ ] U1 fts query builder:中文/英文/混合/标点/空串/引号注入 → 正确 MATCH 串或 null
- [ ] U2 短查询路由:1–2 字走 LIKE、≥3 字走 MATCH;混合 token(含 <3 字 token)整体走 LIKE
- [ ] U3 snippet 定界符解析 → 高亮分段正确(前端 helper)
- [ ] U4 LIKE 路径 TS snippet 生成:命中词定位/截断/标记
- [ ] U5 触发器:insert/update/delete part(text/非 text/synthetic/ignored)→ session_fts 与 idx 随动
- [ ] U6 anchor_message_id:assistant 命中锚定所在轮 user 消息;user 命中锚定自身;无前置 user 消息回退自身 message_id
- [ ] U7 bootstrap 幂等:连跑两次不报错不重复;版本升级路径 drop+rebuild
- [ ] U8 backfill:预存 part(含混合类型)→ 只补 text 类缺行
- [ ] U9 降级:FTS5 探测失败 → unavailable,不抛
- [ ] U10 中文 trigram:子串命中(如"报错信息"命中"编译报错信息在此")

集成 / e2e:
- [ ] I1 search 查询语义(真 SQLite):中文关键词命中 + snippet + 字段齐全;scope=project 过滤;scope=global 跨项目;roots-only;archived 含且有标记;去重
- [ ] E1 e2e happy path(View 清单):⌘K 输关键词 → 「会话内容」分组出现 → 点击 → 跳到会话 URL 含 #message-锚点
- [ ] E2 全局切换行:当前项目零命中 → 点「在所有项目中搜索」→ 出全局命中
- [ ] M1(真桌面)冷启动 backfill 不卡首屏;新消息发完立即可搜

性能:
- [ ] P1 万级消息造数,搜索 < 1s
