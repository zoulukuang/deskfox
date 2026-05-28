---
feat-id: media-gen-minimax
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 1-spec — media-gen 接入第二家供应商:MiniMax

## 背景

REQ-030(多模态创作)第一家阿里已落地(`feat: media-gen-alibaba`,8 模型 / 6 能力)。MiniMax 之前因账户 0 余额(1008 insufficient_balance)deferred(memory: `project_minimax_key_no_balance_deferred.md`)。**2026-05-28 user 上订阅套餐后实测连通**:`/v1/image_generation` HTTP 200 status_code=0 真出图。

第二家落地的核心价值:验证 REQ-030 §0.1 "先竖切打穿不抽象" 的下一站 —— 第二家不抽象,以 provider switch 接入;第三家再抽 `MediaAdapter`。同时 **UI 应零改动**(catalog/registry 既有机制自动让 minimax 三档亮起来)。

## 目标

| 能力 | 模型 | 协议 |
|---|---|---|
| 文生图 (`image`) | `image-01` | 同步 POST `/v1/image_generation` → `data.image_urls[]` |
| 文生视频 (`video`) | `MiniMax-Hailuo-02` | 异步三步:submit → poll `/v1/query/video_generation` → retrieve `/v1/files/retrieve` → `file.download_url` |
| 配音 (`tts`) | `speech-02-turbo` (t2a_v2) | 同步 POST `/v1/t2a_v2` → **hex 内联** `data.audio`(NOT URL) |

配 `minimax-cn` key 后,创作模式 UI 自动多出 3 档,**0 行 UI 代码改动**。

## 非目标

- **不接** minimax 没的能力:`image_edit` / `asr` / `translate` / `video_i2v`(minimax 平台无 / 不在 P1)。
- **不抽** `MediaAdapter` 抽象 —— 第三家(xiaomi-mimo / getbot 等)再痛点驱动抽。
- **不改 UI**(catalog/registry 既有自动化已足)。

## 关键架构决策

### A. 第二家用 provider switch 接入(REQ-030 §0.1 既定方向)

`dispatch.ts` 现状:硬调 `dashscope-*` 引擎,不看 `entry.providerKey`。重构:

```ts
switch (entry.providerKey) {
  case ALIBABA_KEY: return dispatchAlibaba(entry, base, input)
  case MINIMAX_KEY: return dispatchMinimax(entry, base, input)
  default: throw 未知 provider
}
```

每个 provider dispatcher 内部再 switch capability。alibaba 既有代码 0 改(只是被包进函数)。

### B. hex 音频用 `file://` 协议穿过 saveAssets 边界

`minimax-tts` 引擎拿 hex 后:
1. 解 hex → `Uint8Array`
2. 写 `os.tmpdir()/<random>.mp3`
3. 返回 `{ url: "file://<tmpdir-path>" }`,跟 alibaba 引擎签名一致

`asset-save.ts saveAssets` 加 file:// 分支(~10 行):
```ts
const bytes = url.startsWith("file://")
  ? readFileSync(fileURLToPath(url))
  : new Uint8Array(await (await fetch(url)).arrayBuffer())
```

引擎到 dispatch 到 server 到 saveAssets 整条链 **保持 URL 字符串语义不变**,只在 saveAssets 加一段 io。

### C. 共享错误处理 `minimax-error.ts`

minimax 用 `base_resp.status_code`(0=ok / 1008=balance / 1004=auth),不同于 dashscope 的 HTTP+`code` 字段。3 个引擎共用一个 helper 解析 + 友好提示。

## 改动文件清单

**新建**:
- `packages/media-gen/src/minimax-error.ts`(~40 行)— 共享错误解析
- `packages/media-gen/src/minimax-image.ts`(~50 行)
- `packages/media-gen/src/minimax-video.ts`(~120 行,三步异步)
- `packages/media-gen/src/minimax-tts.ts`(~60 行,hex 解码 + tmpdir)
- `packages/media-gen/src/__tests__/minimax-image.test.ts`
- `packages/media-gen/src/__tests__/minimax-video.test.ts`
- `packages/media-gen/src/__tests__/minimax-tts.test.ts`

**修改**(纯 fork 文件):
- `catalog.ts`:加 3 个 minimax CatalogEntry(~40 行)
- `dispatch.ts`:重构为 by-provider 路由(alibaba 函数提取 + minimax 函数新增,~60 行)
- `asset-save.ts`:加 file:// 分支(~10 行)
- 测试更新:dispatch + asset-save 各 +1-2 单测

**0 改上游 TS**(media-gen 包整体已是 fork-only)。

## 测试 / 验收

R5 Large 要求 **≥ 5 unit + 2 e2e**:

**Unit**(估 12-15 个):
- 3 个 minimax engine 各 3-4 单测(成功路径 / 错误码 / mock fetch)
- asset-save file:// 分支 1-2 单测
- dispatch by-provider 路由 1-2 单测
- catalog: minimax entries 注册 1 单测

**E2E**(2 个):
- `probe-minimax.ts` 真打 image(已验证通 → 保留,作为联调 smoke)
- 新增 `probe-minimax.ts tts` 真打 t2a_v2(订阅套餐应能通)
- (video 探针保留但不强求每次跑 —— 海螺 02 时间长 + 占用配额)

**真机验收**:user 在 DeskFox 创作模式真桌面验通 3 能力(出图 / 出视频 / 出声)。

## 改动规模

**Large** —— 估 600-800 行代码 + 测试 + 3 文档。0 改上游 / 0 R4 override。

## 不在范围(留 backlog)

- MediaAdapter 抽象 —— 第三家入时痛点驱动。
- minimax 其他能力(speech-02-hd 高清 tts / mfx 等高级能力)—— 等用户提出。
- 速率限流 / 配额追踪 —— 接错则报,不做主动限流(P2)。
- video 长任务的 UI 进度条优化(已有 progress event 流,看实际体感再增)。
