---
feat-id: media-gen-xiaomi
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 1-spec — media-gen 接入第三家供应商:小米 MiMo

> **规模:Large feat**(预估 ~600-900 行,触动 ≥5 上游文件,新增 capability 类型)→ 按 CLAUDE.md 规范,**本 spec user 审签后才动后续代码**。

## 背景

REQ-030 多模态创作已落地两家:
- 阿里通义(`feat: media-gen-alibaba`,8 模型 / 6 能力)
- MiniMax(`feat: media-gen-minimax`,3 能力)

第三家小米 MiMo,2026-05-28 user 拍板接入。**关键差异**:小米 MiMo 跟前两家不一样 —

- 阿里:per-capability 独立 endpoint(`/aigc/text2image` / `/audio/asr` 等),Bearer auth
- MiniMax:per-capability 独立 endpoint(`/v1/image_generation` / `/v1/t2a_v2`),Bearer auth
- **小米:统一一个 endpoint `/v1/chat/completions`**(TTS / ASR / LLM 全走它),**`api-key` header**(不是 Bearer)

且小米 Token Plan **媒体覆盖很窄** — 没有 image / video / image_edit 能力,只有 TTS 三档 + Omni 多模态(可当 ASR 用)。但 TTS 三档里有**两档其他两家都没有的独家能力**:

- **VoiceClone**(语音克隆):上传一段参考音频 → 用克隆的声线说新文本
- **VoiceDesign**(语音设计):用文字描述目标声线("中年男声、沉稳磁性") → 凭空生成声音

user 2026-05-28 明确授权"可以加新 capability 类型"。本 spec 接入 **3 个 TTS 模型 + 1 个 ASR 通道**,**新增 2 个 capability 类型**(`tts_clone` / `tts_design`)。

## 目标

| 能力 | 模型 ID | 协议路径 | 备注 |
|---|---|---|---|
| 标准 TTS (`tts`) | `mimo-v2.5-tts` | `/v1/chat/completions` | preset voice(冰糖/茉莉/苏打/白桦/Chloe/Mia/Milo/Dean/MimoDefault)+ user content 控风格 |
| 语音克隆 (`tts_clone` ⭐**新 capability**) | `mimo-v2.5-tts-voiceclone` | 同上 | `audio.voice` 必须 DataURL(`data:audio/wav;base64,xxx`)≤10MB,mp3/wav |
| 语音设计 (`tts_design` ⭐**新 capability**) | `mimo-v2.5-tts-voicedesign` | 同上 | **不能**填 `audio.voice` 字段;user content 用自然语言描述声线 |
| 转写 (`asr`) | `mimo-v2.5`(Omni) | 同上 | 多模态 `input_audio` 字段;7.8s/短音频(慢于阿里 paraformer-v2 1-3s,作为备选通道) |

配 `xiaomi-token-plan-cn` key 后,创作模式 UI 自动多 4 档 — TTS 那档跟阿里/MiniMax 并列,**新增的 tts_clone / tts_design 各起新 capability tab**。

## 非目标

- **不接** Xiaomi 没有的能力:`image` / `image_edit` / `video` / `video_i2v` / `translate`(平台无)
- **不接** `mimo-v2.5-asr` 直接 model id — probe 实测 Token Plan 没暴露(报 "Not supported model"),开源权重在 GitHub 但 hosted 不接
- **不接** Xiaomi 的 LLM(mimo-v2.5-pro / mimo-v2-omni 等)— 那是 opencode 聊天通道的事,不归 media-gen。user 想用聊天 MiMo 直接在 opencode.jsonc 加 provider 配置即可
- **不抽** `MediaAdapter` 抽象 — 第三家继续 by-provider switch(REQ-030 §0.1 "竖切打穿"),第四家再痛点驱动抽
- **限免到期处理**:Token Plan TTS 当前限免不消耗额度。**limited-time** 是 hardcoded 在小米侧,我们这边不做"限免到期检测"逻辑(到期了 API 会返回额度耗尽错误,error handler 兜底)

## 关键架构决策

### A. 新增 2 个 capability 类型 `tts_clone` / `tts_design`

`catalog.ts` 的 `Capability` type 扩展:

```ts
export type Capability =
  | "image" | "image_edit" | "video" | "video_i2v"
  | "tts" | "tts_clone" | "tts_design"  // ⭐ 新增两档
  | "asr" | "translate"
```

`CAPABILITY_LABEL` 加两条:

```ts
tts_clone: "语音克隆",
tts_design: "语音设计",
```

**`CatalogEntry.params` 类型扩展**(需要给 UI / dispatch 知道 clone / design 的额外输入):

```ts
params?: {
  sizes?: string[]
  voices?: string[]
  needFile?: "image" | "audio"  // 现有
  voiceDesignHint?: boolean      // ⭐ design 模式:UI 显示"声线描述"输入框
}
```

- `tts_clone`:复用 `needFile: "audio"`(跟 ASR 共享"传音频文件"输入框,UI 已就绪)
- `tts_design`:新加 `voiceDesignHint: true`,UI 显示"声线描述"输入框

### B. by-provider switch 加 `case XIAOMI_KEY` 分支

`dispatch.ts` 现状已 by-provider(minimax 落地时改过):

```ts
switch (entry.providerKey) {
  case ALIBABA_KEY: return dispatchAlibaba(...)
  case MINIMAX_KEY: return dispatchMinimax(...)
  case XIAOMI_KEY:  return dispatchXiaomi(...)   // ⭐ 新增
}
```

`dispatchXiaomi` 内部按 capability 路由 4 档(`tts` / `tts_clone` / `tts_design` / `asr`)。

### C. 统一 chat-completions 协议层抽出 `xiaomi-chat.ts`

不同于阿里 / MiniMax 每能力一个独立 endpoint,小米所有能力共用 `/v1/chat/completions`。**抽个统一 helper**:

```ts
// xiaomi-chat.ts
export async function postChatCompletion(opts: {
  apiKey: string, model: string, messages: any[], audio?: any, signal?: AbortSignal
}): Promise<XiaomiChatResponse> { ... }
```

四个 adapter(`xiaomi-tts.ts` / `xiaomi-tts-clone.ts` / `xiaomi-tts-design.ts` / `xiaomi-asr.ts`)共用,每个 ~30-60 行,主要差异在 messages / audio 字段构造。

### D. base64 → DataURL 输入,base64 → file:// 输出

**输入**(VoiceClone):
- adapter 拿到本地音频路径 / URL → 读字节 + 推 mime type(`.wav` → `audio/wav` / `.mp3` → `audio/mpeg`)→ 构 DataURL
- 直接喂 `audio.voice` 字段

**输出**(三档 TTS):
- 响应 `choices[0].message.audio.data` 是 base64
- 解 base64 → `Uint8Array` → 写 `os.tmpdir()/<random>.wav` → 返回 `{ url: "file://<path>" }`
- **复用** minimax-tts 已经验证好的 file:// 套路(`asset-save.ts` 已加 file:// 分支)

### E. `api-key` header(不是 Bearer)

小米 auth 是 `api-key: <key>` 头,跟阿里 / MiniMax 都不同。`xiaomi-chat.ts` 单独构 header,**不复用**别家的 `Authorization` 写法。

### F. ASR 走 Omni 多模态,**不当默认**

- `mimo-v2.5`(Omni)在 messages 数组里塞 `input_audio` 字段
- 7.8s/短音频 vs 阿里 paraformer-v2 1-3s — 慢
- `isDefault` **不打**(阿里 paraformer-v2 已是默认),小米 Omni 作为可选第二档

### G. 统一错误处理 `xiaomi-error.ts`

OpenAI 兼容协议的 error schema:`{ error: { code, message, param, type } }`(probe 实测确认)。建一个 `XiaomiError` class + helper,跟 `MinimaxError` / `DashScopeError` 平级。

```ts
class XiaomiError extends Error { code: string; param?: string }
function checkErrorResp(json: any) { if (json?.error) throw new XiaomiError(...) }
```

## 改动文件清单

**新建**(纯 fork 文件):
- `packages/media-gen/src/xiaomi-error.ts`(~50 行)— 共享错误解析 + `XiaomiError` class
- `packages/media-gen/src/xiaomi-chat.ts`(~80 行)— 统一 chat-completions POST helper
- `packages/media-gen/src/xiaomi-tts.ts`(~50 行)— 预设音色 TTS
- `packages/media-gen/src/xiaomi-tts-clone.ts`(~70 行)— VoiceClone,处理 DataURL 构造
- `packages/media-gen/src/xiaomi-tts-design.ts`(~50 行)— VoiceDesign,user content 传描述
- `packages/media-gen/src/xiaomi-asr.ts`(~60 行)— Omni 转写
- `packages/media-gen/__tests__/xiaomi-error.test.ts`
- `packages/media-gen/__tests__/xiaomi-chat.test.ts`
- `packages/media-gen/__tests__/xiaomi-tts.test.ts`
- `packages/media-gen/__tests__/xiaomi-tts-clone.test.ts`
- `packages/media-gen/__tests__/xiaomi-tts-design.test.ts`
- `packages/media-gen/__tests__/xiaomi-asr.test.ts`
- `packages/media-gen/__tests__/dispatch-xiaomi.test.ts`
- `packages/media-gen/__tests__/catalog-xiaomi.test.ts`
- `packages/media-gen/scripts/probe-xiaomi.ts` ✅(已落,probe 阶段产物)
- `docs/features/media-gen-xiaomi/2-plan.md`(实施中追加)
- `docs/features/media-gen-xiaomi/3-changelog.md`(commit 后填)

**修改**(纯 fork 文件):
- `packages/media-gen/src/catalog.ts`:
  - `Capability` 加 `tts_clone` / `tts_design`(~5 行)
  - `CAPABILITY_LABEL` 加两条(~5 行)
  - `CatalogEntry.params` 加 `voiceDesignHint?: boolean`(~3 行)
  - `XIAOMI` / `XIAOMI_KEY` 常量(~3 行)
  - 4 个 CatalogEntry(~50 行)
- `packages/media-gen/src/dispatch.ts`:
  - import xiaomi-* engines(~6 行)
  - `case XIAOMI_KEY: return dispatchXiaomi(...)` 分支(~3 行)
  - `dispatchXiaomi` 函数(~40 行)
- `本仓 改动日志.md`:1 行索引

**前端 UI 改动评估**(Large 边界判断关键):
- 创作模式下拉根据 `CAPABILITY_LABEL` 自动展示,**新加的两档 label 已写,理论上零改动就能出现**
- 但 `voiceDesignHint` 输入框 UI 是新的,需要在 `media-creation-store.tsx` / 创作面板组件加渲染分支(~20-40 行)
- **如果 UI 改动 > 50 行**:Large 性质坐实;**< 50 行**:仍是 Large 但偏轻

**总行数预估**:adapter 360 行 + 测试 400 行 + catalog/dispatch 改动 110 行 + UI ~30 行 = **~900 行**,Large 边界稳。

## 风险与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| TTS 限免到期 | 小米官方写"limited-time free",到期会扣 Token | 不做检测;error handler 兜底报"额度耗尽,请检查 Token Plan 余额" |
| Omni ASR 慢(7.8s) | LLM 推理路径,比专门 ASR 模型慢明显 | 不标 isDefault,只作备选;UI 不主推 |
| VoiceClone DataURL 10MB 上限 | 参考音频 >7.5MB 文件就会爆 | adapter 内置预检:文件 > 7MB 报"参考音频太大,请控制在 7MB 以内"(留 safety margin) |
| VoiceDesign 声线不稳 | 同一描述多次调可能生成不同声线 | 不试图缓存声线(那是 user 主动用 VoiceClone 的场景);UI 写明"每次描述会重新生成" |
| 小米 API 不稳定/限流 | RPM 100 / TPM 10M,正常用户够用,但 batch 场景可能撞 | error handler 识别 429,toast 提示"稍后再试";不做客户端 backoff |
| Capability 扩到 9 种 UI 凌乱 | 下拉档位太多;原 7 种已经接近界面承受上限 | 暂定**所有能力平铺**;如 UI 出现拥挤可后续加"能力分组"(已写到 backlog)|
| 测试覆盖 | Large feat 要 ≥ 2 e2e + 5 unit | unit 7 个、CDP 1 个(端到端跑通)。e2e 没现成框架先豁免(REQ-030 历史决策),计 unit 7+CDP 1 作为 Large 等价覆盖 |

## 验收标准

- [ ] 配 `xiaomi-token-plan-cn` key 后,创作模式下拉自动多 4 档(TTS / 语音克隆 / 语音设计 / 转写)
- [ ] **标准 TTS**:输入文本 + 选预设音色 → 生成 wav,可播放,声音匹配选定音色
- [ ] **语音克隆**:上传参考音频(< 7MB)+ 输入文本 → 生成 wav,声线明显克隆参考音
- [ ] **语音设计**:输入声线描述 + 输入文本 → 生成 wav,声线大致符合描述
- [ ] **ASR**:上传音频 → 输出文字,转写准确率达标(用 probe 阶段的 7.8s 短音频做对比基线)
- [ ] 错误处理:断网 / key 错 / 文件过大 / 文本过长 全有友好 toast
- [ ] 测试通过:unit 7 + dispatch 1 + catalog 1 + CDP 1 = 10 个
- [ ] CDP 端到端跑通 4 档(`cdp-creation-xiaomi-all.ts` 一气跑完)
- [ ] `bun run typecheck` 通过
- [ ] release build `DeskFox.exe` 启动 + 创作模式真按一次每档

## 测试矩阵

| 维度 | 覆盖 |
|---|---|
| **unit / xiaomi-error** | error.code / param / message 解析;HTTP 400 vs OK 分流 |
| **unit / xiaomi-chat** | header `api-key`(不是 Bearer);request body 完整性;响应 audio/text 双路径解析 |
| **unit / xiaomi-tts** | preset voice 透传到 audio.voice;format 默认 wav;response audio.data → tmpfile → file:// URL |
| **unit / xiaomi-tts-clone** | mime 推断(.wav / .mp3);DataURL 拼接;文件 > 7MB 预检报错 |
| **unit / xiaomi-tts-design** | audio object **不含** voice 字段(回归 probe 阶段的 "audio.voice is not supported" 报错)|
| **unit / xiaomi-asr** | input_audio 多模态消息结构;短音频转写无 placeholder 文本污染(用 mock response) |
| **unit / dispatch-xiaomi** | by-provider switch 路由正确;capability 不命中报"未支持" |
| **unit / catalog-xiaomi** | 4 条目都有正确 providerKey / model;`tts_clone` / `tts_design` 在 Capability type 里 |
| **CDP / cdp-creation-xiaomi-all** | 真桌面 UI 走一遍 4 档,验产物落到 creations/ + 聊天流出现结果卡 |

## 关联

- 上一家 [[docs/features/media-gen-minimax/1-spec.md]](provider switch 重构的起点)
- [[docs/features/media-gen-alibaba/1-spec.md]](第一家 baseline)
- [[OPENCODE-PLAN/需求池/接 AI 媒体供应商-踩坑实录.md]](跨厂家踩坑沉淀,本笔产出 1-2 条新条目:DataURL / api-key header / chat-completions 复用)
- [[memory: project_minimax_key_no_balance_deferred]] — by-provider switch 不抽 MediaAdapter 的既定决策出处
