---
feat-id: feishu-merge-forward
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-merge-forward — 2-plan(实施计划 + 决策轨迹)

## 锁版决策(1-spec 已 user 拍板 2026-05-26)

最具鲁棒性方案,D1-D6 + R1-R4 详见 1-spec。核心:

- **全图展开**(MAX_IMAGE_COUNT=5)+ 继承 S1-S5 加固
- SDK 拉子消息(30s timeout)
- MAX_SUB_MESSAGES=50 + 末尾省略提示
- 嵌套 1 层递归 + depth≥2 占位
- 群聊带 sender(open_id 前 6 位)+ p2p 不带 + 不显时间
- 中文 user 视角占位 + 文件名 / 大小 / 时长元信息
- R1-R4 鲁棒补强(timeout / 时间序 / 0 子消息兜底 / vision 降级)

## 文件结构

```
packages/adapter-feishu-lark/src/feishu/
├── merge-forward-fetcher.ts        (新建,~120 行) — SDK 拉子消息 + timeout
├── merge-forward-flatten.ts        (新建,~180 行) — 纯函数 flatten + sort + render
├── message-pipeline.ts             (改,+~80 行) — pipeline.handle() merge_forward 分支
└── __tests__/
    ├── merge-forward-flatten.test.ts  (新建,~250 行) — M1-M12 单测
    └── merge-forward-fetcher.test.ts  (新建,~120 行) — F1-F5 单测
```

`image-downloader.ts` / `image-downloader.test.ts` 0 改动(下载 helper 已通用,merge_forward 复用 `downloadFeishuImage(imageKey, subMessageId, chatId, token, domain)`)。

## helper 接口定义

### `merge-forward-flatten.ts`

```ts
/** 子消息(SDK `im.v1.message.get` 返 items 元素) */
export interface SubMessage {
  message_id?: string
  msg_type?: string
  body?: { content?: string }
  sender?: { id?: string }
  create_time?: string
  upper_message_id?: string
  // ... 其他字段忽略
}

/** flatten 后给 LLM 的结构化结果 */
export interface FlattenResult {
  /** flatten 后的纯文本(已含 sender 前缀 / 占位符 / 末尾省略提示)*/
  text: string
  /** 要下载并加 file part 的图(MAX_IMAGE_COUNT 内,按出现顺序)*/
  images: Array<{
    imageKey: string
    subMessageId: string
    indexInForward: number // 1-based,用于占位文案对应
  }>
}

export interface FlattenOptions {
  /** 是否在每条前加 sender 名字(p2p=false / 群=true)*/
  withSender: boolean
  /** 子消息上限,超出截断 + 末尾提示 */
  maxSubMessages: number
  /** 图上限,超出占位 `[图 N(未展开)]` */
  maxImages: number
  /** 当前嵌套深度(0=顶层,≥2 时占位)*/
  depth: number
  /** vision-incapable 模式 — 不取图,纯文本 flatten + 提示 */
  textOnly: boolean
}

export const MAX_SUB_MESSAGES = 50
export const MAX_IMAGE_COUNT = 5
export const MAX_NEST_DEPTH = 1 // depth=0 顶层 / depth=1 1 层递归 / depth≥2 占位

/** 按 create_time 升序(R2)*/
export function sortByCreateTime(items: SubMessage[]): SubMessage[]

/** 渲染单条子消息为一行文本(占位符 / sender 前缀 / 元信息)*/
export function renderSubMessage(
  item: SubMessage,
  withSender: boolean,
  imageRendered: boolean, // 该 image 已被加入 images[]?
): string

/** 主 flatten 入口(纯函数,无 IO)*/
export function flattenMergeForward(
  items: SubMessage[],
  options: FlattenOptions,
): FlattenResult
```

### `merge-forward-fetcher.ts`

```ts
import type { Client } from "@larksuiteoapi/node-sdk"
import type { SubMessage } from "./merge-forward-flatten"

export const FETCH_TIMEOUT_MS = 30_000

/**
 * 拉 merge_forward 容器的子消息列表。
 * - 走 SDK `client.im.v1.message.get({ path: { message_id }})`
 * - AbortController 兜底超时(SDK 不原生支持,Promise.race 包一层)
 * - filter `upper_message_id` 提子消息(容器本身排除)
 * - 失败抛 Error 含可读原因(R3 caller 转友好 reply)
 */
export async function fetchMergeForwardItems(
  messageId: string,
  larkClient: Client,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<SubMessage[]>
```

## pipeline 接入

`message-pipeline.ts` 现有:

```ts
if (
  event.messageType !== "text" &&
  event.messageType !== "image" &&
  event.messageType !== "post"
) {
  console.log(`skip unsupported`)
  return
}
```

改成:

```ts
if (
  event.messageType !== "text" &&
  event.messageType !== "image" &&
  event.messageType !== "post" &&
  event.messageType !== "merge_forward"
) { ... skip ... }
```

加 `merge_forward` 分支(在 text/image/post 分支之后,/new / /group 之前):

```ts
let mergeForwardText: string | null = null
let mergeForwardImages: Array<{ ... }> = []

if (event.messageType === "merge_forward") {
  // 立即提示
  await this.sendFeishuText(event.chatId, "📋 收到合并消息,展开中...").catch(() => {})

  // vision 预检(R4)
  const visionOk = await this.checkModelVisionSupport().catch(() => true)

  let items: SubMessage[]
  try {
    items = await fetchMergeForwardItems(event.messageId, this.larkClient)
  } catch (err) {
    await this.sendFeishuText(
      event.chatId,
      `❌ 没能展开这条合并消息(原因:${(err as Error).message})。把内容直接发我也行。`,
    ).catch(() => {})
    return
  }

  if (items.length === 0) {
    await this.sendFeishuText(event.chatId, "😅 这条合并消息好像是空的,换条试试?").catch(() => {})
    return
  }

  const flatten = flattenMergeForward(items, {
    withSender: event.chatType !== "p2p",
    maxSubMessages: MAX_SUB_MESSAGES,
    maxImages: visionOk ? MAX_IMAGE_COUNT : 0,
    depth: 0,
    textOnly: !visionOk,
  })

  mergeForwardText = flatten.text
  if (!visionOk && hasAnyImage(items)) {
    mergeForwardText += "\n\n⚠️ 当前 model 不支持图片识别,这条合并消息我只能看到文字部分。"
  }

  // 下载图(继承 image-downloader S1-S5)
  const auth = await getClientAuthContext(this.larkClient)
  for (const img of flatten.images) {
    try {
      const dl = await downloadFeishuImage(
        img.imageKey,
        img.subMessageId, // ← 注意:用子消息自己的 id(D1 段调研结论)
        event.chatId,
        auth.token,
        auth.domain,
      )
      mergeForwardImages.push({ mime: dl.mime, filename: dl.filename, absolutePath: dl.absolutePath })
    } catch (err) {
      console.warn(`merge_forward 子图 ${img.imageKey} 下载失败:`, err)
    }
  }
}
```

然后 `runOpencode` 的 parts 数组改成支持 N 个 file part:

```ts
parts: [
  ...(text ? [{ type: "text", text }] : []),
  ...(mergeForwardText ? [{ type: "text", text: mergeForwardText }] : []),
  ...(imageOpts?.imagePart ? [{ type: "file", ... }] : []),
  // ↓ 新增:支持多个 file part(merge_forward 多图)
  ...(mergeForwardImages ?? []).map(img => ({
    type: "file" as const,
    mime: img.mime,
    filename: img.filename,
    url: `file://${img.absolutePath}`,
  })),
  ...(imageOpts?.imageDownloadError ? [{ type: "text", text: ... }] : []),
]
```

`runOpencode` 签名扩展:加 `mergeForwardImages?: Array<{...}>` 参数。

## 嵌套递归 — depth 计数

`renderSubMessage` 内:

```ts
if (item.msg_type === "merge_forward") {
  if (depth >= MAX_NEST_DEPTH) {
    return `[嵌套合并消息(深度超限)]`
  }
  // depth=1 时:同步递归 fetch + flatten(在 flatten 主入口外做,fetcher 是 async)
  // 设计权衡:为了纯函数,renderSubMessage 不直接 fetch,
  //   把"待递归"的子消息标记后由 pipeline.handle() 同步处理
  //   返回占位 `[嵌套合并消息(展开中)]`,实际展开内容拼到外层 text 末尾
}
```

**简化决策**:嵌套递归只在 pipeline 层做,不在 flatten 内异步;实施时若复杂度高可改:**depth≥1 全占位**,把"真递归 1 层"留 phase 2 backlog。下笔实施时验证。

## 测试计划

### 单测 M1-M12(flatten)

| # | 场景 | 期望 |
|---|---|---|
| M1 | 5 条 text 子消息 | flatten 5 行,p2p 无 sender 前缀,images=[] |
| M2 | 5 条 text 群聊 + withSender=true | 每行 `[sender_6位]: text` 前缀 |
| M3 | 1 张 image | text 占位 `[图片(已展开识别)]`,images=[1 entry] |
| M4 | 7 张 image,MAX=5 | 前 5 张 images=[5 entry];6/7 占位 `[图 6(未展开)]` / `[图 7(未展开)]` |
| M5 | text + image + file + audio + video + sticker 混合 | 每条对应中文占位 + 元信息 |
| M6 | textOnly=true | images=[] 即使有图;text 占位 `[图片]`(未展开标记)|
| M7 | 60 条混合 | 截断到 50,text 末尾 `... 还有 10 条未显示` |
| M8 | items 乱序(create_time 倒序传入)| sort 后 text 时间顺序正确 |
| M9 | 嵌套 merge_forward depth≥2 | 占位 `[嵌套合并消息(深度超限)]` |
| M10 | post msg_type 子消息(图文混合)| 提 textContent + image_key(若有) |
| M11 | share_chat / share_user / 未知 msg_type | 友好占位 `[分享: ...]` / `[未知消息类型: <type>]` |
| M12 | 0 items | text="",images=[] |

### 单测 F1-F5(fetcher)

| # | 场景 | 期望 |
|---|---|---|
| F1 | SDK 返 N items 含容器 + 子消息 | 返子消息 N-1 个(filter upper_message_id) |
| F2 | SDK 返 [] | 返 [] |
| F3 | SDK 抛 error | rethrow 含 messageId |
| F4 | timeout(SDK 不返)| AbortError 转"超时" |
| F5 | SDK 返 0 子消息(只容器无 upper_message_id 项)| 返 [] |

### 单测 P1-P3(pipeline 集成,light mock)

| # | 场景 | 期望 |
|---|---|---|
| P1 | merge_forward + 0 子消息 | sendFeishuText "空合并消息",不调 LLM |
| P2 | merge_forward + fetcher 抛错 | sendFeishuText "没能展开...",不调 LLM |
| P3 | merge_forward + vision-incapable + 含图 | sendFeishuText warning 内嵌入 text,images=[] |

## 实施顺序

1. **Phase 1** flatten 纯函数 + M1-M12 单测(0.5d)
2. **Phase 2** fetcher + F1-F5 单测(0.2d)
3. **Phase 3** pipeline 接入 + P1-P3 + multi-file-part runOpencode 改造(0.4d)
4. **Phase 4** typecheck + 全 adapter test suite + 嵌套递归 + 边界 case(0.3d)
5. **Phase 5** build .app + 真飞书 IM C1-C10 实测(0.3d)
6. **Phase 6** 3-changelog + INDEX done + 改动日志.md(0.3d)

## 关键风险 + 兜底

| 风险 | 兜底 |
|---|---|
| SDK `client.im.v1.message.get` 调用与 OpenClaw 看到的 `client.im.message.get` 命名不一致 | Phase 2 实施前先 grep node-sdk types 确认正确路径 |
| 嵌套递归复杂度爆 | Phase 3 实施时若复杂度高,降级 `depth≥1 全占位` 留 backlog |
| 多图串行下载慢(5 张 8MB × 30s = 2.5min 极限)| 加 ack `📋 收到合并消息,展开中...` + console.log 每张完成进度 + 失败单图不阻塞其他 |
| MAX_SUB_MESSAGES=50 截断后 LLM 看不到关键消息 | 1-spec 已定;若 user 反馈再升 100 或提供"完整模式"flag(backlog)|

## 决策轨迹(实施中追加 note)

### 2026-05-26 实施 note

- **N1 嵌套递归位置移到 pipeline 层**:flatten 是纯函数(0 IO),嵌套展开需要 `await fetchMergeForwardItems(...)`,违反纯函数约束 → 决定 flatten 内只返"[嵌套合并消息(展开中)]"占位,实际递归由 pipeline `expandNestedMergeForward` 同步做(depth=1 fetch + flatten(depth=1) + 字符串 replace 占位)。好处:flatten 易测,递归逻辑也独立可测。
- **N2 image index 全局计数 bug**:初版 `imageGlobalIndex = images.length + 1` 在 maxImages 截断后,未展开图的序号停在 maxImages+1 不再递增 → M4 测试中第 7 张图变成 `[图 6(未展开)]` 而非 `[图 7]`。修法:加独立的 `imageCountTotal` 计数器(只在该子消息有 image_key 时 `++`),跟 `images.length` 解耦。
- **N3 SDK timeout 用 Promise.race 兜底**:`@larksuiteoapi/node-sdk` 不原生支持 AbortController,改用 Promise.race + setTimeout。注意 SDK 内部请求超时后仍在跑无法真 cancel,只是我们停等,但飞书 API 自身约定 30s,超过基本是网络问题不会无限挂。
- **N4 SDK get_message 安全**:Phase 2 实施前担心走 SDK 撞 axios + form-data 同款链(feishu-attach-upload-robustness 痛点),但 `client.im.v1.message.get` 是纯 JSON 不走 multipart,实测稳。0 撞坑。
