---
feat-id: feishu-merge-forward
status: spec
related: ./1-spec.md ./2-plan.md
---

# feishu-merge-forward — 1-spec(已 user 拍板:最具鲁棒性方案)

## 问题陈述

飞书 user 长按多条消息 → 选"合并转发"发给 bot,messageType 是 `merge_forward`,内容是嵌套的多条原消息。**这是常见场景**(user 反馈 2026-05-26):甩一段聊天记录给 bot 让它"总结一下"、"提取 action items"、"翻译一下这段对话"。

**当前状态**:`message-pipeline.ts:362` 三 messageType 白名单(text / image / post)— `merge_forward` 落在 else 分支被 skip,bot 0 响应,user 看不到原因。

## 业务目标

让 bot 能理解合并转发的对话内容,给出有用 LLM 回复。**最小可用**:文本对话 flatten + 主要图片入 LLM(支持总结、Q&A、提取 action item 三大典型用例)。

## 飞书 `merge_forward` 技术事实(调研结论)

### A. content 取法

**WSS event 的 `message.content` 不含子消息**,只是占位 — **必须二次 API 拉取**:

```
GET https://open.feishu.cn/open-apis/im/v1/messages/:message_id
```

文档:https://open.feishu.cn/document/server-docs/im-v1/message/get

响应 `data.items` 数组结构:
- 1 个 merge_forward **容器**(无 `upper_message_id`)
- N 个**子消息**(有 `upper_message_id` 指向容器)
- filter `items.filter(i => i.upper_message_id)` 拿全部子消息

### B. 子消息字段

```ts
{
  message_id?: string         // 每条子消息独立 ID
  msg_type?: string           // text / image / file / audio / video / sticker / post / merge_forward(嵌套) / share_chat / share_user / ...
  body?: { content?: string } // JSON string,按 msg_type 二次解析(同普通消息)
  sender?: { id?: string, sender_type?: string, id_type?: string }
  create_time?: string        // ms 字符串,需 parseInt 排序
  upper_message_id?: string
  root_id?: string, parent_id?: string, chat_id?: string, ...
}
```

### C. 资源访问

子消息的 `image_key` / `file_key` 走:

```
GET /open-apis/im/v1/messages/{sub_message_id}/resources/{key}?type=image|file
```

⚠️ **关键**:`message_id` 用**子消息自己的 id**,不是 merge_forward 容器 id(每个子消息独立鉴权)— 跟我们 feishu-image-recognition feat 撞过的"image API 二分"同款风险点,本 feat 务必复用 `image-downloader.ts` 同款认证模式但加 `subMessageId` 参数。

### D. 嵌套支持

支持 — 子消息 `msg_type` 可以再是 `merge_forward`。OpenClaw 不递归展开(占位 `[Nested Merged Forward]`),递归会带来无限循环 / token 爆等问题。

## OpenClaw 参考(read-only,不引依赖)

`/Volumes/ExtSSD/备份/.openclaw_副本/extensions/feishu/src/bot.ts` L341-452 (parser) + L899-929 (dispatcher)。

策略 = **拉取 → flatten → 文本拼接**:

1. event 命中 `merge_forward` → 占位 `[Merged and Forwarded Message - loading...]`
2. `client.im.message.get({ message_id })` 拉 items
3. filter `upper_message_id`,按 `create_time` 升序排
4. 每条按 msg_type 渲染**一行文本**(非文本类全占位符):
   - text → 原文 / post → 提取 textContent
   - image → `[Image]` / file → `[File: ${file_name}]` / audio→`[Audio]` / video→`[Video]` / sticker→`[Sticker]`
   - 嵌套 merge_forward → `[Nested Merged Forward]`(不递归)
5. `maxMessages = 50` 截断,超出加 `... and N more messages`
6. 替换 `ctx.content` 整体作为 LLM 输入
7. 失败兜底:`[Merged and Forwarded Message - parse error / no sub-messages / fetch error]`

**不做**:多模态展开(图/文件不下载塞进 LLM)、sender 名字内联、时间戳渲染、嵌套递归。

## 业界 3 个 LLM 化 pattern

| Pattern | 描述 | 优 | 劣 |
|---|---|---|---|
| **A. Flatten + 占位符** | OpenClaw / 多数轻量 bot 用法:一行一条,非文本仅打 tag(`[Image]`) | 简单、token 省 | 丢图文上下文,user 转发的图 bot 看不到 |
| **B. 多模态展开** | Slack/Discord LLM bot 进阶:文本 inline + 图/文件下载后作 image_url / attachment 一起送 LLM | bot 真"看到"截图,接住 user 常见用例(转发图组让 bot 整理) | token 爆 + 流控难 + 大图 OOM 风险 |
| **C. 结构化 JSON + 时间线** | 企业级 RAG/记录系统:`[{sender, time, type, text\|key}, ...]` 直送 LLM,prompt 显式说明 | LLM 能引用具体消息 | prompt 工程量大,小 bot 杀鸡用牛刀 |

## 4 个架构选项(待 user 拍板 D1)

### 选项 A — 纯 flatten + 占位符(对齐 OpenClaw,最快上线)

- pipeline 拉子消息 → 各 msg_type 渲染一行文本 → 拼成一个**纯 text part** 给 LLM
- 图/文件全占位符 `[Image]` `[File: name]`(LLM 看不到)
- ⏱ 估时:0.5d(20 行 helper + 5 行 pipeline 接入 + 10 测试)
- ✅ 0 多模态成本 / 0 大图 OOM 风险
- ❌ user 转发图组让 bot "总结这几张图" → bot 看不到图,只能回 `[Image]` 抽象答非所问

### 选项 B — flatten + 首张图展开(渐进 hybrid,推荐 P0)

- A 方案基础上,**额外把第一张 image 子消息**走 `image-downloader.ts` 下载 → 加 file part 给 LLM
- 复用 feishu-image-recognition 的全链路(下载 / vision 预检 / file:// 内联)
- ⏱ 估时:1d(选项 A + image 下载接入 + 多/单图 边界 case)
- ✅ 80% 场景覆盖(user 转发 1 张图 + 几条 text 是最常见 pattern)
- ⚠️ 多图场景仍只看到首张(留 backlog,user 反馈再扩)

### 选项 C — flatten + 全部图展开(完整多模态)

- 所有 image 子消息都下载 + 加 file part
- ⏱ 估时:1.5d(B 方案 + 多 file part 串行下载 + max image count 限制 + token 估算)
- ✅ 完整还原图文上下文
- ❌ 5 张 8MB 图 = 40MB+ 内嵌 LLM,context window 压力 + 部分 vision API 拒大 batch / 慢
- ❌ token cost 可能突增(5 张 1024x1024 ≈ 765 token × 5 ≈ 4k token 单消息)

### 选项 D — 结构化 JSON 时间线(企业级)

- 转 `[{sender, time, msg_type, text|image_url}, ...]` 直送 LLM
- system prompt 显式说"这是聊天记录摘要"
- ⏱ 估时:2.5d(选项 C + prompt 工程 + sender 名字解析 + 时间格式化)
- ✅ LLM 能精准引用"小明 14:32 说的那条"
- ❌ 对 DeskFox 当前 bot 用法过度设计(我们不是 RAG 系统),先做 B 实战看反馈再决策升级

**推荐 P0 = 选项 B**(flatten + 首图)。理由:复用现有 image-downloader 链路 0 额外基础设施 / 覆盖 80% 真实用例 / 不行可以无缝升 C(把"取首张"改成"取所有")。

## 决策点(已 user 拍板 2026-05-26,选最具鲁棒性方案)

### D1. P0 范围 — **C 全图展开**
- 全部 image 子消息都下载 + 加 file part 给 LLM
- **MAX_IMAGE_COUNT = 5**(防 token 爆,超出末尾占位 `[图 N(未展开)]`)
- 每图继承 feishu-image-recognition S1-S5 加固(20MB 单图 / 30s timeout / 7 种 mime 白名单 / 路径越界 assert / error 不含 token)

### D2. 子消息拉取方式 — **SDK** `client.im.message.get()`
- SDK 普通 JSON 不走 multipart,0 撞 `feishu-attach-upload-robustness` axios + form-data 链
- 如果实测撞坑再换 Bun-native fetch(对齐 image-downloader 绕 SDK 模式)

### D3. 子消息上限 — **MAX_SUB_MESSAGES = 50**
- 超出末尾加 `... 还有 N 条未显示`(OpenClaw 已验证)
- 飞书 client UI 单条 merge_forward 估 ~100,实际见过 200+ case 不全显;50 覆盖典型场景

### D4. 嵌套 merge_forward — **1 层递归 + depth≥2 占位**
- depth=0 实展开;depth=1 递归展开;depth≥2 占位 `[嵌套合并消息(深度超限)]`
- 防无限循环 + token 爆 + API rate limit 压力

### D5. sender / 时间戳 — **群聊带 sender(open_id 前 6 位)+ p2p 不带 + 不显时间**
- 群聊:`[小明_ou_3a4b]:你好`(open_id 前 6 位简显,sender_id → 用户名映射留 backlog,需查飞书 contact API 缓存)
- p2p:转发都是 user 自己,sender 无意义不带
- 时间:绝对时间 LLM 用不上,需 sender_id 映射开销大,先不显

### D6. 占位文案 — **中文 user 视角 + 元信息**
- `[图片]` / `[图片(已展开识别)]` 已加 file part 时
- `[文件: 月报.docx 1.2MB]` 带文件名 + 大小元信息(LLM 能引用)
- `[语音 12s]` 带时长(若飞书 content JSON 有)
- `[视频 30s]` 同上
- `[表情]` / `[名片]` / `[分享: 群名]`(share_chat) / `[分享: 用户名]`(share_user)
- `[嵌套合并消息(深度超限)]`(D4 depth≥2)

## 鲁棒性补强(R1-R4)

### R1. 拉取子消息 30s timeout
- 对齐 image-downloader S2,`client.im.message.get` 加 AbortController(SDK 不支持的话包 `Promise.race` 兜底)

### R2. 子消息按 `create_time` 升序
- 飞书 API 返 items **不保证有序**,必须自己 `parseInt(a.create_time) - parseInt(b.create_time)` 排序
- LLM 拿到正确时间线才能理解对话流

### R3. 0 子消息 / 拉取失败 / 嵌套 depth>2 → 友好回复
- 0 子消息:`😅 这条合并消息好像是空的,换条试试?`
- 拉取失败:`❌ 没能展开这条合并消息(原因:...)。把内容直接发我也行。`
- 不卡死"识别中..."

### R4. vision 预检 + 友好降级
- 继承 feishu-image-recognition `checkModelVisionSupport()`
- vision-incapable model + 含图 merge_forward → **不展开图,纯文本 flatten + 友好提示**
- 提示文案:`⚠️ 当前 model 不支持图片识别,这条合并消息我只能看到文字部分。`

## 验收 case(C1-C12)

| C# | 场景 | 期望 |
|---|---|---|
| C1 | user 转发 5 条纯文本 → bot | bot 看到 flatten 5 行文本(群聊带 sender / p2p 不带),能总结 / 回答 |
| C2 | user 转发 1 张图 + 2 条文本 → bot | bot 看到图(file part)+ 文本 flatten,能描述图 + 回答文字 |
| C3 | user 转发 3 张图 → bot(全在 MAX=5 内) | bot 看到 3 张图全部 file part,每张占位 `[图片(已展开识别)]` |
| C4 | user 转发 7 张图 → bot(超 MAX=5) | bot 看到前 5 张 file part,后 2 张占位 `[图 N(未展开)]` |
| C5 | user 转发含语音 / 视频 / 文件 → bot | 占位文案 `[语音 12s]` / `[视频 30s]` / `[文件: x.pdf 1MB]`,bot 不卡死 |
| C6 | user 转发 60 条 → bot | 截断到 50,末尾 `... 还有 10 条未显示` |
| C7 | user 转发嵌套 merge_forward → bot | depth=1 真递归展开;depth≥2 占位 `[嵌套合并消息(深度超限)]` |
| C8 | 飞书 API 拉子消息失败(401/超时/网络断)→ bot | 友好错误 reply,**不**卡死"识别中..." |
| C9 | vision-incapable model + 含图 merge_forward → bot | 复用 feishu-image-recognition 的 vision 预检,不展开图 + 友好提示 |
| C10 | 0 子消息 merge_forward → bot | 友好 reply,bot 不卡死 |
| C11 | typecheck 16/16 全过 |
| C12 | adapter test suite 现有 574 + 新增 ≥ 12 单测 全过 |

## 实施分阶段(Medium 估算,1.7d→2.0d 加 R1-R4 + 全图)

| Phase | 内容 | 估时 |
|---|---|---|
| 1 | helper extract(纯函数,易测):`flattenMergeForward(items, options) → {text, imageKeys[]}` / `renderSubMessage(item, opts)` / `sortByCreateTime(items)` / `sliceWithEllipsis(items, max)` | 0.5d |
| 2 | `merge-forward-fetcher.ts`(新文件):`fetchMergeForwardItems(messageId, larkClient, timeoutMs=30s)`,SDK 调用 + AbortController + R3 错误兜底 | 0.2d |
| 3 | pipeline.handle() 加 `merge_forward` 分支:vision 预检 → fetchMergeForwardItems → flatten → 依次下载 imageKeys[](复用 image-downloader,继承 S1-S5)→ N 个 file part 注入 + R4 vision-incapable 降级 + 嵌套 depth 计数 | 0.4d |
| 4 | 边界 case:嵌套 1 层递归 / 超 MAX_SUB_MESSAGES 截断 / 超 MAX_IMAGE_COUNT 截断 / 拉取失败兜底 / sender 显示 | 0.3d |
| 5 | 单测 12+ case(M1-M12)+ typecheck + adapter test suite | 0.3d |
| 6 | 真飞书 IM 实测(C1-C10)+ 3-changelog + INDEX done + 改动日志.md | 0.3d |
| **合计** | | **~2.0d(Medium)** |

## 不在范围(留 backlog)

- file / audio / video / sticker 等非图非文 msg_type 的多模态展开(LLM 真"听语音"/"看视频"等,opencode 当前模型支持有限)
- merge_forward 嵌套 ≥3 层递归展开(技术难度低但 token 爆险高,触发型 backlog)
- sender_id → 用户名的本地缓存(需查飞书 `contact` API,先用 open_id 前 6 位简显)
- 结构化 JSON + 时间线 pattern D(企业级 RAG 风,DeskFox bot 当前用法过度设计)
