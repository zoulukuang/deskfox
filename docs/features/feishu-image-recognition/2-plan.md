---
feat-id: feishu-image-recognition
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-image-recognition — 2-plan(实施计划)

## 规模:Medium 约 +300 行代码 + ~80 行测试 / 3 文件 / 0 上游侵入

## 实施顺序

### Phase 1:`downloadFeishuImage` helper(~80 行,1h)

**新建** `packages/adapter-feishu-lark/src/feishu/image-downloader.ts`:

```ts
// FORK: 飞书图片下载到本地 workspace
// 反向于 file-uploader.ts(那是 DeskFox → 飞书);本笔是 飞书 → DeskFox
// [feat: feishu-image-recognition] 2026-05-26
//
// 实现关键(矫正经验):
//   - 绕 SDK 的 image.get(避免 axios + Buffer interop 问题)
//   - 直接 Bun fetch + tenant_access_token bearer auth
//   - 落盘到 ~/.opencode/imbot-workspace/feishu-images/<chatId>/<ts>-<image_key>.<ext>

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { IMBOT_WORKSPACE } from "../plugin"

export const FEISHU_IMAGES_DIR = join(IMBOT_WORKSPACE, "feishu-images")

export interface DownloadedImage {
  /** absolute path on local fs */
  absolutePath: string
  /** mime detected from response Content-Type */
  mime: string
  /** size in bytes */
  size: number
  /** suggested filename (用于 FilePart.filename) */
  filename: string
}

/**
 * 飞书图片下载。返回本地 absolute path。
 * 失败抛 Error 含可读原因。
 */
export async function downloadFeishuImage(
  imageKey: string,
  chatId: string,
  tenantAccessToken: string,
): Promise<DownloadedImage> {
  const url = `https://open.feishu.cn/open-apis/im/v1/images/${encodeURIComponent(imageKey)}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tenantAccessToken}` },
  })
  if (!res.ok) {
    throw new Error(`飞书图片下载失败 ${res.status} ${res.statusText} for image_key=${imageKey}`)
  }
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg"
  const ext = mimeToExt(mime)
  const buf = Buffer.from(await res.arrayBuffer())

  // chatId 含特殊字符(`oc_xxx` 安全;若 `:` `/` 等需 sanitize)
  const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, "_")
  const dir = join(FEISHU_IMAGES_DIR, safeChatId)
  await mkdir(dir, { recursive: true })

  const ts = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14) // YYYYMMDDHHMMSS
  const filename = `${ts}-${imageKey.slice(0, 12)}.${ext}`
  const absolutePath = join(dir, filename)
  await writeFile(absolutePath, buf)

  return { absolutePath, mime, size: buf.length, filename }
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case "image/jpeg":
    case "image/jpg": return "jpg"
    case "image/png": return "png"
    case "image/gif": return "gif"
    case "image/webp": return "webp"
    case "image/svg+xml": return "svg"
    case "image/bmp": return "bmp"
    case "image/avif": return "avif"
    default: return "bin"
  }
}
```

需要 `IMBOT_WORKSPACE` 从 plugin.ts export(应该已 export,确认)。

### Phase 2:`message-pipeline.ts` 接 image(~100 行,1.5h)

#### 2a. 顶部 import + 常量

```ts
import { downloadFeishuImage, FEISHU_IMAGES_DIR } from "./image-downloader"
// 友好提示语
const IMAGE_RECEIVING_HINT = "🖼️ 收到图片,识别中..."
```

#### 2b. `handle()` 改 — 不再 skip image

L289 原代码:
```ts
if (event.messageType !== "text") {
  console.log(`[pipeline ${accountId}] skip non-text message: ${event.messageType}`)
  return
}
```

改为:
```ts
if (event.messageType !== "text" && event.messageType !== "image") {
  console.log(`[pipeline ${accountId}] skip non-text/image message: ${event.messageType}`)
  return
}

// 图片消息特殊处理 — 下载 + 多模态 parts
let imagePart: { mime: string; filename: string; url: string } | null = null
let imageDownloadError: string | null = null

if (event.messageType === "image") {
  // 提 image_key from content
  const content = JSON.parse(event.content) as { image_key?: string }
  if (!content.image_key) {
    console.log(`[pipeline ${accountId}] image event 缺 image_key`)
    await sendCard(/* 友好错 */)
    return
  }

  // 提前发"识别中..."卡片(D5)
  await sendCard(/* IMAGE_RECEIVING_HINT */)

  try {
    const tenantToken = await getTenantAccessToken(account)  // 复用 file-uploader 的 token 借出方式
    const dl = await downloadFeishuImage(content.image_key, event.chatId, tenantToken)
    imagePart = {
      mime: dl.mime,
      filename: dl.filename,
      url: `file://${dl.absolutePath}`,
    }
    console.log(`[pipeline ${accountId}] downloaded image ${dl.size}B → ${dl.absolutePath}`)
  } catch (e) {
    imageDownloadError = (e as Error).message
    console.warn(`[pipeline ${accountId}] image download failed: ${imageDownloadError}`)
  }
}
```

#### 2c. `runOpencode()` 改 — parts 含 file part(L650)

```ts
const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; filename: string; url: string }> = []

if (text) {
  parts.push({ type: "text", text })
}

if (imagePart) {
  parts.push({ type: "file", mime: imagePart.mime, filename: imagePart.filename, url: imagePart.url })
}

if (imageDownloadError) {
  // 不发 file part,改 text part 让 LLM 知道发生了什么
  parts.push({
    type: "text",
    text: `(用户发了一张图片,但下载失败:${imageDownloadError}。请回复说图片暂时看不到,问 user 描述一下内容)`,
  })
}

if (parts.length === 0) {
  console.log(`[pipeline ${accountId}] empty parts(text + image 都没),skip`)
  return
}
```

#### 2d. 错误兜底卡片(D6)

如果 imageDownloadError 又没 caption,直接友好回复不调 LLM:
```ts
if (imageDownloadError && !text) {
  await sendCard(`😅 没能下载这张图(原因:${imageDownloadError})。换张图或者描述下内容?`)
  return
}
```

### Phase 3:测试 I1-I5(~80 行,1h)

**新建** `packages/adapter-feishu-lark/src/feishu/__tests__/image-downloader.test.ts`:

| # | 用例 |
|---|---|
| I1 | downloadFeishuImage mock fetch 200 + image/jpeg → 返 absolutePath + mime + size + filename |
| I2 | mock fetch 404 → throw "下载失败 404" |
| I3 | mock fetch 200 + content-type 含 charset → mime 去掉 charset |
| I4 | chatId 含特殊字符(`oc_xxx:test`)→ safe filename(下划线替换)|
| I5 | mkdir recursive 兜底新 chatId 目录 |

**追加** `message-pipeline.test.ts`:

| # | 用例 |
|---|---|
| M1 | messageType=image + image_key → 调 downloadFeishuImage(spy)+ parts 含 file part |
| M2 | messageType=image + image_key 缺失 → 发友好错卡片不调 LLM |
| M3 | messageType=image + download 失败 + 有 caption → parts 含 text + 错误描述 text(无 file part)|

### Phase 4:真飞书实测 C3-C8(1.5h)

build dev .app(含 sidecar)→ user 装 → 测:

- C3:p2p 单图(无文字)
- C4:p2p 图 + caption(实测确认 event shape — 是 1 个 event 含 caption,还是 2 个 event?)
- C5:group `requireMention=false` 单图
- C6:group `requireMention=true` @ bot + 图
- C7:"识别中..."卡片 5s 内出
- C8:模拟 image_key 失效 → 友好错卡片

### Phase 5:文档(~1h)

- 更新 1-spec status `locked` → `done`(实施完毕)
- 3-changelog 完整记录
- INDEX status `spec` → `done`
- 改动日志.md 加 entry

## commit 链(预期)

| # | commit |
|---|---|
| 1 | `f967ed5cb` docs: 1-spec 调研(已 commit)|
| 2 | (本笔)docs: 1-spec 锁版 + 2-plan |
| 3 | feat: image-downloader.ts helper + I1-I5 单测 |
| 4 | feat: message-pipeline.ts 接 image + parts 扩 file part + M1-M3 单测 |
| 5 | (实测后修迭代,如需)|
| 6 | docs: 3-changelog + INDEX done + 改动日志 |

## 风险 / 注意点

| 风险 | 缓解 |
|---|---|
| `getTenantAccessToken` 复用 file-uploader 的方式 | 看 file-uploader.ts 怎么借 token,完全照搬 |
| caption + image 的 event shape 未知 | Phase 4 实测确认 + 必要时 spec 修订 |
| 大图(>5MB)LLM 拒绝 | Anthropic 5MB / OpenAI 20MB,先不实现压缩,留 backlog |
| FilePart `url: file://...` opencode 是否支持 Windows 路径 | Mac/Linux 一致,Win 路径分隔符需用 forward slash;Bun fileURLToPath 应该处理 |
| 多 user 同 chat 同时发图 | 文件名带 ts + image_key prefix,冲突概率极低 |

## 实施开始

按 Phase 1-5 顺序执行。
