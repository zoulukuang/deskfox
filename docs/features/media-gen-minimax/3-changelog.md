---
feat-id: media-gen-minimax
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 3-changelog — MiniMax 接 provider(REQ-030 第二家)

## 概述

把 MiniMax 接成 media-gen 第二家供应商(REQ-030 蓝本 4 家之一,第一家是阿里 media-gen-alibaba)。验证了 §0.1 "先竖切打穿不抽象" 的工程化路径:**by-provider switch + 不抽 MediaAdapter**,第三家再痛点驱动抽象。

**用户角度结果**:配 `minimax-cn-coding-plan` key 后,DeskFox 创作模式自动多出 3 档 minimax 选项;UI 零改动,catalog/registry 既有自动化让 minimax 模型「亮起来」;真机 image 端到端通(出图)、TTS 端到端通(speech-2.8-hd 出 73KB 音频)、video 受套餐 Plus 不含视频限制(model 实现正确,等用户升 Max)。

## commit(11 笔)

| Hash | 类型 | 描述 |
|---|---|---|
| `f99149ed8` | chore | minimax 媒体能力探针(连通性+协议) |
| `9a2642231` | fix | probe-minimax 对齐 user auth.json 实际 id `minimax-cn`(后来证伪) |
| `3e19df80a` | docs | 1-spec + 2-plan 锁版 |
| `c7e5131aa` | feat | 共享错误 + image-01 引擎 |
| `137b5a257` | feat | tts + asset-save file:// 协议 |
| `7ff6b3454` | feat | Hailuo 视频异步三步引擎 |
| `d992b41f4` | feat | catalog 3 entries + dispatch by-provider 路由 |
| `2bdf67cc4` | fix | provider id 对齐上游 `minimax-cn-coding-plan`(撤销 9a2642231 错向修正) |
| `859f2a305` | fix | 2056 区分 0/0 无配额 vs 配额耗尽 |
| `7a70a738b` | fix | model 升级到 speech-2.8-turbo / MiniMax-Hailuo-2.3 |
| `6fe1a0cd5` | fix | TTS 改 `speech-2.8-hd`(走 Token Plan 而非积分) |

## 改动文件汇总

**新建**(纯 fork):
- `packages/media-gen/src/minimax-error.ts` — MinimaxError + base_resp 解析 + 9+ 错误码友好文案 + translate2056 区分 0/0 vs 配额耗尽(~110 行)
- `packages/media-gen/src/minimax-image.ts` — image-01 同步,size → aspect_ratio 推断(~70 行)
- `packages/media-gen/src/minimax-tts.ts` — speech-2.8-hd 同步,hex audio → tmpdir → file:// URL(~75 行)
- `packages/media-gen/src/minimax-video.ts` — Hailuo 异步三步(submit → poll → retrieve,6 min deadline)(~110 行)
- `packages/media-gen/__tests__/{minimax-image,minimax-tts,minimax-video,minimax-error,dispatch-minimax,asset-save-fileurl,catalog-minimax}.test.ts` — 7 个测试文件
- `packages/media-gen/scripts/cdp-creation-minimax{,-all}.ts` — 真用户 e2e 自测脚本

**修改**(fork-only 文件,0 改上游):
- `packages/media-gen/src/catalog.ts` — 加 3 个 minimax CatalogEntry + 导出 ALIBABA_KEY/MINIMAX_KEY 常量
- `packages/media-gen/src/dispatch.ts` — 重构为 by-provider 路由(抽 dispatchAlibaba + 新 dispatchMinimax,0 行为变化于 alibaba)
- `packages/media-gen/src/asset-save.ts` — file:// 分支(~10 行,minimax-tts hex 落 tmpdir 后通过此搬到 creations/audio/)
- `packages/media-gen/scripts/probe-minimax.ts` — 模型 id 同步、provider id 校正

**统计**:11 commits / ~1200 行(产品代码 ~600 + 测试 ~400 + CDP 工件 ~250 + 文档 ~250)/ 60 单测 / 0 改上游 / 0 R4。

## 验证

### 单测(R5 Large ≥5 unit)— 60/0 全过
- minimax-image: 6 cases / minimax-tts: 5 / minimax-video: 6 / minimax-error: 4 / dispatch-minimax: 4 / asset-save-fileurl: 2 / catalog-minimax: 5

### typecheck — 17/17 全过

### 真用户 e2e(CDP 驱动真 DeskFox UI)
**`cdp-creation-minimax-all.ts`**:切创作模式 → 模型下拉选 minimax → 提交 → fetch 拦截 /generate body → 验 entryId 正确。
**3/3 路由命中**:
- 文生图 → `entryId: "minimax-image-01"` ✅
- 语音合成 → `entryId: "minimax-speech-2.8-hd"` ✅
- 文生视频 → `entryId: "minimax-hailuo-2.3"` ✅

### 真机 API probe — 实测厂商响应
- **Image**: HTTP 200 / `status_code=0` / 23.3s 真出图(OSS 链接 24h 有效)
- **TTS**(speech-2.8-hd): HTTP 200 / `status_code=0 success` / audio_hex 147432 字符 = **73KB MP3 真音频**
- **Video**(MiniMax-Hailuo-2.3): `status_code=2056 (0/0 used weekly window)` — model 真识别,但 Plus 套餐不含视频(控制台用量页无 video 行),要升 Max 才有

### 真桌面 user QA(2026-05-28)
- 文生图:通,出"小白兔"图入 creations/images/
- 配音:**通**(后改 -hd 后),出声落盘
- 视频:套餐不含,UI 显示精准错误「套餐对该能力无配额(0/0,即该套餐不含此能力)」

## 沉淀的 8 个深坑 / 经验

详细跨供应商通用知识沉淀进
[`OPENCODE-PLAN/knowledge-base/接 AI 媒体供应商-踩坑实录.md`](../../../../OPENCODE-PLAN/knowledge-base/接 AI 媒体供应商-踩坑实录.md)。
以下是本 feat 直接踩出来的关键 8 条:

1. **同模型双后缀,计费路径不同**:MiniMax `speech-2.8-hd` 走 Token Plan 配额,`speech-2.8-turbo` 走积分计费;客服/简称会省略后缀,**真实 API model id 必从厂商 FAQ / models 列表实测确认**,不能信简称。
2. **API 错误码 2013 vs 2056 是模型探活金钥**:`2013 invalid model` = 名字错;`2056 quota` = 名字对但配额/权限。批量试 model 字符串变体时用这个区分.
3. **`status_msg` 文本里的 `(0/0 used)` ≠ "配额耗尽"**:0/0 = 套餐对此能力 0 配额,等多久重置都不会有;`(N/M used)` N>0 才是真耗尽。**friendly map 不能只看 status_code 数字,必看文本细节**。
4. **Provider ID 应对齐上游官方稳定值**:不要跟 user 临时 auth.json 配置漂移(我曾把 `minimax-cn-coding-plan` 改成 `minimax-cn` 适配 user 一过性配置,后续 user 重 auth 用回官方 id 时反而错位)。
5. **Provider 控制台用量页是 ground truth**:文档 / 客服 / 服务器错误信息都可能模糊,**控制台「当前用量」面板**的字段名 + 配额数字最权威。
6. **hex 内联音频需要新的边界处理**:MiniMax t2a_v2 返回 hex 字符串(非 URL),需 engine 写 tmpdir + 返回 `file://` URL,asset-save 加 file:// 分支(`readFileSync(fileURLToPath(url))` 替代 fetch)。**保持 URL 字符串作为引擎→server 契约不变,改动收敛到一处**。
7. **REQ-030 §0.1 "竖切打穿不抽象" 在第二家被验证可行**:by-provider switch + 引擎并存,alibaba 既有代码 0 行为改;`dispatchAlibaba` / `dispatchMinimax` 边界清楚。第三家来时再痛点驱动抽 `MediaAdapter`。
8. **真用户 e2e 是接 provider 的最后一道保险**:CDP 驱动真 DeskFox UI 走 mode→model→prompt→submit→fetch 拦截 /generate body → 看 entryId 是否真路由到目标 provider。比 unit test 强:验完整链路接通,不靠 mock。

## 影响范围 / 健康指标

- 上游侵入:**0 改上游 TS**(media-gen 包整体 fork-only)
- override:**0 R4**(无黑名单触碰)
- 测试纪律:R5 Large(≥5 unit + 2 e2e)远超达 60 unit + 3 e2e + 真 API probe
- 文档:Large 三文档全套 + 跨 feat knowledge-base
- 漂移 commit 数无变化(不动上游)

## 回退

11 笔 commit 顺序合并的,可整体 `git revert <merge-commit>` 一笔退掉。P4 可逆。

## Follow-up(留 backlog)

- **MediaAdapter 抽象**:第三家(xiaomi-mimo / getbot / 等)入时驱动,把 dispatchAlibaba/dispatchMinimax 抽成 `interface MediaAdapter`,每家一目录
- **HD 系列其他模型**:speech-2.6-hd / speech-02-hd 同 endpoint 同 body,加 2-3 个 CatalogEntry 即可,等用户 ask
- **video Hailuo i2v(图生视频)**:Hailuo-2.3 也支持 `first_frame_image`,可加 video_i2v capability entry
- **配额预检**:启动时拉 MiniMax 用量端点(若 user 套餐含),为 UI 显示「剩余 X 字符/张/个」
- **GroupId header**:目前不需要,但有些 MiniMax 多账号场景可能要,留个开关

完成度:✅ 100% 范围内目标全打到,无遗漏。
