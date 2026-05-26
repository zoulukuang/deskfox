---
feat-id: feishu-merge-forward
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-merge-forward — 3-changelog(实际改动 + 回归)

## commit 链

| # | hash | 类型 | 说明 |
|---|---|---|---|
| 1 | `2bdc90a5b` | docs | 1-spec 锁版(最具鲁棒性方案)+ 2-plan + INDEX entry |
| 2 | `0cf0d9bca` | feat | flatten + fetcher + pipeline 接入 + 48 单测 |
| 3 | (本笔) | docs | 3-changelog + 2-plan status done + INDEX done + 改动日志.md |

## 行数 / 文件

净 +1891 行 / 6 文件:

- `docs/features/feishu-merge-forward/1-spec.md` +209(新建)
- `docs/features/feishu-merge-forward/2-plan.md` +270(新建)
- `docs/features/feishu-merge-forward/3-changelog.md` +~180(本笔)
- `docs/features/INDEX.md` +1(新 entry)+ 1(spec→done 改一行)
- `packages/adapter-feishu-lark/src/feishu/merge-forward-flatten.ts` +340(新建)
- `packages/adapter-feishu-lark/src/feishu/merge-forward-fetcher.ts` +85(新建)
- `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` +270 / -1(merge_forward 路径 + multi-file-part)
- `packages/adapter-feishu-lark/src/feishu/__tests__/merge-forward-flatten.test.ts` +521(新建,37 case)
- `packages/adapter-feishu-lark/src/feishu/__tests__/merge-forward-fetcher.test.ts` +162(新建,11 case)
- `改动日志.md` +1(本笔索引)

## 改动详情

### 新建 `merge-forward-flatten.ts`(340 行,纯函数 helper)

**核心 API**:

| Export | 类型 | 用途 |
|---|---|---|
| `SubMessage` | interface | SDK `im.v1.message.get` 子消息 shape 子集 |
| `FlattenResult` | interface | `{ text, images[] }` flatten 输出 |
| `FlattenOptions` | interface | `withSender` / `maxSubMessages` / `maxImages` / `depth` |
| `MAX_SUB_MESSAGES` | const = 50 | D3 截断阈值 |
| `MAX_IMAGE_COUNT` | const = 5 | D1 图配额 |
| `MAX_NEST_DEPTH` | const = 1 | D4 嵌套递归深度 |
| `sortByCreateTime(items)` | fn | R2 时间序 |
| `renderSubMessage(item, withSender, imageRendered, imageGlobalIndex, depth)` | fn | 单条 → 一行文本 |
| `flattenMergeForward(items, options)` | fn | 主入口(sort + slice + 渲染 + 占位 + 末尾省略) |
| `hasAnyImage(items)` | fn | vision-incapable model 决策辅助 |

**8 种 msg_type 占位 + 元信息**(D6):
- `text` → 原文(invalid JSON 容错 `[文本解析失败]`)
- `image` → `[图片(已展开识别)]` / `[图 N(未展开)]`
- `post` → 提 textContent + image 占位(同 image 规则)
- `file` → `[文件: 月报.docx 1.1MB]`(含 humanSize)
- `audio` → `[语音 12s]`(duration ms → s)
- `video` → `[视频 30s]`
- `sticker` → `[表情]`
- `share_chat` → `[分享: 群 oc_abcde]`(chat_id 简显)
- `share_user` → `[分享: 用户 ou_tar]`(user_id 简显)
- `merge_forward` → `[嵌套合并消息(展开中)]`(depth<MAX)/ `(深度超限)`(depth≥MAX)
- 未知 → `[未知消息类型: <type>]`

### 新建 `merge-forward-fetcher.ts`(85 行)

- 走 SDK `client.im.v1.message.get({ path: { message_id }})` 拉 items
- Promise.race + setTimeout 30s timeout(R1,SDK 不原生支持 AbortController)
- filter `upper_message_id` 提子消息(容器本身 `upper_message_id` 为 undefined / 空字符串都不算)
- 业务错(code != 0)/ 响应非法 / 网络错 全部抛 Error 含 message_id + 原因(供 R3 caller 友好转译)

### 改 `message-pipeline.ts`(+270 / -1)

**1. 白名单扩展**:加 `merge_forward` 跟 text/image/post 平级(共 4 种 messageType 进入处理流)

**2. 独立路径 `handleMergeForward(event)` 方法**(~140 行):
- 立即回 `📋 收到合并消息,展开中...`(同 image 的"识别中..."ack 模式)
- fetch + R3 错误兜底(`❌ 没能展开这条合并消息`)
- 0 子消息友好回复(`😅 这条合并消息好像是空的`)
- vision 预检(继承 image-recognition `checkModelVisionSupport`)
- flatten 顶层(depth=0)
- 嵌套展开 1 层(depth=1,见下)
- 下载所有 flatten.images(继承 image-downloader S1-S5,**关键**:用子消息自己的 `subMessageId`,跟 image-recognition feat 撞过的 API 二分同款风险点已规避)
- 组装最终 text:`(以下是用户合并转发给你的对话内容,共 N 条子消息...)\n\n<flatten text>\n\n请基于这些内容回答用户的问题`
- vision-incapable + 含图 → 末尾追加 `⚠️ 当前 model 不支持图片识别` warning
- session create / 复用 + ack reaction(同 handle 主流程)
- runOpencode 含 N file part + reply 后处理(processAttachments + sendFeishuText)

**3. 嵌套递归 `expandNestedMergeForward(baseText, items, remainingImageQuota, withSender)`** 方法(~50 行):
- 找 items 里 msg_type=merge_forward 的子消息
- 每个 fetch 子内容 → depth=1 flatten(再嵌套的会占位 `深度超限`)
- 缩进 `  ↳ ` 替换占位 `[嵌套合并消息(展开中)]`
- 子图共享 remainingImageQuota(顶层用过的扣减)
- 单个嵌套失败不阻塞其他,失败时占位换成 `[嵌套合并消息(展开失败:...)]`

**4. `runOpencode` 扩展 `imageOpts.imageParts[]`**:
```ts
imageOpts?: {
  imagePart: { ... } | null            // 单图(image-recognition 兼容)
  imageParts?: Array<{ ... }>          // 多图(merge_forward,N 个 file part)
  imageDownloadError: string | null
}
```
parts 数组拼接时把 imageParts.map 成 file part 一起塞进去。

## 测试覆盖(48 新增 case)

### M1-M12 flatten 单测(37 case,含 helper 子覆盖)

| # | 场景 | 验证点 |
|---|---|---|
| M1 | 5 条 text p2p | flatten 5 行,无 sender,images=[] |
| M2 | 5 条 text 群聊 + withSender=true | 每行 `[ou_xxx]:` 前缀,sender 缺失→`[未知]:` |
| M3 | 1 张 image | text 占位 `[图片(已展开识别)]`,images=[1] |
| M4 | 7 张 image 超 MAX=5 | 前 5 张展开,6/7 占位 `[图 N(未展开)]` |
| M5 | text/image/file/audio/video/sticker 混合 | 每条对应中文占位 + 元信息 |
| M6 | textOnly(maxImages=0)| 即使有图 images=[],text 占位 `[图 N(未展开)]` |
| M7 | 60 条混合 | 截断 50 + 末尾 `... 还有 10 条未显示`(50 条恰好无省略也覆盖)|
| M8 | items 乱序传入 | sort 后 text 时间顺序正确 |
| M9 | 嵌套 merge_forward | depth=0 占位"展开中" / depth≥MAX 占位"深度超限" |
| M10 | post 图文混合 | 提 textContent + image_key 占图配额 |
| M11 | share_chat / share_user / 未知 / invalid JSON | 全部友好占位 |
| M12 | 0 items / file 无名 / audio 0 duration | 边界兜底 |

加 `sortByCreateTime`(3 case)/ `hasAnyImage`(6 case)/ `renderSubMessage` 直接覆盖(4 case)= **37 case**

### F1-F5 fetcher 单测(11 case)

| # | 场景 | 验证点 |
|---|---|---|
| F1 | 容器 + N 子消息 | filter upper_message_id 返子消息 |
| F2 | 空 items / data 缺失 / 只容器无子消息 | 返 [] |
| F3 | SDK reject / 业务错 code≠0 / null 响应 | 抛 Error 含 messageId + 原因 |
| F4 | timeout(R1)| 超时抛 `超时 (Nms)`,timeout 内 resolve 正常 |
| F5 | upper_message_id 空字符串 / undefined | 都不算子消息 |

## 回归测试 / 验收

### C1 typecheck
`bun run typecheck` → **16/16 通过** ✓

### C2 adapter test suite
`bun test packages/adapter-feishu-lark/` → **622 pass / 0 fail / 1192 expect / 24 files / 3.73s**
基线 574(`feishu-image-recognition` 收尾)+ 新 48 = 622 ✓

### C3-C10 user 真飞书 IM 实测 ✓ 已过(user 2026-05-26 确认)

完整 10 case(C1-C10 in 1-spec)都跑过 — 私聊 / 群聊 / 多图 / 嵌套 / 各 msg_type / vision-incapable model 全部通过。

### C11 0 R4 override
全程 0 R4,均走 fork-only 新增(`merge-forward-flatten.ts` / `merge-forward-fetcher.ts` 新建 + `message-pipeline.ts` 既有 fork-only 文件扩展)。

## 影响范围

- **plugin.ts / Rust**:0 改动(纯 message-pipeline 内部扩展)
- **opencode 上游**:0 改动(P1 隔离,纯增量)
- **users**:
  - 0 配置变更(merge_forward 自动识别)
  - 已支持 model 用户:转发 N 张图 / N 条文字 / 含语音视频文件混合 → bot 全识别(图最多 5 张)
  - vision-incapable model 用户:含图 merge_forward 触发友好提示,纯文本仍 flatten
  - 转发数超 50 / 嵌套深度 ≥2 → 占位提示,不卡死
- **fs**:每条带图 merge_forward 在 `~/.opencode/imbot-workspace/feishu-images/<chatId>/` 多 N 个 image file(继承 image-recognition workspace 持久化)

## 回退方法

```bash
# 全 feat 回退(3 commits)
git revert 0cf0d9bca 2bdc90a5b
# (本笔)如果已 commit:同时 revert
```

或单点回退:
- 关 merge_forward 支持:把白名单的 `merge_forward` 删掉(`merge-forward-*.ts` 文件留着不调用,后续启用零成本)
- 关嵌套递归:`expandNestedMergeForward` 改 return baseFlattenText(占位不替换)
- 关多图展开:flatten options `maxImages: 0`(变成 textOnly 模式)

## Phase 1 e2e

本 feat 是 sidecar / plugin 层 IM 桥接逻辑,**不触 view layer / 不进 Phase 1 mock-mode 覆盖范围**。R5 v4 e2e gate 要求"main push 时所有 spec 必须过",走既有套件(0 新增 e2e)。

helper extract 模式新增的 Logic 清单成员(纯函数):
- `flattenMergeForward` + `sortByCreateTime` + `hasAnyImage` + `renderSubMessage`(merge-forward-flatten.ts):37 case 覆盖 ~100% 分支
- `fetchMergeForwardItems`(merge-forward-fetcher.ts):11 case 覆盖 SDK / timeout / 错误路径

## 实施时长

约 1.5 天(spec 调研 1h / 1-spec 锁版 + 2-plan 1.5h / 实施 helper + fetcher 2h / pipeline 接入 + 嵌套递归 2h / typecheck + 测试 + 修 image index bug 1h / build + 真飞书 IM 实测 1h / 文档收尾 1h)。Medium ~2d 原估算偏保守(实际 1.5d,helper extract 模式让单测顺畅 + 撞坑少)。

## 5 个值得记的经验 / 踩坑

1. **global image index 必须独立计数器**:初版 `imageGlobalIndex = images.length + 1` 在 maxImages 截断后,未展开图的序号停在 maxImages+1 不再递增 → M4 测试中第 7 张图变成 `[图 6(未展开)]` 而非 `[图 7]`。修法:加 `imageCountTotal` 计数器(只在该子消息有 image_key 时 `++`),跟 `images.length` 解耦。
2. **嵌套递归不能放纯函数**:flatten 是纯函数(0 IO),嵌套展开需要 await fetch → 决定 flatten 内只返占位,实际递归由 pipeline 同步层做(字符串 replace 占位)。好处:flatten 易测,递归逻辑也独立。
3. **SDK timeout 用 Promise.race 兜底**:`@larksuiteoapi/node-sdk` 不原生支持 AbortController,改用 Promise.race + setTimeout。SDK 内部请求超时后仍在跑无法真 cancel,但飞书 API 自身约定 30s 超过基本是网络问题。
4. **子消息资源访问用子消息自己的 message_id**:复用 `image-downloader.ts` 时,传 `subMessageId` 而不是 merge_forward 容器的 `event.messageId`。跟 `feishu-image-recognition` feat 撞过的 `/images/{key}` vs `/messages/{id}/resources/{key}` API 二分同款风险点,提前规避。
5. **SDK get_message 普通 JSON 0 multipart 风险**:Phase 2 实施前担心走 SDK 撞 axios + form-data 同款链(feishu-attach-upload-robustness 痛点),但 `client.im.v1.message.get` 是纯 JSON 不走 multipart,实测稳。**只有 multipart upload(image.create / file.create)才撞坑**,其它 SDK 调用安全。
