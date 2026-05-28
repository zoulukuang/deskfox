---
feat-id: media-gen-minimax
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 2-plan — 实施步骤 + 决策轨迹

## 实施阶段

### Stage A — 基座(共享错误)
- `minimax-error.ts`:`MinimaxError` class + `parseBaseResp(json)` helper + `httpError`/`baseRespError` 构造器 + 友好文案(1008 → "余额不足,请充值或换订阅套餐";1004 → "API key 鉴权失败,确认 minimax-cn 配置")
- 1-2 单测覆盖解析 + 友好文案

### Stage B — image-01 引擎(最简)
- `minimax-image.ts`:`MINIMAX_BASE` + `synthesizeImage(input) → { urls: string[]; model }`
- 同步 POST,直接 readJson,checkBaseResp,return image_urls
- 3 单测:成功路径 / 1008 错误 / 网络失败

### Stage C — t2a_v2 引擎 + asset-save 扩展
- 先扩 `asset-save.ts`:
  - 加 file:// 分支(`readFileSync(fileURLToPath(url))`)
  - 1 单测:file:// URL 走本地读不走 fetch
- 后 `minimax-tts.ts`:`synthesizeSpeech(input) → { url: file://...; model; voice }`
  - 拿 hex audio → `Buffer.from(hex, "hex")` → 写 `os.tmpdir/<rand>.mp3` → 返回 `pathToFileURL(p).href`
- 3 单测:成功路径(mock hex + 验文件落盘)/ 错误 / 不同 voice 参数构造

### Stage D — Hailuo-02 视频引擎(异步三步)
- `minimax-video.ts`:`generateVideo(input) → { url: download_url; model }`
  - submit POST `/v1/video_generation` → `task_id`
  - poll `/v1/query/video_generation?task_id=` 每 8s 直到 Success/Fail / 6 分钟超时
  - retrieve `/v1/files/retrieve?file_id=` → `file.download_url`
  - 注入 `onProgress` 回调驱动 SSE
- 3-4 单测:submit 错误 / Success polling / Fail polling / retrieve 错误

### Stage E — catalog + dispatch 接线
- `catalog.ts`:加 3 个 `MINIMAX_KEY = "minimax-cn"` 的 CatalogEntry,跟 alibaba 风格对齐(displayName 用 `MiniMax·xxx` 前缀)
- `dispatch.ts`:重构 by-provider 路由
  - 抽 `dispatchAlibaba(entry, base, input)` 函数(原 switch capability 逻辑,0 行为变化)
  - 新 `dispatchMinimax(entry, base, input)` 函数(switch capability:image/video/tts)
  - 主 `runEntry` 改为 by-provider switch
- 1-2 单测:dispatch 按 providerKey 路由正确(mock 引擎,验调对)

### Stage F — 验证
- `bun test` 全套(应 zero regression + 新增 unit 全过)
- `bun turbo typecheck`
- `bun run packages/media-gen/scripts/probe-minimax.ts image`(已验通)
- `bun run packages/media-gen/scripts/probe-minimax.ts tts`(订阅套餐应通)
- 顺手把 probe 脚本里的 hardcoded model 改名以匹配 catalog(若有 drift)
- 真机 DeskFox build + 创作模式自动多 minimax 三档 + 端到端出 1 张图(user 真桌面验)

### Stage G — 文档 + 合 main
- 3-changelog.md
- INDEX.md 加条目
- 改动日志.md 加索引
- 合 main 走规范(需 user 单独点头)

## 决策轨迹(实施期回填,如有踩坑)

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 拼装 provider switch 还是抽象 MediaAdapter | A(provider switch),理由:REQ-030 §0.1 既定竖切方向,第二家不抽,第三家再痛点驱动 |
| 2 | hex 音频怎么穿过 saveAssets 边界 | 引擎写 tmpdir + 返回 file:// URL,saveAssets 加 file:// 分支。**保持 URL 字符串作为引擎→server 契约不变**,改动收敛到 saveAssets 一处 |
| 3 | minimax error 跟 dashscope 错误类共用还是分开 | 分开:`MinimaxError`/`DashScopeError` 各自一个 class;不同 provider 错误语义本就分离,共用会污染 dashscope.ts 当前清晰边界 |
| 4 | provider 缩写常量放哪 | catalog.ts 已有 `ALIBABA_KEY`,跟着加 `MINIMAX_KEY = "minimax-cn"`,dispatch.ts 从 catalog 导入用 |
| 5 | tmpdir 文件清理 | 不清理(OS 重启自动清,且 saveAssets 会移到 creations/ 后 tmp 文件即可遗弃) |

## 测试计划详表

| # | 文件 | 单测数 | 覆盖 |
|---|---|---|---|
| 1 | `minimax-image.test.ts` | 3 | 成功路径解析 / 1008 / 网络失败 |
| 2 | `minimax-tts.test.ts` | 3 | hex 解码 + tmpdir 写 / voice 参数 / 错误码 |
| 3 | `minimax-video.test.ts` | 4 | submit → task_id / poll Success → file_id / poll Fail / retrieve |
| 4 | `minimax-error.test.ts` | 2 | base_resp 解析 / 友好文案 |
| 5 | `asset-save` 扩 file:// | 1 | file:// URL 走本地读 |
| 6 | `dispatch` by-provider | 2 | alibaba 路由 / minimax 路由 |
| 7 | `catalog` minimax entries | 1 | 注册了 3 entries with providerKey=minimax-cn |
| **总** | | **16** | 远超 R5 Large ≥5 unit |

E2E:`probe-minimax.ts image`(已 ✓)+ `probe-minimax.ts tts`(待验)= 2,达标。

## 风险与缓解

- **video 长任务**:Hailuo-02 实际生成 1-3 分钟,server 已 `idleTimeout: 0` 不掐 SSE,加 6 分钟 deadline 安全网。
- **hex tts 第一次实测可能撞 GroupId 必填**:minimax t2a_v2 旧版要求 query param `GroupId`,新版可能不需要。先按 probe 现状(无 GroupId)实施,若实测 1018/1024 之类错误码再补 GroupId 逻辑(从 auth.json 取或环境变量)。
- **MINIMAX_BASE drift**:probe 用 `api.minimaxi.com`(实测通)。host 写常量 + 留 env override 兜底。
