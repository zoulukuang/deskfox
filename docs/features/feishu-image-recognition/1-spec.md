---
feat-id: feishu-image-recognition
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-image-recognition — 1-spec(需求 + 验收 + 架构调研)

## 背景

user 反馈:**飞书用户发图片给 bot,bot 完全没反应 / 不识别图片内容**。

调研后定位现状:**飞书 image 消息被代码完全 ignore**。

## 现状诊断

### 关键代码位置(2026-05-26)

**入口拦截** — `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts:289`:
```ts
if (event.messageType !== "text") {
  console.log(`[pipeline ${accountId}] skip non-text message: ${event.messageType}`)
  return
}
```

→ 飞书 `image` / `file` / `sticker` 等所有非 text 消息**直接 return**,不走任何 LLM 调用,不下载,不转发。

**LLM 调用** — `message-pipeline.ts:650` `runOpencode()`:
```ts
const parts = [{ type: "text", text }]
```

→ 硬编码只发 text part,opencode SDK 的多模态 `FilePartInput` 完全没接。

### 架构事实(SDK / API 层)

| 项 | 事实 |
|---|---|
| opencode SDK `FilePartInput` 字段 | `{ type: "file", mime: string, filename?: string, url: string, source?: ... }` |
| `url` 字段约束 | **必须 HTTP(S) URL**,不支持 `file://` 本地路径,不支持 base64 内联(未实测) |
| GitHub adapter 参考 | `packages/adapter-github/src/duplicate-pr.ts:75-76` 已用 `{ type: "file", url: "https://..." }` 给 GitHub user 头像之类 |
| 飞书 image_key → 二进制 | `@larksuiteoapi/node-sdk` 的 `client.im.v1.image.get({ image_key })` 拿 binary stream;OR 直接 REST GET `https://open.feishu.cn/open-apis/im/v1/images/{image_key}` + tenant_access_token header |
| 飞书 image URL **公开访问性** | **不公开** — 必须 tenant_access_token auth,opencode SDK 给 file URL 时无法塞 auth header |
| 现有 workspace 路径 | `~/.opencode/imbot-workspace/`(其它 ATTACH 出去用同一个,统一)|

### 飞书 messageType 全集

`packages/adapter-feishu-lark/src/feishu/wss-client.ts:25-42` 注释列出可能值:
- `text` ✓ 现已支持
- **`image`** ← 本 feat 主目标
- `file`(文档类附件 — Phase 2 backlog)
- `sticker`(表情贴纸 — 用不上,LLM 看不懂)
- `interactive`(卡片消息 — 飞书 bot 框架用)
- `audio` / `video`(罕见 — backlog)

本 feat 范围:**只做 `image`**。其它非 text 仍 skip + 友好提示。

## 目标(本期范围)

> **极小化 P0**:飞书用户单发或带文字发 image → bot 把 image 传给 LLM → LLM 多模态识别 + 回复。

**包含**:
- 飞书 image 消息接收 + image_key 提取
- 飞书 image binary 下载到本地 workspace
- 通过 opencode session 多模态 part 传给 LLM(vision)
- 用户既可纯发图也可"文字 + 图片"混合(混合时文字 part + 图片 part 一起发)

**不包含**(留 backlog):
- 飞书 file 消息(.docx / .pdf 等)— 单独 feat,multimodal LLM 对 file 支持不一(需 OCR / 文档解析中间层)
- audio / video(成本高 + LLM 支持差)
- 反向:LLM 生成 image 回给飞书 user — 这是 `[ATTACH:path]` 的现有能力(已实现)
- 多图聚合:user 一条消息发多张图(罕见,先做单图)

## 架构选型(关键决策点)

`FilePartInput.url` 必须 HTTP(S) URL 是**最大架构约束**。本地下载的图怎么变成 LLM 能看的 URL?

### Option A:DeskFox 本地起 image-serving HTTP server

```
1. Plugin init 时启 Bun.serve(hostname:"127.0.0.1", port: 动态分配)
2. serve ~/.opencode/imbot-workspace/feishu-images/ 目录
3. 收到 image 后:
   - 下载图到 feishu-images/<chatId>/<ts>-<image_key>.jpg
   - URL = http://127.0.0.1:<port>/feishu-images/<chatId>/<ts>-<image_key>.jpg
   - opencode session FilePart 用此 URL
4. LLM provider 调用时(如 Claude / GPT)server-side fetch 该 URL 拿图
```

**优点**:
- url 字段满足 HTTP 约束 ✓
- 0 公网暴露(localhost 绑定,R6 网络安全合规)
- workspace 内的图直接复用现有 ATTACH 文件夹
- 0 上传第三方依赖

**风险 / 注意**:
- **LLM provider 服务器是否能访问 user 的 localhost?** 这是致命问题 — 大部分 LLM 服务器(api.anthropic.com / openai.com)**无法**访问 user 笔记本 localhost。需要确认 opencode 内部是不是把 URL 内容 fetch 到 base64 再传给 LLM(若是,localhost OK;若直接转 LLM API,localhost 不通)
- 端口分配 + 持久化(plugin restart 不影响 — 旧 URL 失效 OK,session reload 重发)
- 服务器是否需要 auth(若 multi-user 同机,需要,但 DeskFox 单用户场景可裸 serve)

### Option B:Inline data: URI(base64 内联)

```ts
const buf = await downloadImage(image_key)
const base64 = buf.toString("base64")
const part = { type: "file", mime: "image/jpeg", url: `data:image/jpeg;base64,${base64}` }
```

**优点**:
- 0 server / 0 端口 / 0 路径管理
- 完美绕开 LLM provider fetch 问题(content 直接随 request body 传)
- 跟 vision LLM API 的"image source: base64"约定原生对齐

**风险 / 注意**:
- **opencode SDK 是否真支持 data: URL?** 字段语义层面是 string,但 SDK 内部如果用 `fetch(url)` 实现下载,Node fetch 现代版支持 data URL,老版本不支持 — 需实测
- 1 张图 5MB → base64 ~6.7MB → JSON request body 膨胀,LLM API call latency / size 限制(Claude max 5MB / 30MB,GPT-4 max 20MB)
- LLM API 不一定理解 `{ type: "file", url: "data:..." }` 这个 shape — 可能需要 opencode SDK 内部做"data URL → base64 binary 提取 → repackage 给 LLM"转换。需 opencode 源码确认

### Option C:opencode 文件上传机制(若存在)

opencode 桌面端有"添加附件"功能(看 chat input + 文件树拖入)。可能内部把 user 选的本地文件**先上传到某个内部存储**,然后给 LLM 一个 stable URL。

**调研行动**:看 `packages/opencode/` 或 `packages/sdk/` 源码,有没有 `attachmentService` / `file upload` 之类 API。如果有,飞书 plugin 直接复用这个 — 把下载的飞书图 attach 进 opencode,opencode 自己管 URL。

**优点**(若存在):
- 复用 opencode 已有 attach 机制,跟手动 attach 行为完全一致
- LLM 可见性 + cache / 历史 / multi-turn 上下文都享受现有架构红利

**风险**:
- 调研 effort:0.5 ~ 1d 才能确认是否存在 + 怎么调

### Option D:opencode 内部 `sessionId/files` workspace

最近 imbot-workspace ADR(`OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md`)定 home base 是 `~/.opencode/imbot-workspace/`。opencode session.create 时传 `directory: imbot-workspace`,session 内的 file 可以用相对路径引用。

**调研行动**:opencode session 内的"工作目录文件"怎么传给 LLM?是不是 LLM 调 `read_file` tool 主动读?如果是,那图片就跟普通工作目录文件一样,LLM 看到 ATTACH 类似的 marker 后主动 `read_file` 读图。

**问题**:`read_file` 当前 tool 是不是支持图片?多模态 vision 接入路径是什么?

## 决策点(等 user 拍板)

### D1:架构 — 4 选 1

| 选项 | 描述 | 风险 | 工程量 |
|---|---|---|---|
| A | 本地 HTTP server serve image | LLM provider 访问 localhost 致命问题 | 4-6h |
| **B** | base64 data URL 内联 | SDK / LLM API 兼容性需实测 | 2-3h(如果通)|
| C | opencode 既有 attach 机制 | 调研 0.5-1d,但找到后实施快 | 调研 + 实施 1d |
| D | opencode workspace + LLM read_file tool | LLM 多模态接入路径待确认 | 调研 0.5d + 实施 4h |

**建议**:**先 0.5d 调研 C / D 路径**(opencode 是不是已经有图片 attach 能力),如果有就走 C/D;如果没有就走 B(2-3h 落地);A 是兜底。

### D2:image 下载方式

| 选项 | 描述 |
|---|---|
| A | `client.im.v1.image.get({ image_key })` 用 SDK |
| **B** | 直接 REST GET + tenant_token 走 Bun fetch(参考 file-uploader.ts 矫正 ⑥ 经验,绕 SDK Buffer interop 坑)|

**建议**:**B**。`feishu-attach-upload-robustness` 实战表明 SDK 的 multipart / Buffer 互操作有坑,Bun fetch + 手动 token 更稳。

### D3:多图聚合

用户一条消息发多张图(`message_type=image` 数组?):

| 选项 | 描述 |
|---|---|
| **A** | 不做,只支持单图;多图退化为 "处理第一张图,提示用户其它图忽略" |
| B | 做多图,parts: [text, file, file, file, ...] |

**建议**:**A**。罕见场景,留 backlog。

### D4:文字 + 图片混合消息

用户发图时带文字 caption(飞书 UI 允许)— 这种 event 的 messageType / content 形态需确认:

```
是 messageType="image" + content 有 caption?
还是 messageType="text" + content 含 image_key?
还是分两条 event?
```

需实测确认。

### D5:bot 收图后的"识别中"提示

| 选项 | 描述 |
|---|---|
| **A** | 加发"🖼️ 收到图片,识别中..." 卡片,LLM 回复后再发(对齐 reply-actions.ts 现有 typing indicator 风格)|
| B | 静默处理,LLM 回复直接发 |

**建议**:**A**。图片 vision LLM 慢(5-15s),无反馈 user 以为没收到。

### D6:错误处理

下载失败 / multimodal 不支持 / 图过大,该怎么回?

| 选项 | 描述 |
|---|---|
| **A** | 友好 reply:"😅 没能看懂这张图(原因:xxx),换张图或者跟我说说图里啥内容?" |
| B | 静默 fail |

**建议**:**A**。

## 验收标准(C1-C10)

| # | 项 | 通过 |
|---|---|---|
| C1 | typecheck | 16/16 |
| C2 | adapter 测试 | 517 基线 + 新增 ≥ 5 测试全过 |
| C3 | 飞书 user 私聊发**单图** → AI 收到 + 回复涉及图内容(实测)| 真飞书 IM 验证 |
| C4 | 飞书 user 私聊**图 + 文字 caption** → AI 看图 + 文字一起处理 | 实测 |
| C5 | 飞书 group `requireMention=false` 模式发图 → 同 C3 | 实测 |
| C6 | 飞书 group `requireMention=true` 模式 @ bot + 图 → 同 C4 | 实测 |
| C7 | "识别中..." 卡片 5s 内出 | 实测 |
| C8 | 下载失败 / 图过大 → 友好提示 | 实测(mock 失败场景)|
| C9 | 图片落盘到 `<ws>/feishu-images/<chatId>/<ts>-<imageKey>.jpg`,持久化(不污染 LLM 看不到的目录)| 文件系统验证 |
| C10 | 0 R6 网络监听违规(若 Option A 走 localhost server,绑 127.0.0.1)| pre-commit hook 验 |

## 测试用例(R5,Medium 标准:≥ 1 e2e 或 3 unit)

### Unit(`message-pipeline.test.ts` 追加)

| # | 用例 |
|---|---|
| I1 | event.messageType === "image" → 不再被 skip,进入处理分支 |
| I2 | image_key 提取 + 文件名生成正确(基于 chatId + ts + imageKey)|
| I3 | downloadFeishuImage(image_key) mock 飞书 API 返二进制,验证调用 |
| I4 | buildImagePart 函数生成正确 FilePartInput shape |
| I5 | runOpencode parts 含 text + file 混合时正确传递 |

### 集成(实测,C3-C8)

## 工程估算

| 阶段 | 估时 |
|---|---|
| 调研 C/D 路径(opencode attach 能力)| 0.5d |
| 实施 image 下载 + 落盘 + buildImagePart | 0.5d |
| 实施 messageType 接收 + caption 处理 + 错误兜底 | 0.5d |
| Unit 测试 I1-I5 | 0.5d |
| 真飞书实测 C3-C8 + 修迭代 | 0.5d |
| 文档 1-spec / 2-plan / 3-changelog | 0.5d |
| **总计** | **~3d**(Medium)|

## 风险 / 注意点

| 风险 | 缓解 |
|---|---|
| Option B data: URL SDK 不支持 | 先小步验证(写个 hello-image POC),不通则切 A / C / D |
| Option A localhost LLM 不可达 | 优先级降低,只作兜底 |
| 飞书 image API rate limit | Phase 2 加缓存(image_key → local path 复用)|
| user 发非常规图(SVG / WebP / GIF)| LLM vision 兼容性测试;不通则 fallback "图片格式不支持" |
| LLM 多模态 token 成本 | image part 通常占 几百-数千 token,user 收到 bill 会肉痛,**确认 user 接受** |

## 上下文 / 相关已落地 feat

- `feishu-bridge-light`(2026-05-23):飞书消息 pipeline + ATTACH 反向能力
- `feishu-attach-upload-robustness`(2026-05-24):反向 image 上传走 Bun fetch + FormData + Blob 绕 Bun + axios + form-data Buffer interop 坑;**本 feat 反向同款问题需注意**
- `imbot-workspace-rename` + `-followup`(2026-05-25):workspace 路径标准化
- `feishu-group-new-cmd-and-mention-rename`(2026-05-25):/new + 群里 requireMention 模式 — 本 feat C5/C6 验证依赖

## 关键术语

`飞书 image`、`image_key`、`multimodal vision`、`FilePartInput`、`opencode session multimodal`、`localhost server`、`base64 data URL`、`图片识别`

## 下一步

1. user 答 D1-D6(优先 D1 架构选型)
2. 若 D1 = C/D,先 0.5d 调研 opencode attach 路径
3. 锁版后写 2-plan + 实施
4. 真飞书实测验证(需 user 装 .app + 真账号发图)
