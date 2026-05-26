---
feat-id: feishu-image-recognition
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-image-recognition — 3-changelog(实际改动 + 回归)

## commit 链

| # | hash | 类型 | 说明 |
|---|---|---|---|
| 1 | `f967ed5cb` | docs | 1-spec 调研 — 4 架构选项 A/B/C/D 对比 |
| 2 | `60174ac35` | docs | 1-spec 锁版 D 方案 + 2-plan 5 阶段计划 + INDEX entry |
| 3 | `8039a70d9` | feat | `image-downloader.ts` helper + I1-I5 单测 |
| 4 | `f0f096c78` | feat | `message-pipeline.ts` 接 image messageType + 扩 file part |
| 5 | `daf4974ad` | fix | [bug-repro] 改用 `/messages/{id}/resources/` 端点修 400 |
| 6 | `3784dc65b` | fix | [bug-repro] 加 `messageType=post` 分支处理图文混合 |
| 7 | `a436f3bf1` | feat | vision-incapable model 收图前预检 + 友好提示 |
| 8 | `c20d34ad4` | feat | S1-S5 加固 + U1-U5 单测覆盖(34 新增 case)|
| 9 | (本笔) | docs | 3-changelog + INDEX `spec` → `done` + 改动日志.md entry |

## 行数 / 文件

净 +1687 行 / 8 文件(实代码 +518,docs +531,测试 +662,既有 file-uploader / INDEX 微调):

- `docs/features/feishu-image-recognition/1-spec.md` +277(新建)
- `docs/features/feishu-image-recognition/2-plan.md` +254(新建)
- `docs/features/INDEX.md` +1(新 entry)
- `packages/adapter-feishu-lark/src/feishu/image-downloader.ts` +213(新建)
- `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` +288 / -11(image/post 分支 + vision check + parseMessageContent extract)
- `packages/adapter-feishu-lark/src/feishu/file-uploader.ts` +3 / -1(导出 `getClientAuthContext`)
- `packages/adapter-feishu-lark/src/feishu/__tests__/image-downloader.test.ts` +362(新建,I1-I5 + S1-S5 + U5,18 test case)
- `packages/adapter-feishu-lark/src/feishu/__tests__/parse-message-content.test.ts` +300(新建,U1-U4,16 test case)

## 架构选型(1-spec D1 决议)

**P0**:image / 图+文(post)单消息识别(p2p + 群两场景)
**留 backlog**:file/audio/video/sticker、多图聚合、跨消息上下文(merge_forward 由独立 feat 接)

| 选项 | 描述 | 结论 |
|---|---|---|
| A | plugin 内起 localhost HTTP server,FilePartInput.url 指 `http://127.0.0.1:port/...` | ❌ R6 风险 + 生命周期复杂 + 多 plugin 端口冲突 |
| B | 飞书 image 下载 → base64 → `data:` URL 内联到 FilePartInput | ❌ JSON 体可能 27MB+ 膨胀(20MB 图 × 1.33 base64),SDK 序列化压力 |
| C | 复用 opencode 既有 attach 机制 | ❌ 内部 API,改上游 R3 |
| **D** | **下载到 `~/.opencode/imbot-workspace/feishu-images/<chatId>/`,FilePartInput.url=`file://<absolutePath>`,opencode-cli 自动 readFile + base64 inline 给 LLM** | ✅ **0 临时 server / 0 R6 / workspace 持久化(LLM 可在多轮里复用 read_file 工具看图)/ 0 改上游** |

**关键 leverage**:`packages/opencode/src/session/prompt.ts:1230` 已经支持 file:// → base64 inline 转换(opencode 原生能力),plugin 端 0 改 opencode。

## 改动详情

### `image-downloader.ts`(新建,213 行)

**下载 helper**(绕过 SDK + axios,Bun fetch 直冲飞书 API,继承 `feishu-attach-upload-robustness` 经验):

- `downloadFeishuImage(imageKey, messageId, chatId, token, domain)` → `{absolutePath, mime, size, filename}`
- **关键端点**:`/open-apis/im/v1/messages/{message_id}/resources/{file_key}?type=image`
  - **不是** `/open-apis/im/v1/images/{image_key}`(那个只对 bot 自己上传图返 200,对 user 上传图返 400)
- 落盘 `~/.opencode/imbot-workspace/feishu-images/<chatId-sanitized>/<filename>`

**S1-S5 加固层**(`c20d34ad4`):

| Tag | 防护项 | 实现 |
|---|---|---|
| S1 | 大小硬限 20MB | Content-Length 预检 + 真 buffer 复检 + 空 buffer 拒绝(双层防御 server 撒谎 Content-Length 场景)|
| S2 | fetch timeout 30s | AbortController + setTimeout,捕 AbortError 转可读错误 |
| S3 | mime allowlist | 7 mime(jpeg/png/gif/webp/svg+xml/bmp/avif)以外全拒(防 token 失效返 HTML 错误页) |
| S4 | 落盘路径越界 assert | resolve 后必须在 `FEISHU_IMAGES_DIR` 子树内,sanitize 漏的最终防御 |
| S5 | token 不进 error message | error 只暴 image_key/message_id,tenantAccessToken **永不**出现 |
| U5 | filename 防同秒冲突 | `<ts>-<key12>-<rnd6>.<ext>` 6 字符 random suffix(100 次连续调 0 碰撞) |

### `message-pipeline.ts`(+288 / -11)

**1. messageType 分支扩展**:`text` → `text | image | post`,其它仍 skip
**2. content 解析 helper extract**:`parseMessageContent(messageType, contentJson) → {text, imageKey}` 纯函数,U1 16 case 覆盖
**3. file part 注入**:`runOpencode()` 的 `parts` 数组从 text-only 改成 `[text, file, errorText]` 混合:
```ts
parts: [
  ...(text ? [{ type: "text", text }] : []),
  ...(imagePart ? [{ type: "file", mime, filename, url: `file://${absolutePath}` }] : []),
  ...(imageDownloadError ? [{ type: "text", text: `(系统提示:下载失败:${err}...)` }] : []),
]
```
**4. 收图前 vision 预检**(`a436f3bf1`):新增 `visionCapCache: Map<key, {supportsImage, checkedAt}>` 10min TTL,首次收图查 `opencodeClient.config.providers()` 拿 model.capabilities.input.image,不支持则直接友好告知 user 换模型,避免卡在"识别中..."
**5. helper extract**(U2-U4 testable):
- `VISION_CAP_TTL_MS` 常量导出
- `isVisionCacheFresh(entry, now, ttl)` 纯函数(U3 TTL 边界)
- `extractVisionSupport(providersResponse, providerID, modelID)` 纯函数(U2/U4 capability 抽取 + provider 隔离)

### `file-uploader.ts`(+3 / -1)

`getClientAuthContext()` 提级到 export(被 `image-downloader` 借用借 `tenant_access_token`)。

### 测试覆盖

**I1-I5**(原下载 happy/edge,5 case):
- I1 mock fetch 200 → 返 absolutePath/mime/size/filename + 真落盘
- I2 mock 404 → throw 含 status + image_key
- I3 charset 参数剥离
- I4 chatId 路径遍历字符 sanitize
- I5 mkdir recursive 新目录兜底

**S1-S5 + U5**(13 case):
- S1 × 3:Content-Length 超限 / 真 buffer 超限 / 空 buffer
- S2 × 2:AbortError → "超时" / 一般网络错 → "网络错误"
- S3 × 3:text/html 拒 / octet-stream 拒 / 7 个 image mime 全放行
- S4 × 1:正常 chatId resolve 在 feishu-images 子树
- S5 × 2:404 / timeout error 都不含 token
- U5 × 3:100 次调全不同 / 格式 regex / 特殊字符 sanitize

**U1**(parseMessageContent,16 case):text × 5 / image × 3 / post × 9 edge / 其它 fallback × 1

**U2-U4**(vision,15 case):extractVisionSupport × 9(true/false/缺 capability/缺 provider/缺 model/data 各种空/provider 隔离)+ isVisionCacheFresh × 6(TTL 边界 + 自定义 TTL)

## 回归测试 / 验收

### C1 typecheck
`bun run typecheck` → **16/16 通过** ✓

### C2 adapter test suite
`bun test packages/adapter-feishu-lark/` → **574 pass / 0 fail / 1109 expect / 22 files / 3.58s**
基线 517(`imbot-workspace-rename-followup` 收尾)+ 新 57 = 574 ✓

### C3-C6 user 真飞书 IM 实测 ✓
- C3 ✓ user 私聊发图(image messageType)→ bot 回复识别内容
- C4 ✓ user 群里 @bot 发图 → bot 回复识别内容
- C5 ✓ user 私聊发"图+文字 caption"(post messageType)→ bot 回复识别内容(本笔 fix `3784dc65b` 触发)
- C6 ✓ user 切到 vision-incapable model(claude-code/haiku attachment=false)发图 → bot 回 "⚠️ ... 不支持图片识别。请到 DeskFox 设置 → ..."(本笔 feat `a436f3bf1` 触发)

### C7 0 R4 override
全程 0 R4,均走 fork-only 新增(`image-downloader.ts` 新建 + `message-pipeline.ts` 既有 fork-only 文件扩展)。

## 影响范围

- **plugin.ts / Rust**:0 改动(本 feat 完全在 plugin 层 + 用 opencode 原生 file:// 能力)
- **opencode 上游**:0 改动(P1 隔离原则,纯增量)
- **users**:
  - 0 配置变更(image 自动识别,vision-capable model 自动启用)
  - vision-incapable model 用户:首次发图收到友好 hint,引导换模型,不卡死
  - 单图大小硬限 20MB(超过会拒,user 收到清楚原因)
- **fs**:每条带图消息在 `~/.opencode/imbot-workspace/feishu-images/<chatId>/` 多一个 image file(workspace 持久化 — 后续 LLM 工具调用可访问;清理走 user 手动 / future GC backlog)

## 回退方法

```bash
# 全 feat 回退(8 commits + 本笔)
git revert c20d34ad4 a436f3bf1 3784dc65b daf4974ad f0f096c78 8039a70d9 60174ac35 f967ed5cb
```

或单点回退:
- 关 vision 预检:revert `a436f3bf1`(收图前不查,卡死风险回来)
- 关 post 支持:revert `3784dc65b`(图文 post 消息变 skip,纯 text/image 仍工作)
- 关 image 全功能:revert `8039a70d9 + f0f096c78`(回到 text-only 状态,前 5 commits 是 doc)

回退后已下载到 feishu-images/ 的图片不会自动清(workspace 持久化设计 — user 可手动 rm)。

## Phase 1 e2e

本 feat 是 sidecar / plugin 层 IM 桥接逻辑,**不触 view layer / 不进 Phase 1 mock-mode 覆盖范围**。R5 v4 e2e gate 要求"main push 时所有 spec 必须过",走既有套件(0 新增 e2e)。

helper extract 模式下产出 2 个新 Logic 清单成员(纯函数,易测):
- `parseMessageContent`(message-pipeline.ts):text/image/post content 解析,16 case 覆盖 ~100% 分支
- `extractVisionSupport` + `isVisionCacheFresh`(message-pipeline.ts):vision 检测,15 case 覆盖

## 实施时长

约 1.5 天(spec 调研 + 4 选项对比 4h / 锁版 + 2-plan 1h / 实施 image-downloader + pipeline 接入 3h / 4 fix follow-up 撞 + 修 2.5h / S1-S5 加固 + U1-U5 测试 1.5h / 文档收尾 1h)。Medium ~3d 原估算偏保守(实际 1.5d 因 D 方案 0 R3/R6 摩擦)。

## 5 个值得记的踩坑

1. **飞书 image API 二分**:`/images/{image_key}` 只对 bot 自己上传图返 200,user 上传图必须走 `/messages/{message_id}/resources/{file_key}?type=image`。debug 400 时翻 OpenClaw read-only reference 见到正确端点。
2. **messageType=post 不是 image**:user 拖图 + 输文字默认走 post(富文本),只支持 text + image 会把 post 全 skip,user 反馈"图文消息无响应"。post content shape 是嵌套 `[[{tag:"text"|"img"}, ...], ...]`。
3. **vision capability ≠ attachment**:claude-code/haiku 把 `attachment` 设 true 但 `capabilities.input.image` 仍 false → LLM 收到 file part 报错(不是直接友好降级)。预检要查 `modalities.input` 或 `capabilities.input.image`,不能查 `attachment`。
4. **opencode plugin → message-pipeline → image-downloader 循环 import**:image-downloader 早期 import `IMBOT_WORKSPACE` from plugin.ts 导致 `Cannot access 'MessagePipeline' before initialization`。修法:image-downloader 自己重算同样的路径(`join(homedir(), ".opencode", "imbot-workspace")`),不 import plugin。
5. **sidecar binary 时间戳判断**(memory existing trap):build-deskfox.sh 早期版本只在 sidecar 不存在时 build,packages/opencode 改了几周不进 binary。本 feat 改 message-pipeline.ts(sidecar 内代码),build 前先 ls sidecar mtime 确认会被重 build。
